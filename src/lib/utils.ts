export const cn = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(" ");

export const fmt = (n: number | null | undefined, d = 2) =>
  n == null || Number.isNaN(n) ? "—" : n.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: 0 });

export const pct = (n: number | null | undefined, d = 1) => (n == null ? "—" : `${fmt(n, d)}%`);

export const dt = (d: Date | string | null | undefined) =>
  !d ? "—" : new Date(d).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }).replace(",", "");

export type StatusKey = "healthy" | "watch" | "critical" | "qualified" | "unknown" | "review";

export const STATUS_META: Record<string, { label: string; hex: string; text: string; bg: string; ring: string; dot: string }> = {
  healthy:   { label: "HEALTHY",   hex: "#34d399", text: "text-emerald-300", bg: "bg-emerald-400/10", ring: "border-emerald-400/30", dot: "bg-emerald-400" },
  watch:     { label: "WATCH",     hex: "#fbbf24", text: "text-amber-300",   bg: "bg-amber-400/10",   ring: "border-amber-400/30",   dot: "bg-amber-400" },
  critical:  { label: "CRITICAL",  hex: "#f87171", text: "text-red-300",     bg: "bg-red-400/10",     ring: "border-red-400/30",     dot: "bg-red-400" },
  review:    { label: "REVIEW",    hex: "#c084fc", text: "text-purple-300",  bg: "bg-purple-400/10",  ring: "border-purple-400/30",  dot: "bg-purple-400" },
  qualified: { label: "QUALIFIED", hex: "#38bdf8", text: "text-sky-300",     bg: "bg-sky-400/10",     ring: "border-sky-400/30",     dot: "bg-sky-400" },
  unknown:   { label: "UNKNOWN",   hex: "#8b95a5", text: "text-zinc-400",    bg: "bg-zinc-400/10",    ring: "border-zinc-500/30",    dot: "bg-zinc-500" },
};

export const DECISION_META: Record<string, { text: string; bg: string; ring: string }> = {
  PASS:         { text: "text-emerald-300", bg: "bg-emerald-400/10", ring: "border-emerald-400/25" },
  "PASS-EARLY": { text: "text-sky-300",     bg: "bg-sky-400/10",     ring: "border-sky-400/25" },
  WATCH:        { text: "text-amber-300",   bg: "bg-amber-400/10",   ring: "border-amber-400/25" },
  REVIEW:       { text: "text-purple-300",  bg: "bg-purple-400/10",  ring: "border-purple-400/25" },
  REJECT:       { text: "text-red-300",     bg: "bg-red-400/10",     ring: "border-red-400/25" },
  "EQUIP HOLD": { text: "text-cyan-300",    bg: "bg-cyan-400/10",    ring: "border-cyan-400/25" },
  "MANUAL QC":  { text: "text-zinc-300",    bg: "bg-zinc-400/10",    ring: "border-zinc-400/25" },
};

export const RISK_BANDS = "0–30 HEALTHY · 31–60 WATCH · 61–80 REVIEW · 81–100 CRITICAL";
