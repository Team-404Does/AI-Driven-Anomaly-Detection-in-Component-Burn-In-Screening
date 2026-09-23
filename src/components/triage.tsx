"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { cn, fmt } from "@/lib/utils";
import { Card, CardHead, StatusPill, DecisionPill, Meter } from "@/components/ui";
import { CheckCircle2, XCircle, GitCommitHorizontal, FlaskConical, ChevronDown, Wrench, Eye } from "lucide-react";

export interface TriageRow {
  aid: number; code: string; score: number; severity: string; hour: number; confidence: number;
  status: string; decision: string | null; lot: string; wafer: string; socket: string; channel: string;
  driftRisk: string | null; hidden: boolean | null; signature: string | null; sigProb: number | null;
  staticSig: string | null; processed: boolean; feedbackLabel: string | null; ttl: number | null;
  riskScore: number; explanation: any;
}
const FILTERS = [
  { key: "all", label: "All flagged" },
  { key: "critical", label: "Critical only" },
  { key: "hidden", label: "Static-pass / AI-fail" },
  { key: "equip", label: "Equipment-correlated" },
  { key: "lot", label: "Same-lot clusters" },
];
const ACTIONS = [
  { label: "CONFIRMED_ANOMALY", text: "Confirm anomaly", icon: CheckCircle2, tone: "text-emerald-300 border-emerald-400/30 bg-emerald-400/10" },
  { label: "FALSE_POSITIVE", text: "False positive", icon: XCircle, tone: "text-red-300 border-red-400/30 bg-red-400/10" },
  { label: "WRONG_FAILURE_MODE", text: "Wrong failure mode", icon: GitCommitHorizontal, tone: "text-amber-300 border-amber-400/30 bg-amber-400/10" },
  { label: "NEEDS_MORE_TESTING", text: "Needs more testing", icon: FlaskConical, tone: "text-sky-300 border-sky-400/30 bg-sky-400/10" },
];

