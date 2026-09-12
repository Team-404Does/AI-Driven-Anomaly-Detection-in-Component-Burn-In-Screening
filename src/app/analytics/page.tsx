import { Card, CardHead, PageHead, Kpi } from "@/components/ui";
import EChart, { AXIS, TOOLTIP } from "@/components/echart";
import { getActiveBatch, batchKbMarginals } from "@/lib/queries";
import { db } from "@/db";
import { components, telemetry } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function AnalyticsPage() {
  const batch = await getActiveBatch();
  if (!batch) return null;
  const stats: any = batch.stats ?? {};

  // per-component aggregates for scatter + histograms
  const perComp = await db.select({
    code: components.componentCode, status: components.status, lot: components.lotId,
    drift: components.driftSlope, ascore: components.anomalyScore, staticLimit: components.staticLeakLimitUa,
    meanTemp: sql<number>`(SELECT avg(t.chamber_temp_c) FROM telemetry t WHERE t.component_id = ${components.id})`,
    lastLeak: sql<number>`(SELECT t.leakage_ua FROM telemetry t WHERE t.component_id = ${components.id} AND t.leakage_ua IS NOT NULL ORDER BY t.hour DESC LIMIT 1)`,
    vthDrift: sql<number>`((SELECT t.vth_mv FROM telemetry t WHERE t.component_id = ${components.id} AND t.vth_mv IS NOT NULL ORDER BY t.hour DESC LIMIT 1) - (SELECT t.vth_mv FROM telemetry t WHERE t.component_id = ${components.id} AND t.vth_mv IS NOT NULL ORDER BY t.hour ASC LIMIT 1))`,
  }).from(components).where(eq(components.batchId, batch.id));

  const corridor = await batchKbMarginals(batch.id);

  // final-value histogram
  const vals = perComp.map((p) => p.lastLeak).filter((x): x is number => x != null);
  const limits = perComp.map((p) => p.staticLimit).filter((x): x is number => x != null).sort((a, b) => a - b);
  const staticLimit = limits[Math.floor(limits.length / 2)] ?? 5;
  const hMax = Math.max(staticLimit * 1.2, ...vals, 1) * 1.05;
  const NB = 46;
  const hist = new Array(NB).fill(0);
  vals.forEach((v) => hist[Math.min(NB - 1, Math.floor((v / hMax) * NB))]++);
  const histOpt = {
    grid: { left: 46, right: 12, top: 26, bottom: 24 },
    tooltip: { ...TOOLTIP },
    xAxis: { type: "category", data: hist.map((_, i) => ((i / NB) * hMax).toFixed(2)), ...AXIS, name: "µA", nameGap: 18, nameLocation: "middle" as const },
    yAxis: { type: "value", ...AXIS },
    series: [{
      type: "bar",
      data: hist.map((value, index) => ({
        value,
        itemStyle: { color: (index / NB) * hMax > staticLimit ? "#f87171" : (index / NB) * hMax > staticLimit * 0.8 ? "#fbbf24" : "#38bdf8aa" },
      })),
      barWidth: "72%",
      markLine: { silent: true, symbol: "none", lineStyle: { color: "#f87171", type: "dashed" }, data: [{ xAxis: Math.min(NB - 1, Math.floor((staticLimit / hMax) * NB)), label: { color: "#f87171", formatter: `MEDIAN STATIC LIMIT ${staticLimit.toFixed(2)} µA`, fontSize: 10 } }] },
    }],
  };

  const scatterPalette: Record<string, string> = {
    healthy: "#34d39966", watch: "#fbbf24cc", critical: "#f87171ee",
    qualified: "#38bdf866", unknown: "#5b667599",
  };
  const scatterStatuses = [...new Set(perComp.map((p) => p.status))];
  const scatterOpt = {
    grid: { left: 46, right: 16, top: 26, bottom: 24 },
    tooltip: { ...TOOLTIP, formatter: "{a}<br/>temperature {c0}°C<br/>leakage {c1} µA" },
    legend: { show: true, top: 2, textStyle: { color: "#8b95a5", fontSize: 9 } },
    xAxis: { type: "value", ...AXIS, name: "mean chamber °C", nameLocation: "middle" as const, nameGap: 24 },
    yAxis: { type: "value", ...AXIS, name: "µA" },
    series: scatterStatuses.map((status) => ({
      name: status,
      type: "scatter",
      symbolSize: status === "critical" ? 7 : status === "watch" ? 6 : 4,
      data: perComp
        .filter((p) => p.status === status && p.lastLeak != null && p.meanTemp != null)
        .map((p) => ({ value: [+p.meanTemp!.toFixed(2), +p.lastLeak!.toFixed(3)], name: p.code })),
      itemStyle: { color: scatterPalette[status] ?? "#5b667599" },
    })),
  };

  // lot box data
  const lots = stats.lots ?? [];
  const lotBox = lots.map((l: any) => {
    const lv = perComp.filter((p) => p.lot === l.lot && p.lastLeak != null).map((p) => p.lastLeak!).sort((a, b) => a - b);
    const q = (f: number) => lv[Math.floor(f * (lv.length - 1))] ?? 0;
    return [q(0.02), q(0.25), q(0.5), q(0.75), q(0.98)];
  });
  const lotOpt = {
    grid: { left: 46, right: 12, top: 26, bottom: 30 },
    tooltip: { ...TOOLTIP },
    xAxis: { type: "category", data: lots.map((l: any) => l.lot), ...AXIS, axisLabel: { ...AXIS.axisLabel, rotate: 20 } },
    yAxis: { type: "value", ...AXIS, name: "µA" },
    series: [{
      type: "boxplot",
      data: lotBox,
      itemStyle: { color: "rgba(56,189,248,0.20)", borderColor: "#38bdf8" },
      boxWidth: [18, 34],
    }],
  };

  const driftVals = perComp.map((p) => p.drift).filter((x): x is number => x != null);
  const driftMean = driftVals.reduce((sum, value) => sum + value, 0) / Math.max(1, driftVals.length);
  const driftStd = Math.sqrt(driftVals.reduce((sum, value) => sum + (value - driftMean) ** 2, 0) / Math.max(1, driftVals.length));
  const dMax = Math.max(0.05, ...driftVals.map(Math.abs));
  const dHist = new Array(40).fill(0);
  driftVals.forEach((v) => dHist[Math.min(39, Math.floor(((v + dMax) / (2 * dMax)) * 40))]++);
  const driftOpt = {
    grid: { left: 46, right: 12, top: 20, bottom: 24 },
    tooltip: { ...TOOLTIP },
    xAxis: { type: "category", data: dHist.map((_, i) => (-dMax + (i / 39) * 2 * dMax).toFixed(3)), ...AXIS, name: "µA/24h", nameLocation: "middle" as const, nameGap: 20 },
    yAxis: { type: "value", ...AXIS },
    series: [{ type: "bar", data: dHist, barWidth: "70%", itemStyle: { color: "#c084fc99" } }],
  };

  const corrOpt = {
    grid: { left: 50, right: 12, top: 24, bottom: 24 },
    tooltip: { ...TOOLTIP, trigger: "axis" },
    xAxis: { type: "value", min: corridor[0]?.hour ?? 0, max: corridor[corridor.length - 1]?.hour ?? 168, ...AXIS, name: "hour", nameLocation: "middle" as const, nameGap: 22 },
    yAxis: { type: "value", ...AXIS, name: "µA" },
    series: [
      { type: "line", showSymbol: false, data: corridor.map((c) => [c.hour, +(+c.med).toFixed(3)]), lineStyle: { color: "#38bdf8", width: 1.6 } },
      { type: "line", showSymbol: false, data: corridor.map((c) => [c.hour, +(+c.p16).toFixed(3)]), lineStyle: { color: "#38bdf855", width: 0 }, areaStyle: { color: "rgba(56,189,248,0.05)" }, stack: "c" },
      { type: "line", showSymbol: false, data: corridor.map((c) => [c.hour, +((+c.p84) - (+c.p16)).toFixed(3)]), lineStyle: { width: 0 }, areaStyle: { color: "rgba(56,189,248,0.10)" }, stack: "c" },
      { type: "line", showSymbol: false, data: corridor.map((c) => [c.hour, +(+c.p003).toFixed(3)]), lineStyle: { color: "#fbbf2455", type: "dashed", width: 1 } },
      { type: "line", showSymbol: false, data: corridor.map((c) => [c.hour, +(+c.p998).toFixed(3)]), lineStyle: { color: "#fbbf2455", type: "dashed", width: 1 } },
    ],
  };

  const flaggedN = stats.flagged ?? 0;
  const profile = stats.analysisProfile ?? {};
  const watchLot = lots.slice().sort((a: any, b: any) => b.failRate - a.failRate)[0];
  return (
    <div className="fade-in space-y-3">
      <PageHead
        title="Batch Analytics"
        sub={`Population distributions and cohort corridors for ${batch.batchCode} · observed T+${profile.observedStartH ?? 0}–${profile.observedEndH ?? "—"}h · cohort confidence ${profile.cohortConfidence ?? "—"}.`}
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Flagged units" value={flaggedN} tone="text-red-300" sub={`${((flaggedN / Math.max(1, batch.componentCount)) * 100).toFixed(1)}% anomaly density`} />
        <Kpi label="Watch lot" value={watchLot?.lot ?? "—"} tone="text-amber-300" sub={`${watchLot?.failRate ?? 0}% flagged rate · computed`} />
        <Kpi label="Median final leak" value={`${(vals.slice().sort((a, b) => a - b)[Math.floor(vals.length / 2)] ?? 0).toFixed(2)} µA`} sub={`median component limit ${staticLimit.toFixed(2)} µA`} />
        <Kpi label="Drift dispersion" value={`${driftStd.toFixed(4)} µA/24h`} tone="text-purple-300" sub={`${driftVals.length} forecastable units · measured`} />
      </div>
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <Card><CardHead title="Final leakage distribution" sub={`median configured static limit ${staticLimit.toFixed(2)} µA · dynamic flags can occur below it`} /><EChart option={histOpt} height={230} /></Card>
        <Card><CardHead title="Temperature × final leakage" sub="raw telemetry by decision status; physics correction is applied in the residual model" /><EChart option={scatterOpt} height={230} /></Card>
        <Card><CardHead title="Leakage by lot (P2–P98)" sub="computed from the active batch; sparse/default genealogy remains explicitly labelled" /><EChart option={lotOpt} height={230} /></Card>
        <Card><CardHead title="Drift slope distribution" sub="physics-normalized, µA per 24h" /><EChart option={driftOpt} height={230} /></Card>
      </div>
      <Card><CardHead title="Population corridor — normal cohort" sub="median + P16/P84 band + P0.15/P99.85 guides (reference for ±3σ corridors)" /><EChart option={corrOpt} height={220} /></Card>
    </div>
  );
}
