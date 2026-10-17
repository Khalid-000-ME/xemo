/**
 * Execution surface for a build.
 *
 * Two implementations share one interface: a real CreateOS Firecracker sandbox,
 * and a local child-process runner used when no CreateOS key is present. The
 * orchestrator is written against the interface so a demo never dead-ends on a
 * missing credential — it just reports `simulated: true` and says so in the UI.
 */

export type ExecOutcome = {
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
};

export interface Runner {
  readonly kind: "createos" | "local";
  readonly id: string;
  /** True when this is not a real CreateOS sandbox. */
  readonly simulated: boolean;
  /** Absolute path inside the runner where the app lives. */
  readonly appDir: string;

  writeFile(relPath: string, content: string): Promise<void>;
  exec(script: string, label?: string): Promise<ExecOutcome>;
  /** Start the app's HTTP server and return a publicly reachable base URL. */
  serve(port: number): Promise<string>;
  /** Seconds of wall-clock compute consumed, for the cost ledger. */
  elapsedSeconds(): number;
  dispose(opts?: { keepAlive?: boolean }): Promise<void>;
}

export const APP_DIR = "/root/app";
export const APP_PORT = 8080;

/**
 * The generated app's own health path.
 *
 * Deliberately not `/healthz`: the CreateOS ingress reserves that path and
 * answers it itself, so a probe there confirms the ingress is routing and says
 * nothing about whether the app process is alive.
 */
export const HEALTH_PATH = "/_af/health";
