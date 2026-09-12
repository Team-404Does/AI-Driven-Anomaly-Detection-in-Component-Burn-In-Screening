import Link from "next/link";
import { Card, CardHead, Kpi, StatusPill, Mono, PageHead, DecisionPill, Empty } from "@/components/ui";
import EChart, { AXIS, TOOLTIP } from "@/components/echart";
import { getActiveBatch, getAnomalyQueue, getAudit, getEquipmentEvents } from "@/lib/queries";
import { dt, fmt, cn } from "@/lib/utils";
import { ArrowRight, Gauge, ShieldAlert, Wrench, Sparkles } from "lucide-react";
import UploadAnalyze from "@/components/upload-analyze";

export const dynamic = "force-dynamic";

export default async function Overview() {
  const batch = await getActiveBatch();
  if (!batch) return <div className="text-fog">No batch. Trigger POST /api/seed.</div>;
  const stats: any = batch.stats ?? {};
  const quality: any = batch.dataQuality ?? {};
  const dist = stats.dist ?? {};
  const queue = (await getAnomalyQueue(batch.id)).slice(0, 6);
  const events = await getEquipmentEvents(batch.id);
  const audit = await getAudit(1, 8);

  const hours = (stats.hourMean ?? []).map((h: any) => h.hour);
  const healthOpt = {
    grid: { left: 42, right: 10, top: 26, bottom: 22 },
    tooltip: { ...TOOLTIP, trigger: "axis" },
    xAxis: { type: "category", data: hours, ...AXIS, name: "h" },
    yAxis: { type: "value", ...AXIS, name: "µA", nameTextStyle: { color: "#8b95a5" } },
    series: [
      { name: "Batch mean (physics-norm)", type: "line", data: (stats.hourMean ?? []).map((h: any) => h.mean), smooth: true, showSymbol: false, lineStyle: { color: "#38bdf8", width: 1.6 }, areaStyle: { color: "rgba(56,189,248,0.07)" } },
      { name: "Onsets", type: "bar", data: (stats.onsetHist ?? []).map((o: any) => o.count), yAxisIndex: 0, itemStyle: { color: "rgba(248,113,113,0.5)" }, barWidth: 4 },
    ],
  };
  const donut = {
    tooltip: { ...TOOLTIP },
    series: [{
      type: "pie", radius: ["58%", "82%"], center: ["50%", "52%"],
      label: { color: "#8b95a5", fontSize: 10, fontFamily: "JetBrains Mono" },
      labelLine: { lineStyle: { color: "#243042" } },
      data: [
        { value: dist.healthy ?? 0, name: "Healthy", itemStyle: { color: "#34d399" } },
        { value: dist.qualified ?? 0, name: "Early-qualified", itemStyle: { color: "#38bdf8" } },
        { value: dist.watch ?? 0, name: "Watch", itemStyle: { color: "#fbbf24" } },
        { value: dist.review ?? 0, name: "Review", itemStyle: { color: "#c084fc" } },
        { value: dist.critical ?? 0, name: "Critical", itemStyle: { color: "#f87171" } },
        { value: dist.unknown ?? 0, name: "Unknown", itemStyle: { color: "#5b6675" } },
      ],
    }],
  };

  return (
    <div className="fade-in space-y-4">
      <PageHead
        title="Mission Control"
        sub={`Batch ${batch.batchCode} · ${fmt(batch.componentCount, 0)} components · 168h burn-in · physics-informed screening pipeline PRES-IF v1.4`}
        right={<UploadAnalyze batchId={batch.id} />}
      />

      {/* KPI row */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Components" value={fmt(batch.componentCount, 0)} sub={`lots ${new Set((stats.lots ?? []).map((l: any) => l.lot)).size} · 8 chambers`} />
        <Kpi label="Healthy + qualified" value={fmt((dist.healthy ?? 0) + (dist.qualified ?? 0), 0)} tone="text-emerald-300" sub={`${(((dist.healthy ?? 0) + (dist.qualified ?? 0)) / batch.componentCount * 100).toFixed(1)}% of population`} />
        <Kpi label="Watch" value={fmt(dist.watch ?? 0, 0)} tone="text-amber-300" sub="within limits, elevated risk" />
        <Kpi label="Critical + review" value={fmt((dist.critical ?? 0) + (dist.review ?? 0), 0)} tone="text-red-300" sub={`${stats.flagged ?? 0} dynamically flagged`} />
        <Kpi label="Data quality" value={`${quality.score ?? "—"}%`} tone="text-sky-300" sub={`missing ${quality.missingPct ?? 0}% · dupes ${quality.duplicatePct ?? 0}%`} />
        <Kpi label="Hidden anomalies" value={fmt(stats.hiddenCount ?? 0, 0)} tone="text-purple-300" sub="static PASS / dynamic FAIL" />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHead title="Batch health trend — physics-normalized leakage" sub="population mean µA at 125°C reference · red bars = anomaly onsets" />
          <EChart option={healthOpt} height={230} />
        </Card>
        <Card>
          <CardHead title="Risk distribution" sub="deterministic risk engine output" />
          <EChart option={donut} height={230} />
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
        {/* Critical anomalies */}
        <Card className="xl:col-span-2">
          <CardHead
            title="Priority anomaly queue"
            sub="ranked by dynamic anomaly score"
            right={<Link href="/anomalies" className="flex items-center gap-1 text-[11px] text-sky-300 hover:text-sky-200">Open triage <ArrowRight size={11} /></Link>}
          />
          <div className="divide-y divide-line">
            {queue.map(({ a, c, sig }) => (
              <Link key={a.id} href={`/components/${c.componentCode}`} className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-panel2">
                <Mono className="w-24 text-[12px] text-sky-300">{c.componentCode}</Mono>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12px] text-snow">{sig?.signature ?? a.signature}</div>
                  <div className="text-[10.5px] text-fog">{c.lotId} · {c.socketId} · onset T+{a.hour}h</div>
                </div>
                <DecisionPill decision={c.decision} />
                <span className={cn("w-12 text-right font-mono text-[12px]", a.anomalyScore >= 0.85 ? "text-red-300" : "text-amber-300")}>{a.anomalyScore.toFixed(2)}</span>
              </Link>
            ))}
            {queue.length === 0 && <Empty msg="No anomalies in queue." />}
          </div>
        </Card>

        {/* Equipment alerts + audit */}
        <div className="space-y-3">
          <Card>
            <CardHead title="Equipment / environment alerts" sub="fault-discrimination engine" />
            <div className="space-y-2 p-3">
              {events.slice(0, 3).map((e) => (
                <div key={e.id} className="rounded-md border border-line bg-panel2 p-2.5">
                  <div className="flex items-center gap-2 text-[11px]">
                    <Wrench size={11} className="text-cyan-300" />
                    <span className="font-mono text-cyan-200">{e.eventType}</span>
                    <span className="ml-auto font-mono text-[10px] text-fog">{e.confidence?.toUpperCase()}</span>
                  </div>
                  <div className="mt-1 line-clamp-3 text-[10.5px] leading-relaxed text-fog">{e.assessment}</div>
                </div>
              ))}
              {events.length === 0 && <Empty msg="No equipment correlations detected." />}
              <div className="flex items-start gap-2 rounded-md border border-purple-400/25 bg-purple-400/10 p-2.5 text-[10.5px] text-purple-200">
                <Sparkles size={12} className="mt-0.5 shrink-0" />
                <span><b className="font-medium">Invisible failures:</b> {stats.hiddenCount ?? 0} components pass static limits but are anomalous vs population dynamics. <Link href="/anomalies?mode=hidden" className="underline underline-offset-2">Inspect</Link></span>
              </div>
            </div>
          </Card>
          <Card>
            <CardHead title="Recent audit events" right={<Link href="/audit" className="text-[11px] text-sky-300">All</Link>} />
            <div className="divide-y divide-line">
              {audit.rows.map((a) => (
                <div key={a.id} className="flex items-center gap-2 px-4 py-2 text-[11px]">
                  <Gauge size={10} className="shrink-0 text-fog" />
                  <span className="font-mono text-snow">{a.action}</span>
                  <span className="truncate font-mono text-fog">{a.objectId}</span>
                  <span className="ml-auto shrink-0 font-mono text-[10px] text-fog">{dt(a.createdAt)}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>

      {/* Summary strip */}
      <Card>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 text-[11px] text-fog">
          <span className="flex items-center gap-1.5"><ShieldAlert size={12} className="text-amber-300" /> Decision engine: deterministic, model-versioned, thresholds configurable</span>
          <span>Pipeline runtime: <Mono className="text-snow">{fmt(stats.pipelineMs, 0)} ms</Mono></span>
          <span>Analyzed: <Mono className="text-snow">{stats.analyzedAt ? dt(stats.analyzedAt) : "—"}</Mono></span>
          <span className="ml-auto font-mono">Decisions → {(Object.entries(stats.decisionCounts ?? {}) as [string, number][]).map(([k, v]) => `${k}:${v}`).join("  ·  ")}</span>
        </div>
      </Card>
    </div>
  );
}
