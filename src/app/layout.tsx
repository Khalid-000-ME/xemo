import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const sans = Geist({ subsets: ["latin"], variable: "--font-geist-sans" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });
const serif = Instrument_Serif({ subsets: ["latin"], weight: "400", style: ["normal", "italic"], variable: "--font-instrument-serif" });

export const metadata: Metadata = {
  title: "Xemo",
  description:
    "The gateway to the institutional blockchain ecosystem. One prompt launches a stablecoin, tokenization or prediction-market business, selling to humans over Stripe and to agents over x402.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} ${serif.variable}`}>
      <body className="min-h-dvh">
        <header className="relative z-20">
          <div className="mx-auto flex max-w-6xl items-center gap-6 px-6 py-5">
            <Link href="/" className="flex items-center gap-2.5 text-[17px] font-medium tracking-tight">
              <img src="/xemo-mark.png" alt="" width={32} height={32} className="size-8 shrink-0 rounded-[9px]" />
              Xemo
            </Link>
            <nav className="ml-auto flex items-center gap-1 text-[14px]">
              <Link
                href="/"
                className="rounded-full px-3.5 py-2 transition-colors hover:bg-[var(--bg-subtle)]"
                style={{ color: "var(--fg-muted)" }}
              >
                Build
              </Link>
              <Link
                href="/dashboard"
                className="rounded-full px-3.5 py-2 transition-colors hover:bg-[var(--bg-subtle)]"
                style={{ color: "var(--fg-muted)" }}
              >
                Economics
              </Link>
              <a
                href="/api/mcp"
                className="rounded-full px-3.5 py-2 font-mono text-[13px] transition-colors hover:bg-[var(--bg-subtle)]"
                style={{ color: "var(--fg-faint)" }}
              >
                /api/mcp
              </a>
            </nav>
          </div>
        </header>
        <main className="pb-24">{children}</main>
      </body>
    </html>
  );
}
