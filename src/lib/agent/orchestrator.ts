import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { builds, generatedFiles } from "@/lib/db/schema";
import { env, MissingCredentialsError, requireBuildReady } from "@/lib/env";
import { recordEvent } from "@/lib/events";
import { newBuildId, newFileId } from "@/lib/ids";
import { computeCostUsd, post } from "@/lib/ledger";
import { SandboxRunner } from "@/lib/createos/sandbox-runner";
import { APP_PORT } from "@/lib/createos/runner";
import { provisionProduct } from "@/lib/stripe/products";
import { generateApp } from "./codegen";
import { planProduct } from "./planner";
import type { ProductSpec } from "./spec";

/**
 * Commands the agent is permitted to run.
 *
 * The agent never composes a shell command from user text. It picks a step from
 * this list by name, which is what keeps prompt input out of the shell even
 * though the shell lives inside a disposable microVM.
 */
const BUILD_STEPS = [
  { id: "install", label: "Install dependencies", script: "npm install --no-audit --no-fund 2>&1 | tail -20" },
  { id: "typecheck", label: "Syntax-check every generated file", script: "npm run typecheck" },
  { id: "test", label: "Run the smoke test against a real server boot", script: "npm test" },
] as const;

export type StartBuildArgs = {
  prompt: string;
  productName?: string;
  priceUsd?: number;
  template?: string;
  origin?: "dashboard" | "x402" | "mcp";
  /** Ledger entry for the inbound payment that commissioned this build. */
  commission?: { amountUsd: number; externalId: string; provider: "x402" };
};

export type BuildHandle = {
  buildId: string;
  /** Resolves when the build reaches a terminal state. */
  done: Promise<BuildOutcome>;
};

export type BuildOutcome = {
  buildId: string;
  status: "live" | "failed";
  appUrl: string | null;
  agentEndpoint: string | null;
  error?: string;
  spec?: ProductSpec;
};

export class ValidationError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

function validate(args: StartBuildArgs): { priceUsd: number; agentPriceUsd: number } {
  const prompt = args.prompt?.trim() ?? "";
  if (prompt.length < 10) {
    throw new ValidationError("prompt must be at least 10 characters", "PROMPT_TOO_SHORT");
  }
  if (prompt.length > env.limits.maxPromptChars) {
    throw new ValidationError(`prompt must be under ${env.limits.maxPromptChars} characters`, "PROMPT_TOO_LONG");
  }
  if (args.productName && args.productName.length > env.limits.maxProductNameChars) {
    throw new ValidationError(
      `productName must be under ${env.limits.maxProductNameChars} characters`,
      "PRODUCT_NAME_TOO_LONG",
    );
  }

  const priceUsd = args.priceUsd ?? 5;
  if (!Number.isFinite(priceUsd) || priceUsd < env.limits.minPriceUsd || priceUsd > env.limits.maxPriceUsd) {
    throw new ValidationError(
      `priceUsd must be between ${env.limits.minPriceUsd} and ${env.limits.maxPriceUsd}`,
      "PRICE_OUT_OF_RANGE",
    );
  }

  /**
   * The agent rail is priced by the platform, not per build: the x402 resource
   * server advertises one price for the generated-app gateway, so a per-build
   * override would advertise a figure the gateway does not charge.
   */
  return { priceUsd, agentPriceUsd: env.x402.generatedAppPriceUsd };
}

/**
 * Start a build and return immediately with its id.
 *
 * Refuses up front unless every required rail is configured — there is no
 * simulated mode, so a missing credential is an error before any work or spend.
 */
export async function startBuild(args: StartBuildArgs): Promise<BuildHandle> {
  // Shape of the request first, then the operator's configuration: a malformed
  // request is a 400 whatever the environment looks like, and reporting a
  // missing credential for it would send the caller after the wrong problem.
  const { priceUsd, agentPriceUsd } = validate(args);
  requireBuildReady();
  const buildId = newBuildId();

  await db.insert(builds).values({
    id: buildId,
    origin: args.origin ?? "dashboard",
    prompt: args.prompt.trim(),
    productName: args.productName?.trim() || "(pending)",
    template: args.template ?? "analyzer",
    status: "queued",
    humanPriceUsd: priceUsd,
    agentPriceUsd,
    startedAt: new Date(),
  });

  await recordEvent(buildId, "plan", "Request received", args.prompt.trim().slice(0, 500), {
    origin: args.origin ?? "dashboard",
    humanPriceUsd: priceUsd,
    agentPriceUsd,
  });

  if (args.commission) {
    await post({
      buildId,
      provider: args.commission.provider,
      rail: "agent",
      direction: "inflow",
      amountUsd: args.commission.amountUsd,
      purpose: "commission",
      externalId: args.commission.externalId,
    });
  }

  const done = run(buildId, { ...args, priceUsd, agentPriceUsd }).catch(
    async (err): Promise<BuildOutcome> => {
      const message = err instanceof Error ? err.message : String(err);
      await fail(buildId, message);
      return { buildId, status: "failed", appUrl: null, agentEndpoint: null, error: message };
    },
  );

  return { buildId, done };
}

