import { cn, STATUS_META, DECISION_META } from "@/lib/utils";
import type { ReactNode } from "react";

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn("rounded-lg border border-line bg-gradient-to-b from-panel to-[#0a0e13] shadow-[0_1px_0_rgba(255,255,255,0.03)_inset,0_8px_24px_-18px_rgb(0_0_0/0.8)]", className)}>
      {children}
    </div>
  );
}

export function CardHead({ title, sub, right }: { title: string; sub?: string; right?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-2.5">
      <div>
        <div className="text-[12px] font-medium tracking-wide text-snow">{title}</div>
        {sub && <div className="mt-0.5 text-[10.5px] text-fog">{sub}</div>}
      </div>
      {right}
    </div>
  );
}

export function Kpi({ label, value, sub, tone = "text-snow", spark, accent }: {
  label: string; value: ReactNode; sub?: ReactNode; tone?: string; spark?: ReactNode; accent?: string;
}) {
  return (
    <div
      className="kpi-accent card-hover rounded-lg border border-line bg-panel px-4 py-3"
      style={accent ? ({ ["--accent" as string]: accent } as React.CSSProperties) : undefined}
    >
      <div className="flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-[0.14em] text-fog">{label}</div>
        {spark}
      </div>
      <div className={cn("tabular mt-1.5 font-mono text-[26px] font-semibold leading-none", tone)}>{value}</div>
      {sub && <div className="mt-1.5 text-[10.5px] leading-snug text-fog">{sub}</div>}
    </div>
  );
}

export function StatusPill({ status, className }: { status?: string | null; className?: string }) {
  const m = STATUS_META[status ?? "unknown"] ?? STATUS_META.unknown;
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded border px-1.5 py-0.5 font-mono text-[10px] tracking-wide", m.bg, m.text, m.ring, className)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", m.dot)} />
      {m.label}
    </span>
  );
}

export function DecisionPill({ decision, className }: { decision?: string | null; className?: string }) {
  const m = DECISION_META[decision ?? "MANUAL QC"] ?? DECISION_META["MANUAL QC"];
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded border px-1.5 py-0.5 font-mono text-[10px] tracking-wide", m.bg, m.text, m.ring, className)}>
      {decision ?? "—"}
    </span>
  );
}

export function Meter({ value, max = 100, tone }: { value: number; max?: number; tone?: string }) {
  const p = Math.min(100, (value / max) * 100);
  const color = tone ?? (p > 80 ? "#f87171" : p > 60 ? "#c084fc" : p > 30 ? "#fbbf24" : "#34d399");
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#141b26]">
      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${p}%`, background: color }} />
    </div>
  );
}

export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("tabular font-mono", className)}>{children}</span>;
}

export function Tag({ children, tone = "text-fog" }: { children: ReactNode; tone?: string }) {
  return <span className={cn("rounded border border-line bg-panel2 px-1.5 py-0.5 font-mono text-[10px]", tone)}>{children}</span>;
}

export function Empty({ msg }: { msg: string }) {
  return <div className="flex h-28 items-center justify-center text-[12px] text-fog">{msg}</div>;
}

// ---- Chart explainability helpers ----

export type LegendItem =
  | { label: string; color: string; kind?: "swatch" }
  | { label: string; color: string; kind: "line" | "dash" | "band" }
  | { label: string; kind: "muted" };

/** Compact legend under a chart: swatch = filled marker, line/dash = stroke sample, band = translucent area. */
export function ChartLegend({ items, className }: { items: LegendItem[]; className?: string }) {
  return (
    <div className={cn("flex flex-wrap gap-x-4 gap-y-1 border-t border-line px-4 py-2", className)}>
      {items.map((it) => (
        <span key={it.label} className="flex items-center gap-1.5 text-[10px] text-fog">
          {it.kind === "muted" ? null : it.kind === "line" ? (
            <span className="h-0 w-4" style={{ borderTop: `2px solid ${it.color}` }} />
          ) : it.kind === "dash" ? (
            <span className="h-0 w-4" style={{ borderTop: `2px dashed ${it.color}` }} />
          ) : it.kind === "band" ? (
            <span className="h-2.5 w-4 rounded-[2px]" style={{ background: it.color, opacity: 0.4 }} />
          ) : (
            <span className="h-2 w-2 shrink-0 rounded-[2px]" style={{ background: it.color }} />
          )}
          {it.label}
        </span>
      ))}
    </div>
  );
}

/** "How to read this" explainer box shown beneath charts. */
export function ChartNote({ children, tone = "sky" }: { children: ReactNode; tone?: "sky" | "amber" | "purple" }) {
  const tones = {
    sky: "border-sky-400/20 bg-sky-400/[0.05] text-sky-100/80",
    amber: "border-amber-400/20 bg-amber-400/[0.05] text-amber-100/80",
    purple: "border-purple-400/20 bg-purple-400/[0.05] text-purple-100/80",
  };
  return (
    <div className={cn("mx-4 mb-3 rounded-md border p-2.5 text-[10.5px] leading-relaxed", tones[tone])}>
      <span className="font-medium uppercase tracking-wider opacity-70">How to read · </span>
      {children}
    </div>
  );
}

export function PageHead({ title, sub, right }: { title: string; sub?: string; right?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-[19px] font-semibold tracking-tight text-snow">{title}</h1>
        {sub && <p className="mt-0.5 max-w-3xl text-[12px] leading-relaxed text-fog">{sub}</p>}
      </div>
      {right}
    </div>
  );
}
