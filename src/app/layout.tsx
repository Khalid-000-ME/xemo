import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Xemo",
  description:
    "An agent that builds, deploys and monetizes a micro-SaaS from one prompt — selling to humans over Stripe and to agents over x402.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh">
        <header className="sticky top-0 z-20 border-b backdrop-blur" style={{ background: "color-mix(in srgb, var(--bg) 88%, transparent)" }}>
          <div className="mx-auto flex max-w-5xl items-center gap-5 px-4 py-3">
            <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
              <span
                aria-hidden
                className="grid size-6 place-items-center rounded-md text-[13px] font-bold text-white"
                style={{ background: "var(--brand)" }}
              >
                X
              </span>
              Xemo
            </Link>
            <nav className="ml-auto flex items-center gap-1 text-sm">
              <Link
                href="/"
                className="rounded-md px-2.5 py-1.5 transition-colors hover:bg-[var(--bg-subtle)]"
                style={{ color: "var(--fg-muted)" }}
              >
                Build
              </Link>
              <Link
                href="/dashboard"
                className="rounded-md px-2.5 py-1.5 transition-colors hover:bg-[var(--bg-subtle)]"
                style={{ color: "var(--fg-muted)" }}
              >
                Economics
              </Link>
              <a
                href="/api/mcp"
                className="rounded-md px-2.5 py-1.5 font-mono text-[13px] transition-colors hover:bg-[var(--bg-subtle)]"
                style={{ color: "var(--fg-faint)" }}
              >
                /api/mcp
              </a>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-5xl px-4 pb-24 pt-8">{children}</main>
      </body>
    </html>
  );
}
