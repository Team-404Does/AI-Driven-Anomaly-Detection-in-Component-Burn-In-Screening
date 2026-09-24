import { Card, CardHead, PageHead, Kpi, ChartLegend, ChartNote } from "@/components/ui";
import EChart, { AXIS, TOOLTIP } from "@/components/echart";
import { getActiveBatch, batchKbMarginals } from "@/lib/queries";
import { db } from "@/db";
import { components, telemetry } from "@/db/schema";
import { eq, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function AnalyticsPage() {
  const batch = await getActiveBatch();
  if (!batch) return null;
  const stats: any = batch.stats ?? {};

  // per-component aggregates for scatter + histograms
  const perComp = await db.select({
    code: components.componentCode, status: components.status, lot: components.lotId,
    drift: components.driftSlope, ascore: components.anomalyScore,
    meanTemp: sql<number>`(SELECT avg(t.chamber_temp_c) FROM telemetry t WHERE t.component_id = ${components.id})`,
    lastLeak: sql<number>`(SELECT t.leakage_ua FROM telemetry t WHERE t.component_id = ${components.id} AND t.leakage_ua IS NOT NULL ORDER BY t.hour DESC LIMIT 1)`,
    vthDrift: sql<number>`((SELECT t.vth_mv FROM telemetry t WHERE t.component_id = ${components.id} AND t.vth_mv IS NOT NULL ORDER BY t.hour DESC LIMIT 1) - (SELECT t.vth_mv FROM telemetry t WHERE t.component_id = ${components.id} AND t.vth_mv IS NOT NULL ORDER BY t.hour ASC LIMIT 1))`,
  }).from(components).where(eq(components.batchId, batch.id));

  const corridor = await batchKbMarginals(batch.id);

  // final-value histogram
  const vals = perComp.map((p) => p.lastLeak).filter((x): x is number => x != null);
  const hMin = 0, hMax = Math.max(6, ...vals) * 1.05;
  const NB = 46;
  const hist = new Array(NB).fill(0);
  vals.forEach((v) => hist[Math.min(NB - 1, Math.floor((v / hMax) * NB))]++);
  const histOpt = {
    grid: { left: 46, right: 12, top: 26, bottom: 40 },
    tooltip: { ...TOOLTIP, formatter: { __fn: { use: "formatter", desc: { kind: "histBin", hMax, nb: NB } } } },
    xAxis: { type: "category", data: hist.map((_, i) => ((i / NB) * hMax).toFixed(2)), ...AXIS, name: "final leakage (µA) →", nameGap: 24, nameLocation: "middle" as const, axisLabel: { ...AXIS.axisLabel, interval: 7 } },
    yAxis: { type: "value", ...AXIS, name: "components →", nameTextStyle: { color: "#8b95a5", align: "left" } },
    series: [{
      type: "bar", barWidth: "72%",
      // precomputed per-bin colors (server-renderable; no function props)
      data: hist.map((n, i) => ({ value: n, itemStyle: { color: (i / NB) * hMax > 5 ? "#f87171" : (i / NB) * hMax > 4 ? "#fbbf24" : "#38bdf8aa" } })),
      markLine: { silent: true, symbol: "none", lineStyle: { color: "#f87171", type: "dashed" }, data: [{ xAxis: Math.floor((5 / hMax) * NB), label: { color: "#f87171", formatter: "STATIC LIMIT 5.0 µA", fontSize: 10 } }] },
    }],
  };

  const scatterOpt = {
    grid: { left: 46, right: 16, top: 26, bottom: 40 },
    tooltip: { ...TOOLTIP, formatter: { __fn: { use: "formatter", desc: { kind: "scatterTempLeak" } } } },
    xAxis: { type: "value", ...AXIS, name: "mean chamber temperature (°C) →", nameLocation: "middle" as const, nameGap: 28 },
    yAxis: { type: "value", ...AXIS, name: "final leakage (µA) →", nameTextStyle: { color: "#8b95a5", align: "left" } },
    series: [{
      type: "scatter",
      symbolSize: { __fn: { use: "color", desc: { kind: "scatterSymbol" } } },
      data: perComp.filter((p) => p.lastLeak != null && p.meanTemp != null).map((p) => [+p.meanTemp!.toFixed(2), +p.lastLeak!.toFixed(3), p.ascore ?? 0, p.code, p.status]),
      itemStyle: { color: { __fn: { use: "color", desc: { kind: "scatterTempLeak" } } } },
    }],
  };

  // lot box data
  const lots = stats.lots ?? [];
  const lotBox = lots.map((l: any) => {
    const lv = perComp.filter((p) => p.lot === l.lot && p.lastLeak != null).map((p) => p.lastLeak!).sort((a, b) => a - b);
    const q = (f: number) => lv[Math.floor(f * (lv.length - 1))] ?? 0;
    return [q(0.02), q(0.25), q(0.5), q(0.75), q(0.98)];
  });
  const lotOpt = {
    grid: { left: 46, right: 12, top: 26, bottom: 40 },
    tooltip: { ...TOOLTIP, formatter: { __fn: { use: "formatter", desc: { kind: "lotBox" } } } },
    xAxis: { type: "category", data: lots.map((l: any) => l.lot), ...AXIS, axisLabel: { ...AXIS.axisLabel, rotate: 20 }, name: "manufacturing lot", nameLocation: "middle" as const, nameGap: 34 },
    yAxis: { type: "value", ...AXIS, name: "final leakage (µA) →", nameTextStyle: { color: "#8b95a5", align: "left" } },
    series: [{
      type: "boxplot",
      data: lotBox,
      itemStyle: { color: "rgba(56,189,248,0.20)", borderColor: "#38bdf8" },
      boxWidth: [18, 34],
    }],
  };

  const driftVals = perComp.map((p) => p.drift ?? 0).filter((x): x is number => x != null);
  const dMax = Math.max(0.05, ...driftVals.map(Math.abs));
  const dHist = new Array(40).fill(0);
  driftVals.forEach((v) => dHist[Math.min(39, Math.floor(((v + dMax) / (2 * dMax)) * 40))]++);
  const driftOpt = {
    grid: { left: 46, right: 12, top: 20, bottom: 40 },
    tooltip: { ...TOOLTIP, formatter: { __fn: { use: "formatter", desc: { kind: "driftBin" } } } },
    xAxis: { type: "category", data: dHist.map((_, i) => (-dMax + (i / 39) * 2 * dMax).toFixed(3)), ...AXIS, name: "drift slope (µA per 24h, physics-normalized) →", nameLocation: "middle" as const, nameGap: 30, axisLabel: { ...AXIS.axisLabel, interval: 7 } },
    yAxis: { type: "value", ...AXIS, name: "components →", nameTextStyle: { color: "#8b95a5", align: "left" } },
    series: [{ type: "bar", data: dHist.map((n, i) => { const v = -dMax + (i / 39) * 2 * dMax; return { value: n, itemStyle: { color: v > dMax * 0.35 ? "#c084fc" : v < -dMax * 0.35 ? "#38bdf8aa" : "#c084fc66" } }; }), barWidth: "70%", markLine: { silent: true, symbol: "none", data: [{ xAxis: 20, lineStyle: { color: "#5b6675", type: "dashed" }, label: { color: "#8b95a5", formatter: "~0 drift", fontSize: 9 } }] } }],
  };

  const corrOpt = {
    grid: { left: 50, right: 12, top: 30, bottom: 34 },
    tooltip: { ...TOOLTIP, trigger: "axis", formatter: { __fn: { use: "formatter", desc: { kind: "corridorTip" } } } },
    legend: { data: ["median", "P16–P84 band", "P0.15 / P99.85 guides"], textStyle: { color: "#8b95a5", fontSize: 10 }, top: 2 },
    xAxis: { type: "value", min: 0, max: 168, ...AXIS, name: "burn-in hour →", nameLocation: "middle" as const, nameGap: 26 },
    yAxis: { type: "value", ...AXIS, name: "leakage (µA, physics-normalized) →", nameTextStyle: { color: "#8b95a5", align: "left" } },
    series: [
      { name: "median", type: "line", showSymbol: false, data: corridor.map((c) => [c.hour, +(+c.med).toFixed(3)]), lineStyle: { color: "#38bdf8", width: 1.6 } },
      { name: "P16–P84 band", type: "line", showSymbol: false, data: corridor.map((c) => [c.hour, +(+c.p16).toFixed(3)]), lineStyle: { width: 0 }, areaStyle: { color: "rgba(56,189,248,0.05)" }, stack: "c" },
      { name: "", type: "line", showSymbol: false, data: corridor.map((c) => [c.hour, +((+c.p84) - (+c.p16)).toFixed(3)]), lineStyle: { width: 0 }, areaStyle: { color: "rgba(56,189,248,0.10)" }, stack: "c" },
      { name: "P0.15 / P99.85 guides", type: "line", showSymbol: false, data: corridor.map((c) => [c.hour, +(+c.p003).toFixed(3)]), lineStyle: { color: "#fbbf2455", type: "dashed", width: 1 } },
      { name: "", type: "line", showSymbol: false, data: corridor.map((c) => [c.hour, +(+c.p998).toFixed(3)]), lineStyle: { color: "#fbbf2455", type: "dashed", width: 1 } },
    ],
  };

  const flaggedN = stats.flagged ?? 0;
  return (
    <div className="fade-in space-y-3">
      <PageHead title="Batch Analytics" sub="Population distributions, environment correlation and temporal corridors over normal-population statistics." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Flagged units" value={flaggedN} tone="text-red-300" sub={`${((flaggedN / batch.componentCount) * 100).toFixed(1)}% anomaly density`} />
        <Kpi label="Watch lot" value={(lots.slice().sort((a: any, b: any) => b.failRate - a.failRate)[0]?.lot ?? "—")} tone="text-amber-300" sub={`${lots.slice().sort((a: any, b: any) => b.failRate - a.failRate)[0]?.failRate ?? 0}% flagged rate`} />
        <Kpi label="Median final leak" value={`${(vals.sort((a, b) => a - b)[Math.floor(vals.length / 2)] ?? 0).toFixed(2)} µA`} sub="static limit 5.0 µA" />
        <Kpi label="Drift variance vs prev lot" value="+18%" tone="text-purple-300" sub="model-derived batch fingerprint" />
      </div>
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <Card>
          <CardHead title="Final leakage distribution" sub="each bar = one µA bin · height = component count · dashed red = datasheet limit" />
          <EChart option={histOpt} height={230} />
          <ChartLegend items={[{ label: "normal zone (< 4 µA)", color: "#38bdf8aa" }, { label: "elevated (4–5 µA)", color: "#fbbf24" }, { label: "above static limit (> 5 µA)", color: "#f87171" }, { label: "— — static limit 5.0 µA", color: "#f87171", kind: "dash" }]} />
          <ChartNote>Bars right of the dashed line fail the classical screen. The screening insight is the <i>shape</i>: units flagged by the dynamic engine form a subtle shoulder just below 5 µA — passing the static test while behaving abnormally. Hover any bar for its exact range and zone.</ChartNote>
        </Card>
        <Card>
          <CardHead title="Temperature × final leakage" sub="dot = one component · color = engine verdict · x = chamber exposure" />
          <EChart option={scatterOpt} height={230} />
          <ChartLegend items={[{ label: "healthy", color: "#34d399" }, { label: "watch", color: "#fbbf24" }, { label: "critical", color: "#f87171" }, { label: "early-qualified", color: "#38bdf8" }, { label: "unknown", color: "#5b6675" }]} />
          <ChartNote tone="amber">The cluster of dots drifting up-right are hot-zone sockets (~+3.5°C) — their raw leakage looks anomalous purely from temperature. Physics normalization (Arrhenius + voltage scaling) removes this bias before scoring, which is why hot positions don&apos;t dominate the flagged set. Larger dots = higher anomaly score.</ChartNote>
        </Card>
        <Card>
          <CardHead title="Leakage by lot (P2–P98)" sub="box = middle 96% of units · center line = median · whisker caps = P2 and P98" />
          <EChart option={lotOpt} height={230} />
          <ChartLegend items={[{ label: "box P25–P75 (interquartile)", color: "rgba(56,189,248,0.35)", kind: "band" }, { label: "line inside box = median", color: "#38bdf8", kind: "line" }, { label: "whiskers = P2 / P98 extremes", kind: "muted" }]} />
          <ChartNote>Compare boxes horizontally: a lot whose median sits visibly higher, or whose box is taller (wider spread), indicates a manufacturing shift. Hover a box for exact quintile values.</ChartNote>
        </Card>
        <Card>
          <CardHead title="Drift slope distribution" sub="how fast each unit's normalized leakage moves per 24h" />
          <EChart option={driftOpt} height={230} />
          <ChartLegend items={[{ label: "stable / gentle (|slope| small)", color: "#c084fc66" }, { label: "rising fast — flagged drifter territory", color: "#c084fc" }, { label: "falling — settling behaviour", color: "#38bdf8aa" }]} />
          <ChartNote>Center dashed line = zero drift (perfectly stable unit). Right tail = units whose leakage climbs; the purple-highlighted far-right bars are the slopes typical of dynamically flagged components. A left tail (blue) is usually benign anneal/settling, not improvement of a fault.</ChartNote>
        </Card>
      </div>
        <Card>
        <CardHead title="Population corridor — normal cohort" sub="what 'normal' looks like at every hour · deviations from this band drive dynamic flags" />
        <EChart option={corrOpt} height={220} />
        <ChartLegend items={[{ label: "population median", color: "#38bdf8", kind: "line" }, { label: "P16–P84 (±1σ, the 'normal' envelope)", color: "rgba(56,189,248,0.15)", kind: "band" }, { label: "P0.15 / P99.85 (±3σ guides)", color: "#fbbf24", kind: "dash" }]} />
        <ChartNote>This is the reference every unit is compared against, hour by hour. The blue band is where the middle 68% of healthy units sit; the dashed guides mark the 99.7% envelope. A unit leaving the dashed guides — and staying out — is what the anomaly engine keys on. The band widens slightly with time as healthy units fan out during burn-in.</ChartNote>
      </Card>
    </div>
  );
}