async function setStatus(buildId: string, status: string, detail?: string): Promise<void> {
  await db
    .update(builds)
    .set({ status, statusDetail: detail ?? null, updatedAt: new Date() })
    .where(eq(builds.id, buildId));
}

async function fail(buildId: string, message: string): Promise<void> {
  await recordEvent(buildId, "error", "Build failed", message);
  await db
    .update(builds)
    .set({ status: "failed", statusDetail: message, completedAt: new Date(), updatedAt: new Date() })
    .where(eq(builds.id, buildId));
}

async function run(
  buildId: string,
  args: StartBuildArgs & { priceUsd: number; agentPriceUsd: number },
): Promise<BuildOutcome> {
  const deadline = Date.now() + env.limits.buildTimeoutMs;
  const requireTime = (what: string) => {
    if (Date.now() > deadline) {
      throw new Error(`build exceeded its ${env.limits.buildTimeoutMs / 1000}s budget at ${what}`);
    }
  };

  // ---- 1. Plan -------------------------------------------------------------
  await setStatus(buildId, "planning");
  const plan = await planProduct({
    brief: args.prompt,
    productName: args.productName,
    priceUsd: args.priceUsd,
  });
  const spec = plan.spec;
  requireTime("planning");

  await db
    .update(builds)
    .set({ productName: spec.productName, brandColor: spec.brandColor, plan: spec, updatedAt: new Date() })
    .where(eq(builds.id, buildId));

  await recordEvent(
    buildId,
    "plan",
    `Planned "${spec.productName}" — ${spec.buildSteps.length} steps`,
    spec.tagline,
    { spec, model: env.agentModel, inputTokens: plan.inputTokens, outputTokens: plan.outputTokens },
  );

  // Planner inference is a real cost of goods, priced from reported usage.
  await post({
    buildId,
    provider: "anthropic",
    rail: "supplier",
    direction: "outflow",
    amountUsd: plan.costUsd,
    purpose: "llm_inference",
    externalId: `plan:${buildId}`,
    metadata: {
      stage: "planner",
      model: env.agentModel,
      inputTokens: plan.inputTokens,
      outputTokens: plan.outputTokens,
    },
  });

  // ---- 2. Generate ---------------------------------------------------------
  await setStatus(buildId, "generating");
  const agentEndpoint = `${env.appUrl}/api/x402/apps/${buildId}`;
  const files = await generateApp({
    spec,
    buildId,
    platformUrl: env.appUrl,
    agentEndpoint,
    humanPriceUsd: args.priceUsd,
    agentPriceUsd: args.agentPriceUsd,
    template: args.template,
  });

  for (const file of files) {
    await db.insert(generatedFiles).values({
      id: newFileId(),
      buildId,
      path: file.path,
      content: file.content,
      language: file.language,
      bytes: Buffer.byteLength(file.content, "utf8"),
    });
    await recordEvent(buildId, "file_created", `Wrote ${file.path}`, null, {
      path: file.path,
      lines: file.content.split("\n").length,
      bytes: Buffer.byteLength(file.content, "utf8"),
    });
  }
  requireTime("code generation");

  // ---- 3. Provision a CreateOS microVM -------------------------------------
  await setStatus(buildId, "testing");
  const runner = await SandboxRunner.create(buildId, { BUILD_ID: buildId, PORT: String(APP_PORT) }, (note) =>
    void recordEvent(buildId, "command_started", "CreateOS capacity", note),
  );

  await recordEvent(
    buildId,
    "command_completed",
    `CreateOS sandbox ready — ${env.createos.shape} · ${env.createos.rootfs}`,
    `sandbox ${runner.id}`,
    { sandboxId: runner.id, shape: env.createos.shape, rootfs: env.createos.rootfs },
  );

  await db.update(builds).set({ sandboxId: runner.id, updatedAt: new Date() }).where(eq(builds.id, buildId));

  let outcome: BuildOutcome;

  try {
    for (const file of files) await runner.writeFile(file.path, file.content);
    await recordEvent(buildId, "command_completed", `Uploaded ${files.length} files to ${runner.appDir}`);

    // ---- 4. Install, check, test ------------------------------------------
    for (const step of BUILD_STEPS) {
      requireTime(step.id);
      await recordEvent(buildId, "command_started", step.label, step.script, { step: step.id });
      const result = await runner.exec(step.script, step.label);
      const tail = (result.stdout || result.stderr).trim().split("\n").slice(-12).join("\n");

      if (result.exitCode !== 0) {
        await recordEvent(buildId, "test_failed", `${step.label} failed (exit ${result.exitCode})`, tail, {
          step: step.id,
          exitCode: result.exitCode,
          durationMs: result.durationMs,
        });
        throw new Error(`${step.label} failed with exit code ${result.exitCode}`);
      }

      await recordEvent(
        buildId,
        step.id === "test" ? "test_passed" : "command_completed",
        `${step.label} passed in ${(result.durationMs / 1000).toFixed(1)}s`,
        tail,
        { step: step.id, durationMs: result.durationMs },
      );
    }

    // ---- 5. Publish -------------------------------------------------------
    await setStatus(buildId, "deploying");
    await recordEvent(buildId, "deploy_started", "Starting the app and opening public ingress");
    requireTime("deploy");
    const appUrl = await runner.serve(APP_PORT);
    await db.update(builds).set({ appUrl, updatedAt: new Date() }).where(eq(builds.id, buildId));
    await recordEvent(buildId, "deploy_completed", `Live at ${appUrl}`, null, { appUrl });

    // ---- 6. Monetize: human rail ------------------------------------------
    await setStatus(buildId, "monetizing");
    const product = await provisionProduct({
      buildId,
      productName: spec.productName,
      tagline: spec.tagline,
      priceUsd: args.priceUsd,
      appUrl,
    });

    await db
      .update(builds)
      .set({
        stripeProductId: product.productId,
        stripePriceId: product.priceId,
        stripeCheckoutUrl: appUrl,
        updatedAt: new Date(),
      })
      .where(eq(builds.id, buildId));

    await recordEvent(
      buildId,
      "stripe_created",
      `Stripe product and price created — $${args.priceUsd.toFixed(2)} per ${spec.unit}`,
      `${product.productId} · ${product.priceId}`,
      { ...product, priceUsd: args.priceUsd },
    );

    // ---- 7. Monetize: agent rail ------------------------------------------
    await db
      .update(builds)
      .set({ agentEndpointUrl: agentEndpoint, updatedAt: new Date() })
      .where(eq(builds.id, buildId));
    await recordEvent(
      buildId,
      "x402_listed",
      `Agent rail open — $${args.agentPriceUsd.toFixed(2)} per call over x402`,
      `${agentEndpoint} · ${env.x402.network}`,
      { agentEndpoint, network: env.x402.network, priceUsd: args.agentPriceUsd },
    );

    // ---- 8. Book compute cost ---------------------------------------------
    const seconds = runner.elapsedSeconds();
    const cost = computeCostUsd(env.createos.shape, seconds);
    if (cost > 0) {
      await post({
        buildId,
        provider: "createos",
        rail: "compute",
        direction: "outflow",
        amountUsd: cost,
        purpose: "sandbox_compute",
        externalId: `compute:${buildId}`,
        metadata: { seconds: Math.round(seconds), shape: env.createos.shape, sandboxId: runner.id },
      });
    }

    await db
      .update(builds)
      .set({ status: "live", statusDetail: null, completedAt: new Date(), updatedAt: new Date() })
      .where(eq(builds.id, buildId));

    await recordEvent(
      buildId,
      "done",
      `${spec.productName} is live and selling on both rails`,
      `humans pay $${args.priceUsd.toFixed(2)} via Stripe · agents pay $${args.agentPriceUsd.toFixed(2)} via x402`,
      { appUrl, agentEndpoint, buildSeconds: Math.round(seconds) },
    );

    outcome = { buildId, status: "live", appUrl, agentEndpoint, spec };
  } finally {
    // A published app has to keep answering requests, so the sandbox is paused
    // rather than destroyed: it keeps its disk and wakes on the next request to
    // its ingress URL.
    await runner.dispose({ keepAlive: true });
  }

  return outcome;
}

export { MissingCredentialsError };
