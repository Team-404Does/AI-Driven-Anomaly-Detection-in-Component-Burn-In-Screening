import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "CRIP — Component Reliability Intelligence Platform",
  description: "AI-driven anomaly detection in component burn-in & screening. SIH26170 prototype.",
};

export const dynamic = "force-dynamic";

// Bare document shell. The authenticated application chrome lives in (app)/layout.tsx
// so that /login can render without the sidebar and without touching the database.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`}>
      <body className="bg-ink font-sans text-snow antialiased">{children}</body>
    </html>
  );
}
