import { NextResponse } from "next/server";

export type ApiError = { error: { code: string; message: string; [k: string]: unknown } };

export function fail(status: number, code: string, message: string, extra?: Record<string, unknown>) {
  return NextResponse.json<ApiError>({ error: { code, message, ...extra } }, { status });
}

export function ok<T>(body: T, status = 200) {
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
}

export function numOr(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}
