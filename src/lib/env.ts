/**
 * Central environment access.
 *
 * Every rail is **required**. There are no simulated paths: a missing
 * credential fails the request with a message naming the variable, rather than
 * producing a number nobody should trust. `readiness()` is what the UI renders
 * so the operator sees what is missing before pressing build.
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

export const env = {
  appUrl: str("NEXT_PUBLIC_APP_URL") ?? "http://localhost:3000",
  databaseUrl: str("DATABASE_URL") ?? "./data/xemo.db",

  groqApiKey: str("GROQ_API_KEY"),
  agentModel: str("XEMO_MODEL") ?? "openai/gpt-oss-120b",

  createos: {
    apiKey: str("CREATEOS_SANDBOX_API_KEY") ?? str("CREATEOS_API_KEY"),
    baseUrl: str("CREATEOS_SANDBOX_BASE_URL") ?? "https://api.sb.createos.sh",
    shape: str("CREATEOS_SHAPE") ?? "s-1vcpu-1gb",
    rootfs: str("CREATEOS_ROOTFS") ?? "devbox:1",
    region: str("CREATEOS_REGION"),
    /**
     * Free plan allows exactly one concurrent sandbox and paused boxes still
     * count, so a create over the cap fails with 429. Builds reclaim our own
     * oldest sandboxes to stay inside this number.
     */
    maxConcurrent: num("CREATEOS_MAX_CONCURRENT_SANDBOXES", 1),
    autoPauseAfterSeconds: num("CREATEOS_AUTO_PAUSE_SECONDS", 900),
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
    /** CAIP-2 network id. eip155:84532 = Base Sepolia, eip155:8453 = Base. */
    network: str("X402_NETWORK") ?? "eip155:84532",
    facilitatorUrl: str("X402_FACILITATOR_URL") ?? "https://x402.org/facilitator",
    payTo: str("X402_PAY_TO"),
    commissionPriceUsd: num("X402_COMMISSION_PRICE_USD", 0.5),
    generatedAppPriceUsd: num("X402_GENERATED_APP_PRICE_USD", 0.02),
    serviceName: str("X402_SERVICE_NAME") ?? "Xemo",
    /**
     * Coinbase CDP credentials. Required for Base mainnet: the public
     * x402.org facilitator is testnet only.
     */
    cdpApiKeyId: str("CDP_API_KEY_ID"),
    cdpApiKeySecret: str("CDP_API_KEY_SECRET"),
    iconUrl: str("X402_ICON_URL"),
  },

  limits: {
    maxPromptChars: num("LIMIT_MAX_PROMPT_CHARS", 2000),
    maxProductNameChars: num("LIMIT_MAX_PRODUCT_NAME_CHARS", 60),
    minPriceUsd: num("LIMIT_MIN_PRICE_USD", 1),
    maxPriceUsd: num("LIMIT_MAX_PRICE_USD", 100),
    buildTimeoutMs: num("LIMIT_BUILD_TIMEOUT_MS", 10 * 60 * 1000),
  },
} as const;

/** Thrown when a rail is used without the credentials it needs. */
export class MissingCredentialsError extends Error {
  readonly code = "MISSING_CREDENTIALS";
  constructor(
    readonly rail: string,
    readonly missing: string[],
  ) {
    super(
      `${rail} not configured. Set ${missing.join(", ")} in .env.local. ` +
        `Xemo has no simulated mode, so this cannot proceed without them.`,
    );
  }
}

function require_(subject: string, vars: Record<string, string | undefined>): void {
  const missing = Object.entries(vars)
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length > 0) throw new MissingCredentialsError(subject, missing);
}

export const requireModel = () =>
  require_("The agent model is", { GROQ_API_KEY: env.groqApiKey });

export const requireCreateos = () =>
  require_("CreateOS Sandbox is", { CREATEOS_SANDBOX_API_KEY: env.createos.apiKey });

export const requireStripe = () =>
  require_("Stripe is", {
    STRIPE_SECRET_KEY: env.stripe.secretKey,
    STRIPE_WEBHOOK_SECRET: env.stripe.webhookSecret,
  });

export const requireX402 = () => require_("The x402 agent rail is", { X402_PAY_TO: env.x402.payTo });

/** A sandbox cannot reach the operator's loopback interface. */
export function appUrlIsLocal(): boolean {
  try {
    return /^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(new URL(env.appUrl).hostname);
  } catch {
    return true;
  }
}

export type RailStatus = {
  id: string;
  label: string;
  ready: boolean;
  /** Whether a build can run at all without this rail. */
  blocking: boolean;
  detail: string;
  missing: string[];
};

/** Which rails are wired. A build refuses to start unless every blocking rail is ready. */
export function readiness(): RailStatus[] {
  const rows: RailStatus[] = [
    {
      id: "model",
      label: "Agent model",
      blocking: true,
      ready: Boolean(env.groqApiKey),
      missing: env.groqApiKey ? [] : ["GROQ_API_KEY"],
      detail: env.groqApiKey
        ? `${env.agentModel} via Groq`
        : "the planner and fulfilment both need this",
    },
    {
      id: "createos",
      label: "CreateOS sandbox",
      blocking: true,
      ready: Boolean(env.createos.apiKey),
      missing: env.createos.apiKey ? [] : ["CREATEOS_SANDBOX_API_KEY"],
      detail: env.createos.apiKey
        ? `${env.createos.shape} · ${env.createos.rootfs} · cap ${env.createos.maxConcurrent}`
        : "generated code only ever runs inside a microVM",
    },
    {
      id: "stripe",
      label: "Stripe · human rail",
      blocking: true,
      ready: Boolean(env.stripe.secretKey && env.stripe.webhookSecret),
      missing: [
        ...(env.stripe.secretKey ? [] : ["STRIPE_SECRET_KEY"]),
        ...(env.stripe.webhookSecret ? [] : ["STRIPE_WEBHOOK_SECRET"]),
      ],
      detail:
        env.stripe.secretKey && env.stripe.webhookSecret
          ? "checkout + verified webhook"
          : "the webhook refuses unsigned payloads, so both are required",
    },
    {
      id: "x402",
      label: "x402 · agent rail",
      blocking: true,
      ready: Boolean(env.x402.payTo),
      missing: env.x402.payTo ? [] : ["X402_PAY_TO"],
      detail: env.x402.payTo
        ? `${env.x402.network} → ${env.x402.payTo.slice(0, 10)}…`
        : "no payee means no priced resource can be advertised",
    },
    {
      id: "callback",
      label: "Public platform URL",
      blocking: false,
      ready: !appUrlIsLocal(),
      missing: appUrlIsLocal() ? ["NEXT_PUBLIC_APP_URL"] : [],
      detail: appUrlIsLocal()
        ? `${env.appUrl} is loopback — builds will succeed, but a deployed app cannot call back for checkout or fulfilment`
        : env.appUrl,
    },
  ];
  return rows;
}

/** Throws unless every blocking rail is ready. Called before a build starts. */
export function requireBuildReady(): void {
  const blocked = readiness().filter((r) => r.blocking && !r.ready);
  if (blocked.length === 0) return;
  throw new MissingCredentialsError(
    `${blocked.length} required rail${blocked.length === 1 ? " is" : "s are"}`,
    blocked.flatMap((r) => r.missing),
  );
}
