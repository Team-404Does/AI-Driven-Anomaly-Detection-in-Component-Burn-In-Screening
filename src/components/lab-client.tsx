"use client";

import { useEffect, useMemo, useState } from "react";
import { cn, fmt } from "@/lib/utils";
import { Card, CardHead, StatusPill, DecisionPill, Meter, ChartLegend, ChartNote } from "@/components/ui";
import EChart, { AXIS, TOOLTIP } from "@/components/echart";
import { FlaskConical, Play, Thermometer, Zap, Timer, Loader2 } from "lucide-react";

export default function LabClient({ candidates }: { candidates: any[] }) {
  const [code, setCode] = useState(candidates[0]?.code ?? "");
  const [data, setData] = useState<any>(null);
  const [tempC, setTempC] = useState(140);
  const [voltage, setVoltage] = useState(32);
  const [durationH, setDurationH] = useState(336);
  const [sim, setSim] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!code) return;
    let cancelled = false;
    fetch(`/api/forecast?code=${encodeURIComponent(code)}`)
      .then((r) => r.json())
      .then((j) => { if (!cancelled) { setSim(null); setData(j); } })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [code]);

  const opt = useMemo(() => {
    if (!data?.tel) return null;
    return {
      grid: { left: 48, right: 14, top: 28, bottom: 34 },
      tooltip: { ...TOOLTIP, trigger: "axis", formatter: (ps: any[]) => {
        const h = ps?.[0]?.value?.[0] ?? ps?.[0]?.axisValue ?? "";
        const rows = ps.filter((p: any) => p.seriesName && !p.seriesName.startsWith("_") && p.value?.[1] != null)
          .map((p: any) => `${p.marker}${p.seriesName}: <b>${(+p.value[1]).toFixed(3)} µA</b>`);
        if (h !== "" && +h > 168) rows.push(`<span style="color:#8b95a5">extrapolated — model only</span>`);
        return `<b>T+${h}h</b><br/>${rows.join("<br/>")}`;
      } },
      xAxis: { type: "value", min: 0, max: 336, ...AXIS, name: "burn-in hour →", nameLocation: "middle" as const, nameGap: 26 },
      yAxis: { type: "value", ...AXIS, name: "µA (physics-normalized) →", nameTextStyle: { color: "#8b95a5", align: "left" }, scale: true },
      series: [
        { name: "observed", type: "line", showSymbol: false, data: data.tel.filter((t: any) => t.l != null).map((t: any) => [t.h, +t.l.toFixed(3)]), lineStyle: { color: "#e2e8f0", width: 1.5 }, markArea: { silent: true, itemStyle: { color: "rgba(192,132,252,0.05)" }, label: { color: "#a78bfa", fontSize: 9, position: "insideTop" as const }, data: [[{ xAxis: 168, name: "extrapolated (model only)" }, { xAxis: 336 }]] } },
        ...(data.pred ? [
          { name: "_piLo", type: "line", showSymbol: false, data: data.pred.curve.map((c: any) => [c.hour, c.lo]), lineStyle: { width: 0 }, stack: "pi" },
          { name: "95% prediction interval", type: "line", showSymbol: false, data: data.pred.curve.map((c: any) => [c.hour, +(c.hi - c.lo).toFixed(3)]), lineStyle: { width: 0 }, stack: "pi", areaStyle: { color: "rgba(192,132,252,0.13)" } },
          { name: "projected (model)", type: "line", showSymbol: false, data: data.pred.curve.map((c: any) => [c.hour, c.pred]), lineStyle: { color: "#c084fc", width: 1.7, type: "dashed" }, markLine: { silent: true, symbol: "none", data: [{ yAxis: 5, lineStyle: { color: "#f87171", type: "dashed" as const }, label: { color: "#f87171", formatter: "STATIC LIMIT 5.0 µA", fontSize: 9, position: "insideEndTop" as const } }] } },
        ] : []),
      ],
    };
  }, [data]);

  const runSim = async () => {
    setBusy(true);
    const r = await fetch("/api/whatif", { method: "POST", body: JSON.stringify({ componentCode: code, tempC, voltage, durationH }) }).then((x) => x.json());
    setSim(r); setBusy(false);
  };

  return (
    <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1fr_360px]">
      <div className="space-y-3">
        <Card>
          <CardHead
            title="Observed → projected leakage"
            sub="DRIFT-LIN v2.1 · ±95% prediction interval · physics-normalized"
            right={
              <select value={code} onChange={(e) => setCode(e.target.value)} className="rounded border border-line bg-panel2 px-2 py-1 font-mono text-[11px] text-snow outline-none">
                {candidates.map((c) => <option key={c.code} value={c.code}>{c.code} · {c.status} · AS {fmt(c.as)}</option>)}
              </select>
            }
          />
          {opt ? <EChart option={opt} height={300} /> : <div className="flex h-[300px] items-center justify-center text-fog"><Loader2 size={16} className="animate-spin" /></div>}
          <ChartLegend items={[{ label: "observed (0–168h test)", color: "#e2e8f0", kind: "line" }, { label: "projected (DRIFT-LIN model, →336h)", color: "#c084fc", kind: "dash" }, { label: "95% prediction interval", color: "rgba(192,132,252,0.35)", kind: "band" }, { label: "static limit 5.0 µA", color: "#f87171", kind: "dash" }]} />
          <ChartNote tone="purple">White line: the unit&apos;s measured behaviour during the real 168h burn-in. Dashed purple: where the model projects it a further 168h into mission life — the widening band is honest uncertainty, and the dashed red limit is where a projection crossing means eventual failure. Use the What-If panel to stress this same unit at harsher conditions.</ChartNote>
          {data?.comp && (
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-line px-4 py-2 text-[11px]">
              <StatusPill status={data.comp.status} /><DecisionPill decision={data.comp.decision} />
              <span className="font-mono text-fog">{data.comp.socket} · {data.comp.lot}</span>
              <span className="font-mono text-fog">drift {data.pred ? `${fmt(data.pred.slope, 4)} µA/24h` : "—"} · TTL {data.pred?.ttl ? `~${Math.round(data.pred.ttl)}h` : "> horizon"}</span>
            </div>
          )}
        </Card>
        {sim && (
          <Card className="border-purple-400/25">
            <CardHead title="Simulation result" sub={`${sim.modelVersion} · all values model-derived`} />
            <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-3">
              <div>
                <div className="mb-1.5 text-[10px] uppercase tracking-widest text-fog">Scenario / baseline</div>
                <div className="space-y-1 font-mono text-[11px] text-fog">
                  <div>T {sim.scenario.tempC}°C · V {sim.scenario.voltage} · {sim.scenario.durationH}h</div>
                  <div>baseline 125°C · 28V · 336h</div>
                  <div className="text-snow">AF = {sim.predicted.accelerationFactor}×</div>
                </div>
              </div>
              <div>
                <div className="mb-1.5 text-[10px] uppercase tracking-widest text-fog">Predicted effect</div>
                <div className="space-y-1 font-mono text-[11px]">
                  <div className="flex justify-between"><span className="text-fog">drift @horizon</span><span className="text-snow">{sim.predicted.predictedDrift} µA</span></div>
                  <div className="flex justify-between"><span className="text-fog">risk</span><span className={sim.predicted.riskAfter > sim.predicted.riskBefore ? "text-red-300" : "text-emerald-300"}>{sim.predicted.riskBefore} → {sim.predicted.riskAfter}</span></div>
                  <div className="flex justify-between"><span className="text-fog">batch anomalies Δ</span><span className="text-snow">+{sim.predicted.expectedAnomalies}</span></div>
                  <div className="flex justify-between"><span className="text-fog">drift risk</span><span className="text-snow">{sim.predicted.driftRisk}</span></div>
                </div>
              </div>
              <div>
                <div className="mb-1.5 text-[10px] uppercase tracking-widest text-fog">Recommendation</div>
                <p className="text-[11px] leading-relaxed text-snow">{sim.recommendation}</p>
              </div>
            </div>
            <div className="border-t border-line px-4 py-2.5">
              <div className="mb-1 text-[10px] uppercase tracking-widest text-fog">Assumptions</div>
              <div className="flex flex-wrap gap-x-5 gap-y-1 font-mono text-[10px] text-fog">
                {sim.assumptions.map((a: string) => <span key={a}>· {a}</span>)}
              </div>
            </div>
          </Card>
        )}
      </div>

      <Card>
        <CardHead title="What-If simulator" sub="stress-scenario decision support" />
        <div className="space-y-4 p-4">
          <div>
            <div className="mb-1 flex items-center justify-between text-[11px]"><span className="flex items-center gap-1.5 text-fog"><Thermometer size={12} /> Stress temperature</span><span className="font-mono text-snow">{tempC}°C</span></div>
            <input type="range" min={110} max={165} value={tempC} onChange={(e) => setTempC(+e.target.value)} className="w-full accent-amber-400" />
            <div className="flex justify-between font-mono text-[9px] text-fog"><span>110</span><span>nominal 125</span><span>165</span></div>
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between text-[11px]"><span className="flex items-center gap-1.5 text-fog"><Zap size={12} /> Voltage stress</span><span className="font-mono text-snow">{voltage} V</span></div>
            <input type="range" min={20} max={42} value={voltage} onChange={(e) => setVoltage(+e.target.value)} className="w-full accent-sky-400" />
            <div className="flex justify-between font-mono text-[9px] text-fog"><span>20</span><span>nominal 28</span><span>42</span></div>
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between text-[11px]"><span className="flex items-center gap-1.5 text-fog"><Timer size={12} /> Test duration</span><span className="font-mono text-snow">{durationH}h</span></div>
            <input type="range" min={96} max={672} step={24} value={durationH} onChange={(e) => setDurationH(+e.target.value)} className="w-full accent-purple-400" />
            <div className="flex justify-between font-mono text-[9px] text-fog"><span>96</span><span>336</span><span>672</span></div>
          </div>
          <button onClick={runSim} disabled={busy || !data}
            className="flex w-full items-center justify-center gap-2 rounded-md border border-purple-400/30 bg-purple-400/10 px-3 py-2 text-[12px] text-purple-200 transition-colors hover:bg-purple-400/15 disabled:opacity-50">
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />} Run simulation
          </button>
          <div className="rounded border border-line bg-panel2 p-2.5 text-[10px] leading-relaxed text-fog">
            <FlaskConical size={11} className="mr-1 inline" />
            Simulations are logged to the audit trail with model version and inputs. Higher acceleration shortens effective
            screening time but raises overstress risk — adaptive-screening recommendations require engineering sign-off.
          </div>
        </div>
      </Card>
    </div>
  );
}
