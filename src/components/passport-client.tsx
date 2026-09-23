"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cn, fmt, dt } from "@/lib/utils";
import { Card, CardHead, StatusPill, DecisionPill, Meter, Tag } from "@/components/ui";
import EChart, { AXIS, TOOLTIP } from "@/components/echart";
import Replay from "@/components/replay";
import {
  FileText, ShieldCheck, Wrench, AlertTriangle, CheckCircle2, XCircle,
  GitCommitHorizontal, FlaskConical, Printer,
} from "lucide-react";

const TABS = ["Summary", "Telemetry", "Drift Forecast", "Explanation", "Lot / Wafer", "Replay", "Test History", "Feedback", "Reports", "Audit"];
const FEEDBACK = [
  { label: "CONFIRMED_ANOMALY", text: "Confirm", icon: CheckCircle2, tone: "text-emerald-300 border-emerald-400/30 bg-emerald-400/10" },
  { label: "FALSE_POSITIVE", text: "False positive", icon: XCircle, tone: "text-red-300 border-red-400/30 bg-red-400/10" },
  { label: "WRONG_FAILURE_MODE", text: "Wrong mode", icon: GitCommitHorizontal, tone: "text-amber-300 border-amber-400/30 bg-amber-400/10" },
  { label: "NEEDS_MORE_TESTING", text: "More testing", icon: FlaskConical, tone: "text-sky-300 border-sky-400/30 bg-sky-400/10" },
];

