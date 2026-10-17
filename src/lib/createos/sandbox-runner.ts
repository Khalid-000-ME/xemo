import { createClient, type CreateosSandboxClient, type Sandbox } from "@nodeops-createos/sandbox";
import { env } from "@/lib/env";
import { APP_DIR, APP_PORT, HEALTH_PATH, type ExecOutcome, type Runner } from "./runner";

/**
 * Hosts the generated app may reach from inside the sandbox.
 *
 * Egress is deny-by-default once any rule is present, which is exactly what we
 * want for model-generated code. The list is built per build because the most
 * important entry is the platform's own host: a generated app holds no keys and
 * calls back here for checkout and fulfilment, so without it the storefront
 * cannot take an order.
 */
function egressAllowlist(): string[] {
  const rules = [
    "registry.npmjs.org:443",
    "*.npmjs.org:443",
    "api.stripe.com:443",
    "checkout.stripe.com:443",
  ];

  try {
    const platform = new URL(env.appUrl);
    const port = platform.port || (platform.protocol === "https:" ? "443" : "80");
    // A sandbox cannot reach the operator's loopback interface. Allowing it
    // would be meaningless, and the build log should say so instead.
    if (!/^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(platform.hostname)) {
      rules.push(`${platform.hostname}:${port}`);
    }
  } catch {
    // An unparseable app URL is reported by readiness(), not here.
  }

  return rules;
}

/** True when generated apps will not be able to call the platform back. */
export function platformReachableFromSandbox(): boolean {
  try {
    return !/^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(new URL(env.appUrl).hostname);
  } catch {
    return false;
  }
}

/**
 * CreateOS caps a sandbox name at 22 characters, which leaves no room for a
 * descriptive prefix beside a build id. Build ids already begin with `af_`, so
 * the id itself — with the underscore swapped for a hyphen — both fits and
 * identifies the sandboxes this platform owns.
 */
const NAME_PREFIX = "af-";
const NAME_MAX = 22;

export function sandboxName(buildId: string): string {
  const name = buildId.replace(/_/g, "-").toLowerCase().slice(0, NAME_MAX);
  if (!name.startsWith(NAME_PREFIX)) {
    // Never return a name capacity reclaim would not recognise as ours.
    return `${NAME_PREFIX}${name}`.slice(0, NAME_MAX);
  }
  return name;
}

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

/** A sandbox in any of these states no longer occupies a concurrency slot. */
const TERMINAL = new Set(["destroyed", "failed"]);

function occupiesSlot(status: string): boolean {
  return !TERMINAL.has(status);
}

/**
 * The Free plan allows a single concurrent sandbox, and every sandbox that is
 * not destroyed or failed counts — paused ones included. A create over the cap
 * fails with 429 rather than queueing, so room has to be made first.
 *
 * Destroying is not instantaneous: a sandbox passes through `destroying` while
 * still holding its slot. Reclaim therefore destroys and then *waits* for the
 * count to actually fall, instead of racing the control plane.
 */
async function reclaimCapacity(
  client: CreateosSandboxClient,
  cap: number,
  onNote?: (note: string) => void,
): Promise<void> {
  const deadline = Date.now() + 90_000;

  const occupied = async () => {
    const boxes = await client.listSandboxes();
    return boxes.filter((b) => occupiesSlot(b.status));
  };

  let current: Awaited<ReturnType<typeof occupied>>;
  try {
    current = await occupied();
  } catch {
    return; // If we cannot list, let create surface the real error.
  }

  if (current.length < cap) return;

  // Only ever reclaim sandboxes this platform created.
  const ours = current.filter(
    (b) => (b.name ?? "").startsWith(NAME_PREFIX) && b.status !== "destroying",
  );
  const needed = current.length - cap + 1;

  if (ours.length === 0) {
    onNote?.(
      `at the CreateOS concurrency cap (${current.length}/${cap}) and none of the running sandboxes ` +
        `belong to AgentFoundry, so none can be reclaimed`,
    );
    return;
  }

  let destroyed = 0;
  for (const box of ours.slice(0, needed)) {
    try {
      await box.destroy();
      destroyed++;
    } catch {
      // Best effort; the wait below decides whether it worked.
    }
  }
  if (destroyed > 0) onNote?.(`reclaiming ${destroyed} sandbox slot(s) to stay inside the plan cap`);

  // Wait for the slot to actually free: destroy returns before the control
  // plane has released it.
  while (Date.now() < deadline) {
    try {
      const after = await occupied();
      if (after.length < cap) return;
    } catch {
      return;
    }
    await new Promise((r) => setTimeout(r, 1500));
  }

  onNote?.(`still at the concurrency cap after waiting; the next create may fail with 429`);
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

    await reclaimCapacity(client, env.createos.maxConcurrent, onNote);

    const sandbox = await client.createSandbox({
      shape: env.createos.shape,
      rootfs: env.createos.rootfs,
      name: sandboxName(buildId),
      ingress_enabled: true,
      egress: egressAllowlist(),
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
   * A published app has to answer the moment the build reports it live, so a
   * successful build leaves the sandbox *running* rather than pausing it.
   *
   * Pausing here was wrong: a resume from snapshot takes long enough that the
   * first visitor — which during a demo is the person watching — gets
   * "Sandbox is waking up" on a URL just announced as live. Idle cleanup is
   * `auto_pause_after_seconds` instead, which only fires once traffic stops.
   */
  async dispose(opts?: { keepAlive?: boolean }): Promise<void> {
    if (opts?.keepAlive) return;
    try {
      await this.sandbox.destroy();
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
