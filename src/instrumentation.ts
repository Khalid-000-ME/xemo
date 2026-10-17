/**
 * Runs once when the server starts.
 *
 * The schema is created here rather than at import time because applying it to
 * a remote database is asynchronous, and top-level await in a module the whole
 * app imports is a bundling risk. Every statement is `IF NOT EXISTS`, so a cold
 * start against an already-populated database costs one cheap round trip.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { ensureSchema } = await import("@/lib/db");
  try {
    await ensureSchema();
  } catch (error) {
    // Do not crash the server: it must still be able to report /api/capabilities
    // and explain what is wrong. Queries will fail loudly on their own.
    console.error(
      `[xemo] could not apply the database schema: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
