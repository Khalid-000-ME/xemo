/**
 * Central environment access.
 *
 * Every integration is optional. When a credential is missing the platform
 * degrades to a labelled simulation rather than crashing, so the product is
 * always demoable. `capabilities()` is what the UI renders to show the operator
 * which rails are live.
 */

function str(key: string): string | undefined {
  const v = process.env[key];
  return v && v.trim().length > 0 ? v.trim() : undefined;
}

function num(key: string, fallback: number): number {
  const v = str(key);
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function bool(key: string, fallback: boolean): boolean {
  const v = str(key)?.toLowerCase();
  if (v === undefined) return fallback;
  return v === "1" || v === "true" || v === "yes";
}

export const env = {
  appUrl: str("NEXT_PUBLIC_APP_URL") ?? "http://localhost:3000",
  databaseUrl: str("DATABASE_URL") ?? "./data/agentfoundry.db",
  workspaceRoot: str("AGENTFOUNDRY_WORKSPACE_ROOT") ?? "./data/workspaces",

  anthropicApiKey: str("ANTHROPIC_API_KEY"),
  agentModel: str("AGENTFOUNDRY_MODEL") ?? "claude-sonnet-5-5",

  createos: {
    apiKey: str("CREATEOS_SANDBOX_API_KEY") ?? str("CREATEOS_API_KEY"),
    baseUrl: str("CREATEOS_SANDBOX_BASE_URL") ?? "https://api.sb.createos.sh",
    shape: str("CREATEOS_SHAPE") ?? "s-1vcpu-1gb",
    rootfs: str("CREATEOS_ROOTFS") ?? "devbox:1",
    region: str("CREATEOS_REGION"),
    /**
     * Free plan allows exactly one concurrent sandbox. The orchestrator
     * serialises deploys against this number and recycles the oldest sandbox
     * when the budget is exhausted.
     */
    maxConcurrent: num("CREATEOS_MAX_CONCURRENT_SANDBOXES", 1),
    autoPauseAfterSeconds: num("CREATEOS_AUTO_PAUSE_SECONDS", 900),
    /** vCPU-hour + GiB-hour rates, used to price compute into the margin. */
    usdPerVcpuHour: num("CREATEOS_USD_PER_VCPU_HOUR", 0.03616363),
    usdPerGibHour: num("CREATEOS_USD_PER_GIB_HOUR", 0.01159025),
  },

  stripe: {
    secretKey: str("STRIPE_SECRET_KEY"),
    publishableKey: str("STRIPE_PUBLISHABLE_KEY"),
    webhookSecret: str("STRIPE_WEBHOOK_SECRET"),
    projectId: str("STRIPE_PROJECT_ID"),
  },

  x402: {
    /** CAIP-2 network id. Base Sepolia by default; flip to eip155:8453 for mainnet. */
    network: str("X402_NETWORK") ?? "eip155:84532",
    facilitatorUrl: str("X402_FACILITATOR_URL") ?? "https://x402.org/facilitator",
    /** Address that receives payment for commissioned builds. */
    payTo: str("X402_PAY_TO"),
    /** Price an agent pays AppFactory to commission one app. */
    commissionPriceUsd: num("X402_COMMISSION_PRICE_USD", 0.5),
    /** Default price a *generated* app charges agents per API call. */
    generatedAppPriceUsd: num("X402_GENERATED_APP_PRICE_USD", 0.02),
    serviceName: str("X402_SERVICE_NAME") ?? "AppFactory",
    iconUrl: str("X402_ICON_URL"),
  },

  paybox: {
    apiKey: str("PAYBOX_API_KEY"),
    apiUrl: str("PAYBOX_API_URL") ?? "https://api.paybox.sh",
    mcpUrl: str("PAYBOX_MCP_URL") ?? "https://api.paybox.sh/mcp",
    credentialId: str("PAYBOX_CREDENTIAL_ID"),
    maxSpendPerBuildUsd: num("PAYBOX_MAX_SPEND_PER_BUILD_USD", 0.25),
  },

  limits: {
    maxPromptChars: num("LIMIT_MAX_PROMPT_CHARS", 2000),
    maxProductNameChars: num("LIMIT_MAX_PRODUCT_NAME_CHARS", 60),
    minPriceUsd: num("LIMIT_MIN_PRICE_USD", 1),
    maxPriceUsd: num("LIMIT_MAX_PRICE_USD", 100),
    buildTimeoutMs: num("LIMIT_BUILD_TIMEOUT_MS", 10 * 60 * 1000),
  },

  demoMode: bool("AGENTFOUNDRY_DEMO_MODE", false),
} as const;

export type Capability = {
  id: string;
  label: string;
  live: boolean;
  detail: string;
};

/**
 * What is actually wired right now. Rendered in the UI so a demo never
 * silently claims a rail it does not have.
 */
export function capabilities(): Capability[] {
  return [
    {
      id: "model",
      label: "Agent model",
      live: Boolean(env.anthropicApiKey),
      detail: env.anthropicApiKey
        ? `${env.agentModel}`
        : "ANTHROPIC_API_KEY missing — planner falls back to a deterministic plan",
    },
    {
      id: "createos",
      label: "CreateOS sandbox",
      live: Boolean(env.createos.apiKey),
      detail: env.createos.apiKey
        ? `${env.createos.shape} · ${env.createos.rootfs}`
        : "CREATEOS_SANDBOX_API_KEY missing — builds run in the local simulated runner",
    },
    {
      id: "stripe",
      label: "Stripe (human revenue)",
      live: Boolean(env.stripe.secretKey),
      detail: env.stripe.secretKey
        ? env.stripe.webhookSecret
          ? "checkout + verified webhook"
          : "checkout live, STRIPE_WEBHOOK_SECRET missing (webhook unverified)"
        : "STRIPE_SECRET_KEY missing — checkout links are simulated",
    },
    {
      id: "x402",
      label: "x402 (agent revenue)",
      live: Boolean(env.x402.payTo),
      detail: env.x402.payTo
        ? `${env.x402.network} → ${env.x402.payTo.slice(0, 10)}…`
        : "X402_PAY_TO missing — /api/x402/commission answers 402 but cannot settle",
    },
    {
      id: "paybox",
      label: "PayBox (agent spend)",
      live: Boolean(env.paybox.apiKey),
      detail: env.paybox.apiKey
        ? `${env.paybox.apiUrl} · cap $${env.paybox.maxSpendPerBuildUsd.toFixed(2)}/build`
        : "PAYBOX_API_KEY missing — supplier spend is recorded at list price, not settled",
    },
  ];
}