export default function PassportClient(props: any) {
  const { comp, tel, peer, corridor, anomaly, pred, sig, risk, lotInfo, feedbacks, reports, audits } = props;
  const router = useRouter();
  const [tab, setTab] = useState("Summary");
  const [param, setParam] = useState<"l" | "v" | "r">("l");
  const [fbMsg, setFbMsg] = useState<string | null>(null);
  const [reportMsg, setReportMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const PLABELS: Record<"l" | "v" | "r", string> = { l: "Leakage current (µA)", v: "Threshold voltage (mV)", r: "On-resistance (mΩ)" };
  const PUNITS: Record<"l" | "v" | "r", string> = { l: "µA", v: "mV", r: "mΩ" };
  const pLabel = PLABELS[param];
  const pUnit = PUNITS[param];
  const vals = tel.map((t: any) => t[param]).filter((x: any) => x != null);
  const limit = param === "l" ? 5 : null;

  const telOpt = useMemo(() => ({
    grid: { left: 48, right: 14, top: 30, bottom: 40 },
    tooltip: { ...TOOLTIP, trigger: "axis" },
    legend: { textStyle: { color: "#8b95a5", fontSize: 10 }, top: 2 },
    xAxis: { type: "category", data: tel.map((t: any) => t.h), ...AXIS, name: "hour" },
    yAxis: { type: "value", ...AXIS, name: pUnit, scale: true },
    dataZoom: [{ type: "inside" }, { type: "slider", height: 14, bottom: 8, borderColor: "#243042", backgroundColor: "#0b0f14", fillerColor: "rgba(56,189,248,0.12)", textStyle: { color: "#8b95a5", fontSize: 9 } }],
    series: [
      param === "l" && {
        name: "Population median", type: "line", showSymbol: false, data: corridor.map((c: any) => c.med),
        lineStyle: { color: "#38bdf8", width: 1, type: "dashed" },
      },
      param === "l" && {
        name: "P16–P84 corridor", type: "line", showSymbol: false, data: corridor.map((c: any) => c.p16),
        lineStyle: { width: 0 }, stack: "corr", areaStyle: { color: "rgba(56,189,248,0.05)" },
      },
      param === "l" && {
        name: "", type: "line", showSymbol: false, data: corridor.map((c: any) => +(c.p84 - c.p16).toFixed(3)),
        lineStyle: { width: 0 }, stack: "corr", areaStyle: { color: "rgba(56,189,248,0.10)" },
      },
      {
        name: "Observed", type: "line", showSymbol: false, data: tel.map((t: any) => t[param] != null ? +(t[param]).toFixed(3) : null),
        connectNulls: false, lineStyle: { color: "#e2e8f0", width: 1.6 },
        markLine: {
          silent: true, symbol: "none",
          data: [
            ...(limit ? [{ yAxis: limit, lineStyle: { color: "#f87171", type: "dashed" as const }, label: { color: "#f87171", formatter: "STATIC LIMIT 5.0", fontSize: 9, position: "insideEndTop" as const } }] : []),
            ...(anomaly ? [{ xAxis: String(anomaly.hour), lineStyle: { color: "#fb923c" }, label: { color: "#fb923c", formatter: `onset T+${anomaly.hour}h`, fontSize: 9 } }] : []),
          ],
        },
      },
    ].filter(Boolean),
  }), [tel, corridor, param, anomaly, limit, pUnit]);

  const fcOpt = useMemo(() => pred ? ({
    grid: { left: 48, right: 14, top: 30, bottom: 26 },
    tooltip: { ...TOOLTIP, trigger: "axis" },
    legend: { textStyle: { color: "#8b95a5", fontSize: 10 }, top: 2 },
    xAxis: { type: "value", min: 0, max: 336, ...AXIS, name: "hour", nameLocation: "middle" as const, nameGap: 22 },
    yAxis: { type: "value", ...AXIS, name: "µA (physics-normalized)", scale: true },
    series: [
      { name: "Observed", type: "line", showSymbol: false, data: tel.filter((t: any) => t.l != null).map((t: any) => [t.h, +t.l.toFixed(3)]), lineStyle: { color: "#e2e8f0", width: 1.5 } },
      { name: "PI lower", type: "line", showSymbol: false, data: pred.curve.map((c: any) => [c.hour, c.lo]), lineStyle: { width: 0 }, stack: "pi" },
      { name: "95% interval", type: "line", showSymbol: false, data: pred.curve.map((c: any) => +(c.hi - c.lo).toFixed(3)), lineStyle: { width: 0 }, stack: "pi", areaStyle: { color: "rgba(192,132,252,0.14)" } },
      { name: "Projected", type: "line", showSymbol: false, data: pred.curve.map((c: any) => [c.hour, c.pred]), lineStyle: { color: "#c084fc", width: 1.8, type: "dashed" } },
    ],
  }) : null, [pred, tel]);

  const histRows = useMemo(() => {
    const rows: { range: string; h0: number; state: string; leak: string; note: string }[] = [];
    for (let h = 0; h <= 168; h += 24) {
      const seg = tel.filter((t: any) => t.h >= h && t.h < h + 24 && t.l != null);
      const mx = seg.length ? Math.max(...seg.map((t: any) => t.l!)) : null;
      let state = "NORMAL";
      if (mx != null && mx > 5) state = "CRITICAL";
      else if (mx != null && mx > 3.8) state = "WATCH";
      else if (anomaly && h >= anomaly.hour) state = "ANOMALOUS";
      rows.push({ range: `T+${h}–${h + 24}h`, h0: h, state, leak: mx != null ? mx.toFixed(2) + " µA" : "no data", note: state === "CRITICAL" ? "static limit breached" : state === "ANOMALOUS" ? "dynamic flag window" : "—" });
    }
    return rows;
  }, [tel, anomaly]);

  const sendFeedback = async (label: string) => {
    setBusy(true);
    await fetch("/api/feedback", { method: "POST", body: JSON.stringify({ componentCode: comp.code, label, userName: "R. Nair" }) });
    setFbMsg(`Stored “${label.replaceAll("_", " ")}” in the controlled feedback queue (no automatic retraining).`);
    setBusy(false); router.refresh();
  };
  const genReport = async (type: string) => {
    setBusy(true);
    const r = await fetch("/api/reports", { method: "POST", body: JSON.stringify({ componentCode: comp.code, type }) }).then((x) => x.json());
    setBusy(false);
    if (r.id) setReportMsg(`${r.code} generated`);
    router.refresh();
  };

  const riskBands = [["0–30", "HEALTHY", "#34d399"], ["31–60", "WATCH", "#fbbf24"], ["61–80", "REVIEW", "#c084fc"], ["81–100", "CRITICAL", "#f87171"]];

  return (
    <div className="fade-in space-y-3">
      {/* passport header */}
      <Card className="border-line2/70">
        <div className="grid grid-cols-1 gap-4 p-4 lg:grid-cols-[300px_1fr_auto]">
          <div className="rounded-md border border-line bg-[#0a0e13] p-3.5 font-mono text-[11.5px] leading-[1.75]">
            <div className="text-[14px] font-semibold tracking-wider text-sky-300">{comp.code}</div>
            <div className="my-1 border-t border-dashed border-line2" />
            <div className="grid grid-cols-[104px_1fr] gap-x-2 text-fog">
              <span>Manufacturer</span><span className="text-snow">{comp.mfr}</span>
              <span>Lot</span><span className="text-snow">{comp.lot}</span>
              <span>Wafer</span><span className="text-snow">{comp.wafer}</span>
              <span>Socket</span><span className="text-snow">{comp.socket} · {comp.channel}</span>
              <span>Status</span><span className="text-snow">{comp.decision}</span>
              <span>Model</span><span className="text-snow">PRES-IF v1.4</span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["Health score", `${comp.health ?? "—"}/100`, "text-snow"],
              ["Anomaly score", fmt(comp.as), (comp.as ?? 0) >= 0.6 ? "text-red-300" : "text-emerald-300"],
              ["Drift risk", comp.driftRisk ?? "—", comp.driftRisk === "HIGH" ? "text-red-300" : comp.driftRisk === "MEDIUM" ? "text-amber-300" : "text-emerald-300"],
              ["168h forecast", pred ? `${fmt(pred.pv)} µA` : "—", (pred?.hi ?? 0) > 4.5 ? "text-red-300" : "text-snow"],
            ].map(([k, v, t]) => (
              <div key={k as string} className="rounded-md border border-line bg-panel2 p-3">
                <div className="text-[9px] uppercase tracking-[0.14em] text-fog">{k}</div>
                <div className={cn("tabular mt-1 font-mono text-[17px]", t)}>{v}</div>
              </div>
            ))}
          </div>
          <div className="flex flex-col items-end justify-between gap-2">
            <div className="flex items-center gap-2"><StatusPill status={comp.status} /><DecisionPill decision={comp.decision} /></div>
            {comp.hidden && <Tag tone="text-purple-300 border-purple-400/30 bg-purple-400/10">STATIC PASS · DYNAMIC FAIL</Tag>}
            <button onClick={() => genReport("NCR")} disabled={busy} className="flex items-center gap-1.5 rounded-md border border-red-400/30 bg-red-400/10 px-2.5 py-1.5 text-[11px] text-red-200 hover:bg-red-400/15 disabled:opacity-50">
              <FileText size={12} /> Generate NCR-style report
            </button>
          </div>
        </div>
      </Card>

      {/* tabs */}
      <div className="flex flex-wrap gap-1">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={cn("rounded-md border px-2.5 py-1.5 text-[11px] transition-colors",
              tab === t ? "border-sky-400/40 bg-sky-400/10 text-sky-200" : "border-line bg-panel text-fog hover:text-snow")}>
            {t}
          </button>
        ))}
      </div>

      {tab === "Summary" && (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
          <Card className="xl:col-span-2">
            <CardHead title="Deterministic risk assessment" sub="risk engine vR1 · thresholds 30 / 60 / 80" />
            <div className="p-4">
              <div className="flex items-center gap-4">
                <div className="tabular font-mono text-[34px] text-snow">{risk?.score ?? "—"}</div>
                <div className="flex-1">
                  <Meter value={risk?.score ?? 0} />
                  <div className="mt-1.5 flex justify-between">
                    {riskBands.map(([b, l, c]) => (
                      <div key={l} className="text-center"><div className="text-[9px] font-mono" style={{ color: c as string }}>{l}</div><div className="text-[8.5px] font-mono text-fog">{b}</div></div>
                    ))}
                  </div>
                </div>
                <DecisionPill decision={risk?.decision} className="px-3 py-1.5 text-[12px]" />
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-3">
                {risk?.reasons?.inputs && Object.entries({
                  "Anomaly score": fmt(risk.reasons.inputs.anomalyScore),
                  "Drift risk": risk.reasons.inputs.driftRisk,
                  "Static result": risk.reasons.inputs.staticResult,
                  "Lot correlation": risk.reasons.inputs.lotCorrelation ? "YES" : "no",
                  "Equipment correlation": risk.reasons.inputs.equipmentCorrelation ? "YES" : "no",
                  "Missing telemetry": `${risk.reasons.inputs.missingPct}%`,
                }).map(([k, v]) => (
                  <div key={k} className="rounded border border-line bg-panel2 px-2.5 py-2">
                    <div className="text-[9px] uppercase tracking-wider text-fog">{k}</div>
                    <div className="mt-0.5 font-mono text-[12px] text-snow">{String(v)}</div>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-[11.5px] leading-relaxed text-fog">{risk?.reasons?.summary}</p>
              {risk?.reasons?.counterfactual && (
                <p className="mt-2 rounded border border-line bg-panel2 p-2 text-[11px] leading-relaxed text-fog">{risk.reasons.counterfactual.text}</p>
              )}
            </div>
          </Card>
          <div className="space-y-3">
            <Card>
              <CardHead title="Confidence envelope" />
              <div className="space-y-2.5 p-4">
                {[["Detector confidence", anomaly?.confidence ?? 0.5], ["Forecast confidence", pred?.conf ?? 0.5], ["Model freshness", 0.93]].map(([k, v]) => (
                  <div key={k as string}>
                    <div className="mb-1 flex justify-between text-[10.5px]"><span className="text-fog">{k}</span><span className="font-mono text-snow">{Math.round((v as number) * 100)}%</span></div>
                    <Meter value={(v as number) * 100} tone="#38bdf8" />
                  </div>
                ))}
                <p className="pt-1 font-mono text-[10px] leading-relaxed text-fog">PRES-IF v1.4 · DRIFT-LIN v2.1 · DS-SYN-2026-0142<br />Low-confidence + high-risk cases are routed to human review automatically.</p>
              </div>
            </Card>
            {sig && (
              <Card>
                <CardHead title="Candidate failure signature" sub="requires engineering validation" />
                <div className="p-4">
                  <div className="font-mono text-[13px] text-amber-200">{sig.top}</div>
                  <div className="mt-1 font-mono text-[10px] text-fog">{sig.prob}% · confidence {sig.conf}</div>
                  <div className="mt-2 space-y-1">
                    {(sig.evidence ?? []).map((e: string) => <div key={e} className="flex gap-1.5 text-[10.5px] text-fog"><span className="text-amber-300">–</span>{e}</div>)}
                  </div>
                </div>
              </Card>
            )}
          </div>
        </div>
      )}

      {tab === "Telemetry" && (
        <Card>
          <CardHead
            title="Telemetry explorer"
            sub="never hide the raw signal behind an AI score — observed vs population corridor vs static limits"
            right={
              <div className="flex gap-1">
                {(["l", "v", "r"] as const).map((p) => (
                  <button key={p} onClick={() => setParam(p)} className={cn("rounded border px-2 py-1 font-mono text-[10px]", param === p ? "border-sky-400/40 bg-sky-400/10 text-sky-200" : "border-line bg-panel2 text-fog")}>
                    {PLABELS[p].split(" ")[0]}
                  </button>
                ))}
              </div>
            }
          />
          <EChart option={telOpt} height={330} />
          <div className="flex flex-wrap gap-x-5 gap-y-1 border-t border-line px-4 py-2 font-mono text-[10px] text-fog">
            <span>n={vals.length} valid samples</span><span>max {fmt(Math.max(...vals))} {pUnit}</span><span>min {fmt(Math.min(...vals))} {pUnit}</span>
            <span className="text-amber-300">scroll/pinch chart to zoom · slider below</span>
          </div>
        </Card>
      )}

      {tab === "Drift Forecast" && pred && (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
          <Card className="xl:col-span-2">
            <CardHead title="168h drift forecast — leakage (physics-normalized)" sub="DRIFT-LIN v2.1 · least-squares + prediction interval · model-derived estimate" />
            <EChart option={fcOpt} height={320} />
          </Card>
          <Card>
            <CardHead title="Forecast readout" />
            <div className="space-y-2 p-4">
              {[["Predicted @336h", `${fmt(pred.pv)} µA`], ["95% interval", `${fmt(pred.lo)} – ${fmt(pred.hi)} µA`], ["Rate of change", `${fmt(pred.slope, 4)} µA/24h`], ["Est. time-to-limit", pred.ttl ? `~${Math.round(pred.ttl)}h` : "> horizon"], ["Drift risk", comp.driftRisk], ["Confidence", `${Math.round((pred.conf ?? 0) * 100)}%`]].map(([k, v]) => (
                <div key={k as string} className="flex justify-between border-b border-line/60 pb-1.5 text-[11.5px]"><span className="text-fog">{k}</span><span className="font-mono text-snow">{v}</span></div>
              ))}
              <div className="rounded border border-amber-400/25 bg-amber-400/10 p-2 text-[10px] leading-relaxed text-amber-200/90">
                Projection beyond the 168h test window is a model-derived estimate — not a guaranteed mission-year claim. Only physically validated parameters are extrapolated.
              </div>
            </div>
          </Card>
        </div>
      )}

      {tab === "Explanation" && (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          <Card>
            <CardHead title="Why was this flagged?" sub="feature-contribution explanation for PRES-IF" />
            <div className="space-y-2.5 p-4">
              {(comp.feature?.contributions ?? []).map((c: any) => (
                <div key={c.name} className="flex items-center gap-3">
                  <span className="w-44 truncate text-[11px] text-fog">{c.name}</span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded bg-[#141b26]"><div className="h-full rounded bg-amber-400/70" style={{ width: `${Math.min(100, c.pct)}%` }} /></div>
                  <span className={cn("w-16 text-right font-mono text-[10px]", c.pct >= 66 ? "text-red-300" : c.pct >= 30 ? "text-amber-300" : "text-fog")}>{c.pct >= 66 ? "HIGH" : c.pct >= 30 ? "MEDIUM" : "LOW"}</span>
                </div>
              ))}
              {!anomaly && <p className="text-[11px] text-fog">Not flagged — all contributions within population envelope.</p>}
            </div>
          </Card>
          <Card>
            <CardHead title="Static vs dynamic + counterfactual" />
            <div className="space-y-3 p-4">
              <div className="flex items-center gap-2 text-[12px]">
                <span className={cn("rounded border px-2 py-1 font-mono text-[11px]", comp.staticResult === "PASS" ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300" : "border-red-400/30 bg-red-400/10 text-red-300")}>STATIC: {comp.staticResult}</span>
                <span className="text-fog">→</span>
                <span className={cn("rounded border px-2 py-1 font-mono text-[11px]", comp.dynamicResult === "ANOMALOUS" ? "border-red-400/30 bg-red-400/10 text-red-300" : "border-emerald-400/30 bg-emerald-400/10 text-emerald-300")}>DYNAMIC: {comp.dynamicResult}</span>
              </div>
              <p className="text-[11.5px] leading-relaxed text-fog">{risk?.reasons?.counterfactual?.text ?? "Unit sits inside both static limits and the dynamic envelope; no counterfactual required."}</p>
              {anomaly?.explanation?.equipmentCorrelation && (
                <div className="flex gap-2 rounded border border-cyan-400/25 bg-cyan-400/10 p-2.5 text-[11px] text-cyan-200">
                  <Wrench size={13} className="mt-0.5 shrink-0" /> Equipment-correlated cohort — component evidence is weak; investigate channel before dispositioning.
                </div>
              )}
              <div className="font-mono text-[10px] text-fog">Counterfactuals are model-derived suggestions, not engineering prescriptions.</div>
            </div>
          </Card>
        </div>
      )}

      {tab === "Lot / Wafer" && (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          <Card>
            <CardHead title={`${comp.lot} context`} sub="status composition of the lot" />
            <div className="space-y-2 p-4">
              {lotInfo.rows.map((r: any) => (
                <div key={r.status} className="flex items-center gap-2">
                  <StatusPill status={r.status} className="w-24 justify-center" />
                  <div className="h-1.5 flex-1 overflow-hidden rounded bg-[#141b26]"><div className="h-full bg-sky-400/50" style={{ width: `${(r.n / lotInfo.rows.reduce((a: number, x: any) => a + x.n, 0)) * 100}%` }} /></div>
                  <span className="w-10 text-right font-mono text-[11px] text-snow">{r.n}</span>
                </div>
              ))}
              <div className="mt-3 grid grid-cols-2 gap-2">
                <div className="rounded border border-line bg-panel2 p-2.5"><div className="text-[9px] uppercase tracking-wider text-fog">Lot mean anomaly score</div><div className="tabular mt-0.5 font-mono text-[15px] text-snow">{lotInfo.avgScore}</div></div>
                <div className="rounded border border-line bg-panel2 p-2.5"><div className="text-[9px] uppercase tracking-wider text-fog">Lot mean drift /24h</div><div className="tabular mt-0.5 font-mono text-[15px] text-snow">{lotInfo.avgDrift} µA</div></div>
              </div>
            </div>
          </Card>
          <Card>
            <CardHead title="Traceability chain" />
            <div className="space-y-1.5 p-4 font-mono text-[11.5px]">
              {[["Manufacturer", comp.mfr], ["Lot", comp.lot], ["Wafer", comp.wafer], ["Component", comp.code], ["Socket", `${comp.socket} · ${comp.channel}`], ["Batch", comp.batch]].map(([k, v], i, a) => (
                <div key={k as string}>
                  <div className="flex items-center gap-2 rounded border border-line bg-panel2 px-2.5 py-1.5"><span className="w-24 text-[10px] uppercase tracking-wider text-fog">{k}</span><span className="text-snow">{v}</span></div>
                  {i < a.length - 1 && <div className="ml-6 h-2 w-px bg-line2" />}
                </div>
              ))}
              <Link href="/genealogy" className="mt-2 inline-block text-[11px] text-sky-300 hover:underline">Open full genealogy graph →</Link>
            </div>
          </Card>
        </div>
      )}

      {tab === "Replay" && (
        <Card>
          <CardHead title="Component timeline replay" sub="playback of burn-in evolution with anomaly markers and healthy-peer overlay" />
          <div className="p-4"><Replay tel={tel} peerTel={peer?.tel ?? null} anomalyHour={anomaly?.hour ?? comp.feature?.anomalyHour ?? null} /></div>
        </Card>
      )}

      {tab === "Test History" && (
        <Card>
          <CardHead title="Test timeline — 24h segments" />
          <table className="w-full text-[11.5px]">
            <thead><tr className="border-b border-line text-left text-[10px] uppercase tracking-wider text-fog">{["Window", "State", "Max leakage", "Note"].map((h) => <th key={h} className="px-4 py-2 font-medium">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-line/60">
              {histRows.map((r) => (
                <tr key={r.range} className="hover:bg-panel2">
                  <td className="px-4 py-2 font-mono text-fog">{r.range}</td>
                  <td className={cn("px-4 py-2 font-mono text-[11px]", r.state === "CRITICAL" ? "text-red-300" : r.state === "ANOMALOUS" ? "text-orange-300" : r.state === "WATCH" ? "text-amber-300" : "text-emerald-300")}>{r.state}</td>
                  <td className="tabular px-4 py-2 font-mono text-snow">{r.leak}</td>
                  <td className="px-4 py-2 text-fog">{r.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {tab === "Feedback" && (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          <Card>
            <CardHead title="Human-in-the-loop label" sub="stored to the controlled feedback queue — the model never retrains itself silently" />
            <div className="space-y-2 p-4">
              <div className="text-[11px] text-fog">Current AI decision: <DecisionPill decision={comp.decision} className="ml-1" /></div>
              <div className="flex flex-wrap gap-2">
                {FEEDBACK.map((f) => (
                  <button key={f.label} disabled={busy} onClick={() => sendFeedback(f.label)}
                    className={cn("flex items-center gap-1.5 rounded border px-2.5 py-1.5 text-[11px] disabled:opacity-50", f.tone)}>
                    <f.icon size={12} /> {f.text}
                  </button>
                ))}
              </div>
              {fbMsg && <div className="rounded border border-emerald-400/25 bg-emerald-400/10 p-2 text-[11px] text-emerald-200">{fbMsg}</div>}
            </div>
          </Card>
          <Card>
            <CardHead title="Label history" />
            <div className="divide-y divide-line">
              {feedbacks.map((f: any) => (
                <div key={f.id} className="px-4 py-2.5 text-[11px]">
                  <span className="font-mono text-fog">{f.orig}</span> → <span className="font-mono text-snow">{f.corr}</span>
                  <span className="ml-2 text-fog">{dt(f.at)}</span>
                </div>
              ))}
              {feedbacks.length === 0 && <div className="px-4 py-3 text-[11px] text-fog">No labels yet.</div>}
            </div>
          </Card>
        </div>
      )}

      {tab === "Reports" && (
        <Card>
          <CardHead
            title="Engineering reports"
            sub="prototype NCR-style / engineering-assessment exports"
            right={
              <div className="flex gap-1.5">
                <button onClick={() => genReport("NCR")} disabled={busy} className="flex items-center gap-1 rounded border border-red-400/30 bg-red-400/10 px-2 py-1 text-[10.5px] text-red-200 disabled:opacity-50"><FileText size={11} /> NCR-style</button>
                <button onClick={() => genReport("EAR")} disabled={busy} className="flex items-center gap-1 rounded border border-sky-400/30 bg-sky-400/10 px-2 py-1 text-[10.5px] text-sky-200 disabled:opacity-50"><ShieldCheck size={11} /> Assessment</button>
              </div>
            }
          />
          <div className="divide-y divide-line">
            {reports.map((r: any) => (
              <Link key={r.id} href={`/reports/${r.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-panel2">
                <Printer size={12} className="text-fog" />
                <span className="font-mono text-[11px] text-sky-300">{r.code}</span>
                <span className="truncate text-[11px] text-snow">{r.title}</span>
                <span className="ml-auto shrink-0 font-mono text-[10px] text-fog">{dt(r.at)}</span>
              </Link>
            ))}
            {reports.length === 0 && <div className="px-4 py-3 text-[11px] text-fog">No reports generated yet — use the buttons above.</div>}
          </div>
          {reportMsg && <div className="border-t border-line px-4 py-2 text-[11px] text-emerald-300">✓ {reportMsg}</div>}
        </Card>
      )}

      {tab === "Audit" && (
        <Card>
          <CardHead title="Audit trail for this component" />
          <div className="divide-y divide-line">
            {audits.map((a: any) => (
              <div key={a.id} className="flex items-center gap-3 px-4 py-2 text-[11px]">
                <span className="font-mono text-snow">{a.action}</span>
                <span className="text-fog">{a.by ?? "system"}</span>
                <span className="ml-auto font-mono text-[10px] text-fog">{dt(a.at)}</span>
              </div>
            ))}
            {audits.length === 0 && <div className="px-4 py-3 text-[11px] text-fog">No audit entries scoped to this component yet.</div>}
          </div>
        </Card>
      )}

      {(comp.decision === "REJECT" || comp.riskLevel === "CRITICAL") && (
        <div className="flex items-center gap-2 rounded-lg border border-red-400/25 bg-red-400/[0.06] px-4 py-2.5 text-[11.5px] text-red-200">
          <AlertTriangle size={13} /> Early-fail / critical-path unit — inspect and isolate per screening procedure. AI assessment is decision support; disposition authority remains with QA engineering.
        </div>
      )}
    </div>
  );
}