export default function Triage({ rows, events, initialMode, batchCode }: { rows: TriageRow[]; events: any[]; initialMode: string; batchCode: string }) {
  const [mode, setMode] = useState(initialMode === "hidden" ? "hidden" : "all");
  const [expand, setExpand] = useState<number | null>(null);
  const [labels, setLabels] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState<number | null>(null);

  const filtered = useMemo(() => rows.filter((r) => {
    if (mode === "critical") return r.severity === "CRITICAL" || r.riskScore > 80;
    if (mode === "hidden") return r.hidden;
    if (mode === "equip") return r.decision === "EQUIP HOLD";
    if (mode === "lot") return rows.filter((x) => x.lot === r.lot).length >= 4;
    return true;
  }), [rows, mode]);

  const hiddenRows = rows.filter((r) => r.hidden);

  const submit = async (r: TriageRow, label: string) => {
    setSaving(r.aid);
    try {
      await fetch("/api/feedback", { method: "POST", body: JSON.stringify({ componentCode: r.code, label, userName: "R. Nair" }) });
      setLabels((p) => ({ ...p, [r.aid]: label }));
    } finally { setSaving(null); }
  };

  return (
    <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1fr_300px]">
      <Card>
        <CardHead
          title={`Queue — ${filtered.length} ranked anomalies`}
          sub={`${batchCode} · PRES-IF v1.4 · threshold 0.60`}
          right={
            <div className="flex gap-1">
              {FILTERS.map((f) => (
                <button key={f.key} onClick={() => setMode(f.key)}
                  className={cn("rounded border px-2 py-1 text-[10.5px] transition-colors",
                    mode === f.key ? "border-sky-400/40 bg-sky-400/10 text-sky-200" : "border-line bg-panel2 text-fog hover:text-snow")}>
                  {f.label}{f.key === "hidden" ? ` (${hiddenRows.length})` : ""}
                </button>
              ))}
            </div>
          }
        />
        <table className="w-full text-[11.5px]">
          <thead>
            <tr className="border-b border-line text-left text-[10px] uppercase tracking-wider text-fog">
              {["Prio", "Component", "AS", "Drift risk", "Failure signature", "Context", "Conf", "Action", ""].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-line/60">
            {filtered.map((r, i) => {
              const label = labels[r.aid] ?? r.feedbackLabel;
              const eq = r.decision === "EQUIP HOLD";
              return [
                <tr key={r.aid} className={cn("transition-colors hover:bg-panel2", r.hidden && "bg-purple-400/[0.04]")}>
                  <td className="px-3 py-2.5 font-mono text-[10px] text-fog">#{i + 1}</td>
                  <td className="px-3 py-2.5">
                    <Link href={`/components/${r.code}`} className="flex items-center gap-1.5 font-mono text-sky-300 hover:text-sky-200">
                      {r.code}
                      {r.hidden && <span className="rounded border border-purple-400/30 bg-purple-400/10 px-1 py-px font-mono text-[9px] text-purple-300">STATIC PASS</span>}
                    </Link>
                    <div className="font-mono text-[9.5px] text-fog">{r.socket} · {r.lot}</div>
                  </td>
                  <td className="px-3 py-2.5"><div className="flex items-center gap-2"><Meter value={r.score * 100} /><span className={cn("tabular font-mono text-[11px]", r.score >= 0.85 ? "text-red-300" : "text-amber-300")}>{r.score.toFixed(2)}</span></div></td>
                  <td className={cn("px-3 py-2.5 font-mono text-[10.5px]", r.driftRisk === "HIGH" ? "text-red-300" : r.driftRisk === "MEDIUM" ? "text-amber-300" : "text-fog")}>{r.driftRisk ?? "—"}{r.ttl != null && r.ttl < 500 ? <div className="text-[9px] text-fog">TTL ~{Math.round(r.ttl)}h</div> : null}</td>
                  <td className="max-w-[190px] px-3 py-2.5">
                    <div className="truncate text-[11px] text-snow">{r.signature ?? "—"}</div>
                    {r.sigProb != null && <div className="font-mono text-[9px] text-fog">{r.sigProb}% candidate</div>}
                  </td>
                  <td className="px-3 py-2.5">
                    {eq ? <span className="flex items-center gap-1 font-mono text-[10px] text-cyan-300"><Wrench size={10} /> {r.channel} cohort</span>
                      : r.explanation?.lotCorrelation ? <span className="font-mono text-[10px] text-amber-300">{r.lot} cluster</span>
                      : <span className="font-mono text-[10px] text-fog">isolated</span>}
                  </td>
                  <td className="tabular px-3 py-2.5 font-mono text-[10.5px] text-fog">{Math.round(r.confidence * 100)}%</td>
                  <td className="px-3 py-2.5">
                    {label ? <span className="rounded border border-line2 bg-panel2 px-1.5 py-0.5 font-mono text-[9.5px] text-emerald-300">✓ {label.replaceAll("_", " ")}</span> : (
                      <div className="flex gap-1">
                        {ACTIONS.map((a) => (
                          <button key={a.label} title={a.text} disabled={saving === r.aid} onClick={() => submit(r, a.label)}
                            className={cn("rounded border p-1 transition-opacity hover:opacity-100 disabled:opacity-40", a.tone, "opacity-70")}>
                            <a.icon size={12} />
                          </button>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <button onClick={() => setExpand(expand === r.aid ? null : r.aid)} className="text-fog hover:text-snow">
                      <ChevronDown size={13} className={cn("transition-transform", expand === r.aid && "rotate-180")} />
                    </button>
                  </td>
                </tr>,
                expand === r.aid && (
                  <tr key={`${r.aid}-x`} className="bg-panel2/60">
                    <td colSpan={9} className="px-6 py-3">
                      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                        <div>
                          <div className="mb-1.5 text-[10px] uppercase tracking-widest text-fog">Why flagged — feature contribution</div>
                          <div className="space-y-1">
                            {(r.explanation?.contributions ?? []).slice(0, 4).map((c: any) => (
                              <div key={c.name} className="flex items-center gap-2 text-[10.5px]">
                                <span className="w-40 truncate text-fog">{c.name}</span>
                                <div className="h-1 flex-1 overflow-hidden rounded bg-[#141b26]"><div className="h-full bg-amber-400/70" style={{ width: `${Math.min(100, c.pct)}%` }} /></div>
                                <span className="w-14 text-right font-mono text-[10px] text-snow">{c.pct >= 66 ? "HIGH" : c.pct >= 30 ? "MED" : "LOW"}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                        <div>
                          <div className="mb-1.5 text-[10px] uppercase tracking-widest text-fog">Static vs dynamic</div>
                          <div className="flex items-center gap-2 text-[11px]">
                            <span className={cn("rounded border px-1.5 py-0.5 font-mono text-[10px]", r.staticSig?.includes("STATIC PASS") ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300" : "border-red-400/30 bg-red-400/10 text-red-300")}>{r.explanation?.staticResult ?? "—"}</span>
                            <span className="text-fog">/</span>
                            <span className="rounded border border-red-400/30 bg-red-400/10 px-1.5 py-0.5 font-mono text-[10px] text-red-300">DYNAMIC ANOMALOUS</span>
                          </div>
                          <div className="mt-2 font-mono text-[10px] text-fog">onset T+{fmt(r.hour, 0)}h · anomaly id A-{r.aid}</div>
                        </div>
                        <div>
                          <div className="mb-1.5 text-[10px] uppercase tracking-widest text-fog">Counterfactual (model-derived)</div>
                          <div className="text-[10.5px] leading-relaxed text-fog">{r.explanation?.counterfactual ?? "Beyond simple threshold suggestion — inspect telemetry."}</div>
                          <Link href={`/components/${r.code}`} className="mt-2 inline-flex items-center gap-1 text-[11px] text-sky-300 hover:underline"><Eye size={11} /> open passport</Link>
                        </div>
                      </div>
                    </td>
                  </tr>
                ),
              ];
            })}
          </tbody>
        </table>
      </Card>

      <div className="space-y-3">
        <Card>
          <CardHead title="Equipment-fault discrimination" sub="cohort correlation engine" />
          <div className="space-y-2 p-3">
            {events.map((e) => (
              <div key={e.id} className="rounded-md border border-line bg-panel2 p-2.5">
                <div className="flex items-center gap-2">
                  <Wrench size={11} className="text-cyan-300" />
                  <span className="font-mono text-[10.5px] text-cyan-200">{e.type}</span>
                  <span className="ml-auto font-mono text-[10px] text-fog">{e.affected} units</span>
                </div>
                <div className="mt-1 text-[10px] leading-relaxed text-fog">{e.assessment}</div>
              </div>
            ))}
            {events.length === 0 && <div className="p-2 text-[11px] text-fog">No correlated equipment events.</div>}
          </div>
        </Card>
        <Card>
          <CardHead title="Invisible failures" sub="static PASS · dynamic ANOMALOUS" />
          <div className="space-y-2 p-3">
            {hiddenRows.slice(0, 4).map((r) => (
              <Link key={r.aid} href={`/components/${r.code}`} className="block rounded-md border border-purple-400/25 bg-purple-400/[0.07] p-2.5 transition-colors hover:bg-purple-400/[0.12]">
                <div className="flex items-center justify-between font-mono text-[11px]">
                  <span className="text-purple-200">{r.code}</span>
                  <span className="text-purple-300/80">AS {r.score.toFixed(2)}</span>
                </div>
                <div className="mt-1 text-[10px] leading-relaxed text-fog">
                  +{fmt(r.explanation?.contributions?.[0]?.value ?? 0, 1)}σ vs peer distribution · predicted risk {r.driftRisk} → MANUAL REVIEW
                </div>
              </Link>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
