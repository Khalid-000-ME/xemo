import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { env } from "@/lib/env";
import { APP_PORT, type ExecOutcome, type Runner } from "./runner";

/**
 * Fallback runner: a plain directory on this machine plus child processes.
 *
 * It is deliberately *not* a security boundary — it exists so the product is
 * demoable without a CreateOS key. Every build it produces is marked
 * `simulated` and the UI labels it. Untrusted input still only ever reaches
 * `node`, never a shell built from user text (see `exec`).
 */
export class LocalRunner implements Runner {
  readonly kind = "local" as const;
  readonly simulated = true;
  readonly appDir: string;
  private readonly startedAt = Date.now();
  private server?: ReturnType<typeof spawn>;

  constructor(readonly id: string) {
    this.appDir = resolve(process.cwd(), env.workspaceRoot, id);
  }

  static async create(id: string): Promise<LocalRunner> {
    const r = new LocalRunner(id);
    await mkdir(r.appDir, { recursive: true });
    return r;
  }

  async writeFile(relPath: string, content: string): Promise<void> {
    const target = join(this.appDir, relPath);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
  }

  exec(script: string, label?: string): Promise<ExecOutcome> {
    const started = Date.now();
    return new Promise((resolvePromise) => {
      const child = spawn("/bin/sh", ["-c", script], {
        cwd: this.appDir,
        env: { ...process.env, CI: "1" },
      });
      let stdout = "";
      let stderr = "";
      child.stdout?.on("data", (d) => (stdout += d.toString()));
      child.stderr?.on("data", (d) => (stderr += d.toString()));
      child.on("close", (code) =>
        resolvePromise({
          command: label ?? script,
          stdout: stdout.slice(-8000),
          stderr: stderr.slice(-8000),
          exitCode: code ?? 1,
          durationMs: Date.now() - started,
        }),
      );
      child.on("error", (err) =>
        resolvePromise({
          command: label ?? script,
          stdout,
          stderr: `${stderr}\n${err.message}`,
          exitCode: 127,
          durationMs: Date.now() - started,
        }),
      );
    });
  }

  async serve(port: number = APP_PORT): Promise<string> {
    this.server = spawn("node", ["server.mjs"], {
      cwd: this.appDir,
      env: { ...process.env, PORT: String(port) },
      detached: false,
      stdio: "ignore",
    });
    const base = `http://127.0.0.1:${port}`;
    await waitForHttp(base, 20_000);
    return base;
  }

  elapsedSeconds(): number {
    return (Date.now() - this.startedAt) / 1000;
  }

  async dispose(opts?: { keepAlive?: boolean }): Promise<void> {
    if (!opts?.keepAlive) {
      this.server?.kill("SIGTERM");
      await rm(this.appDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

async function waitForHttp(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr = "no attempt made";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}/healthz`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return;
      lastErr = `status ${res.status}`;
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`app did not become reachable at ${url}: ${lastErr}`);
}
