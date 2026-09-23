import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Shell } from "@/components/nav";
import { ensureSeeded } from "@/lib/seed";
import { getBatches } from "@/lib/queries";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "CRIP — Component Reliability Intelligence Platform",
  description: "AI-driven anomaly detection in component burn-in & screening. SIH26170 prototype.",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: ReactNode }) {
  await ensureSeeded();
  const batches = (await getBatches()).map((b) => ({ id: b.id, batchCode: b.batchCode, status: b.status, componentCount: b.componentCount }));
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`}>
      <body className="bg-ink font-sans text-snow antialiased">
        <Shell batches={batches}>{children}</Shell>
      </body>
    </html>
  );
}
