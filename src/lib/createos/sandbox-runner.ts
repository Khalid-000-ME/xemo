import { createClient, type CreateosSandboxClient, type Sandbox } from "@nodeops-createos/sandbox";
import { env } from "@/lib/env";
import { APP_DIR, APP_PORT, HEALTH_PATH, type ExecOutcome, type Runner } from "./runner";

/**
 * Hosts the generated app needs to reach from inside the sandbox.
 *
 * Egress is deny-by-default once any rule is present, which is exactly what we
 * want for model-generated code: the app can install from npm, settle x402 and
 * talk to Stripe, and nothing else.
 */
const EGRESS_ALLOWLIST = [
  "registry.npmjs.org:443",
  "*.npmjs.org:443",
  "api.stripe.com:443",
  "checkout.stripe.com:443",
  "x402.org:443",
  "*.x402.org:443",
  "api.cdp.coinbase.com:443",
  "api.paybox.sh:443",
  "api.anthropic.com:443",
];

let cached: CreateosSandboxClient | undefined;

export function createosClient(): CreateosSandboxClient {
  if (!env.createos.apiKey) throw new Error("CREATEOS_SANDBOX_API_KEY is not set");
  cached ??= createClient({ apiKey: env.createos.apiKey, baseUrl: env.createos.baseUrl });
  return cached;
}

export async function createosReachable(): Promise<{ ok: boolean; detail: string }> {
  if (!env.createos.apiKey) return { ok: false, detail: "no api key" };
  try {
    const who = await createosClient().whoami();
    const running = (who as { running?: number }).running ?? 0;
    const paused = (who as { paused?: number }).paused ?? 0;
    return { ok: true, detail: `running=${running} paused=${paused}` };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * The Free plan allows a single concurrent sandbox and every non-destroyed box
 * counts against the cap, so a create over the limit fails with 429 instead of
 * queueing. Destroy the oldest AgentFoundry-owned sandboxes until there is room.
 */
async function reclaimCapacity(client: CreateosSandboxClient, keep: number): Promise<string[]> {
  const reclaimed: string[] = [];
  let boxes: Sandbox[];
  try {
    boxes = await client.listSandboxes();
  } catch {
    return reclaimed;
  }

  const ours = boxes
    .filter((b) => (b.name ?? "").startsWith("agentfoundry-"))
    .filter((b) => b.status !== "destroyed" && b.status !== "failed");

  const overBy = ours.length - (keep - 1);
  if (overBy <= 0) return reclaimed;

  // Oldest first: ids embed creation time, and list order is stable enough.
  for (const box of ours.slice(0, overBy)) {
    try {
      await box.destroy();
      reclaimed.push(box.id);
    } catch {
      // Best effort — if we cannot reclaim, create will surface the 429.
    }
  }
  return reclaimed;
}

export class SandboxRunner implements Runner {
  readonly kind = "createos" as const;
  readonly simulated = false;
  readonly appDir = APP_DIR;
  private readonly startedAt = Date.now();
  private publicBase?: string;

  private constructor(
    readonly id: string,
    private readonly sandbox: Sandbox,
  ) {}

  static async create(
    buildId: string,
    envs: Record<string, string>,
    onNote?: (note: string) => void,
  ): Promise<SandboxRunner> {
    const client = createosClient();

    const reclaimed = await reclaimCapacity(client, env.createos.maxConcurrent);
    if (reclaimed.length > 0) {
      onNote?.(`reclaimed ${reclaimed.length} sandbox slot(s) to stay inside the plan cap`);
    }

    const sandbox = await client.createSandbox({
      shape: env.createos.shape,
      rootfs: env.createos.rootfs,
      name: `agentfoundry-${buildId}`,
      ingress_enabled: true,
      egress: EGRESS_ALLOWLIST,
      envs,
      auto_pause_after_seconds: env.createos.autoPauseAfterSeconds,
      ...(env.createos.region ? { region: env.createos.region } : {}),
    });

    await sandbox.waitUntilRunning({ timeoutMs: 120_000 });
    // Created before the first `exec`, which cds into it.
    await sandbox.sh(`mkdir -p ${shellQuote(APP_DIR)}`);
    return new SandboxRunner(sandbox.id, sandbox);
  }

  async writeFile(relPath: string, content: string): Promise<void> {
    const target = `${APP_DIR}/${relPath}`;
    // `files.upload` creates parent directories as needed on the host agent;
    // mkdir -p first keeps behaviour identical across rootfs images.
    const dir = target.slice(0, target.lastIndexOf("/"));
    if (dir && dir !== APP_DIR) await this.sandbox.sh(`mkdir -p ${shellQuote(dir)}`);
    await this.sandbox.files.upload(target, content);
  }

  async exec(script: string, label?: string): Promise<ExecOutcome> {
    const started = Date.now();
    // `sh` takes no cwd — ExecOptions carries only stdin and env, so a cwd
    // passed here is silently dropped and the script runs in `/`. Change
    // directory inside the script instead, and fail if that directory is
    // missing rather than running the command somewhere unintended.
    const res = await this.sandbox.sh(`cd ${shellQuote(APP_DIR)} || exit 1\n${script}`);
    return {
      command: label ?? script,
      stdout: (res.result.stdout ?? "").slice(-8000),
      stderr: (res.result.stderr ?? res.result.error ?? "").slice(-8000),
      exitCode: res.result.exit_code,
      durationMs: res.exec_ms ?? Date.now() - started,
    };
  }

  async serve(port: number = APP_PORT): Promise<string> {
    await this.sandbox.processes.create({
      cmd: "node",
      args: ["server.mjs"],
      cwd: APP_DIR,
      env: { PORT: String(port) },
    });

    await this.sandbox.waitForPortReady(port, { timeoutMs: 90_000, intervalMs: 500 });

    // A freshly provisioned ingress hostname can serve before its TLS
    // certificate lands, so verify https and fall back to http for the demo.
    //
    // The probe path is the app's own: the ingress reserves `/healthz` and
    // answers it itself, so probing there would report a live app even when
    // the process behind it is dead.
    const https = this.sandbox.previewUrl(port, { scheme: "https" });
    if (await reachable(`${https}${HEALTH_PATH}`)) {
      this.publicBase = https;
      return https;
    }
    const http = this.sandbox.previewUrl(port, { scheme: "http" });
    this.publicBase = http;
    return http;
  }

  elapsedSeconds(): number {
    return (Date.now() - this.startedAt) / 1000;
  }

  /**
   * A deployed app has to stay reachable after the build finishes, so the
   * default is to pause rather than destroy: paused sandboxes keep their disk
   * and wake automatically on the next request to their ingress URL.
   */
  async dispose(opts?: { keepAlive?: boolean }): Promise<void> {
    try {
      if (opts?.keepAlive) await this.sandbox.pause();
      else await this.sandbox.destroy();
    } catch {
      // Teardown must not fail a build that otherwise succeeded.
    }
  }

  get url(): string | undefined {
    return this.publicBase;
  }
}

async function reachable(url: string): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
      if (res.ok) return true;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 800));
  }
  return false;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
