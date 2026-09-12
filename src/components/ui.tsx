import { cn, STATUS_META, DECISION_META } from "@/lib/utils";
import type { ReactNode } from "react";

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn("rounded-lg border border-line bg-panel shadow-[0_1px_0_rgba(255,255,255,0.02)_inset]", className)}>
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

export function Kpi({ label, value, sub, tone = "text-snow", spark }: {
  label: string; value: ReactNode; sub?: ReactNode; tone?: string; spark?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-line bg-panel px-4 py-3">
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
