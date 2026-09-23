import Link from "next/link";
import { Card, CardHead, Kpi, Mono, PageHead, DecisionPill, Empty, Meter } from "@/components/ui";
import EChart, { AXIS, TOOLTIP } from "@/components/echart";
import { getActiveBatch, getAnomalyQueue, getAudit, getEquipmentEvents } from "@/lib/queries";
import { dt, fmt, cn } from "@/lib/utils";
import { ArrowRight, Gauge, ShieldAlert, Sparkles, Wrench, Layers, ShieldCheck, Radar } from "lucide-react";
import UploadAnalyze from "@/components/upload-analyze";

export const dynamic = "force-dynamic";

export default async function Overview() {
  const batch = await getActiveBatch();
  if (!batch) return <div className="text-fog">No batch. Trigger POST /api/seed.</div>;
  const stats: any = batch.stats ?? {};
  const quality: any = batch.dataQuality ?? {};
  const dist = stats.dist ?? {};
  const queue = (await getAnomalyQueue(batch.id)).slice(0, 6);
  const events = await getEquipmentEvents();
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
      type: "pie", radius: ["56%", "80%"], center: ["50%", "50%"],
      label: { show: false },
      labelLine: { show: false },
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

  const healthyPct = (((dist.healthy ?? 0) + (dist.qualified ?? 0)) / batch.componentCount * 100).toFixed(1);
  const legend: [string, string, number][] = [
    ["Healthy", "#34d399", dist.healthy ?? 0],
    ["Early-qualified", "#38bdf8", dist.qualified ?? 0],
    ["Watch", "#fbbf24", dist.watch ?? 0],
    ["Review", "#c084fc", dist.review ?? 0],
    ["Critical", "#f87171", dist.critical ?? 0],
    ["Unknown", "#5b6675", dist.unknown ?? 0],
  ];
  const total = legend.reduce((s, [, , v]) => s + v, 0) || 1;

  return (
    <div className="fade-in space-y-4">
      {/* Mission header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="mb-1 flex items-center gap-2 text-[10px] uppercase tracking-[0.16em] text-fog">
            <Radar size={11} className="text-sky-300" /> Mission Control
          </div>
          <h1 className="font-mono text-[20px] font-semibold tracking-tight text-snow">{batch.batchCode}</h1>
          <p className="mt-0.5 text-[12px] leading-relaxed text-fog">
            {fmt(batch.componentCount, 0)} components · 168h burn-in · physics-informed screening pipeline <span className="font-mono text-snow">PRES-IF v1.4</span>
          </p>
        </div>
        <UploadAnalyze batchId={batch.id} />
      </div>

      {/* KPI row — accents match the risk palette */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Components" accent="#38bdf8" value={fmt(batch.componentCount, 0)} sub={`lots ${new Set((stats.lots ?? []).map((l: any) => l.lot)).size} · 8 chambers`} />
        <Kpi label="Healthy + qualified" accent="#34d399" value={fmt((dist.healthy ?? 0) + (dist.qualified ?? 0), 0)} tone="text-emerald-300" sub={`${healthyPct}% of population`} />
        <Kpi label="Watch" accent="#fbbf24" value={fmt(dist.watch ?? 0, 0)} tone="text-amber-300" sub="within limits, elevated risk" />
        <Kpi label="Critical + review" accent="#f87171" value={fmt((dist.critical ?? 0) + (dist.review ?? 0), 0)} tone="text-red-300" sub={`${stats.flagged ?? 0} dynamically flagged`} />
        <Kpi label="Data quality" accent="#22d3ee" value={`${quality.score ?? "—"}%`} tone="text-sky-300" sub={`missing ${quality.missingPct ?? 0}% · dupes ${quality.duplicatePct ?? 0}%`} />
        <Kpi label="Hidden anomalies" accent="#c084fc" value={fmt(stats.hiddenCount ?? 0, 0)} tone="text-purple-300" sub="static PASS / dynamic FAIL" />
      </div>

      {/* Charts — donut owns the visual center */}
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
        <Card className="card-hover xl:col-span-2">
          <CardHead title="Batch health trend — physics-normalized leakage" sub="population mean µA at 125°C reference · red bars = anomaly onsets" />
          <EChart option={healthOpt} height={230} />
        </Card>
        <Card className="card-hover flex flex-col">
          <CardHead title="Risk distribution" sub="deterministic risk engine output" />
          <div className="relative w-full">
            <EChart option={donut} height={230} />
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <div className="tabular font-mono text-[24px] font-semibold leading-none text-snow">{fmt(total, 0)}</div>
              <div className="mt-1 text-[9px] uppercase tracking-[0.14em] text-fog">units screened</div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 border-t border-line px-4 py-2.5">
            {legend.map(([name, color, v]) => (
              <div key={name} className="flex items-center gap-1.5 text-[10.5px]">
                <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: color }} />
                <span className="truncate text-fog">{name}</span>
                <span className="tabular ml-auto font-mono text-snow">{fmt(v, 0)}</span>
                <span className="tabular w-9 text-right font-mono text-[9.5px] text-fog">{((v / total) * 100).toFixed(1)}%</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Equipment / environment alerts — full-width section */}
      <section aria-label="Equipment / environment alerts">
        <div className="mb-2 flex flex-wrap items-end justify-between gap-2 px-0.5">
          <div>
            <h2 className="flex items-center gap-2 text-[13px] font-semibold tracking-tight text-snow">
              <Wrench size={13} className="text-cyan-300" /> Equipment / environment alerts
              <span className="rounded border border-cyan-400/25 bg-cyan-400/10 px-1.5 py-0.5 font-mono text-[9.5px] font-normal uppercase tracking-wider text-cyan-300">{events.length} correlated</span>
            </h2>
            <p className="mt-0.5 text-[11px] text-fog">Fault-discrimination engine — instrumentation transients, lot-level process shifts and thermal coupling, auto-separated from component failures.</p>
          </div>
          <Link href="/root-cause" className="flex items-center gap-1 text-[11px] text-sky-300 transition-colors hover:text-sky-200">Full correlation view <ArrowRight size={11} /></Link>
        </div>
        {events.length === 0 ? (
          <Card><Empty msg="No equipment correlations detected — measurement channels and chamber zones are clean." /></Card>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {events.slice(0, 3).map((e) => {
              const tone = e.confidence === "high"
                ? { pill: "border-red-400/30 bg-red-400/10 text-red-300", Icon: ShieldAlert, icon: "text-red-300" }
                : e.confidence === "medium"
                  ? { pill: "border-amber-400/30 bg-amber-400/10 text-amber-300", Icon: Gauge, icon: "text-amber-300" }
                  : { pill: "border-cyan-400/30 bg-cyan-400/10 text-cyan-300", Icon: Wrench, icon: "text-cyan-300" };
              return (
                <div key={e.id} className="alert-item card-hover flex flex-col p-3.5" style={Object.fromEntries(e.confidence === "high"
                  ? [["--alert-line", "rgb(248 113 113 / 0.3)"], ["--alert-bg", "rgb(248 113 113 / 0.05)"]]
                  : e.confidence === "medium"
                    ? [["--alert-line", "rgb(251 191 36 / 0.28)"], ["--alert-bg", "rgb(251 191 36 / 0.05)"]]
                    : [["--alert-line", "rgb(34 211 238 / 0.28)"], ["--alert-bg", "rgb(34 211 238 / 0.05)"]]) as React.CSSProperties}>
                  <div className="flex items-center gap-2">
                    <tone.Icon size={13} className={tone.icon} />
                    <span className="truncate font-mono text-[11.5px] font-medium tracking-wide text-snow">{e.eventType.replaceAll("_", " ")}</span>
                    <span className={cn("ml-auto shrink-0 rounded border px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-wider", tone.pill)}>{e.confidence}</span>
                  </div>
                  <p className="mt-2 line-clamp-4 flex-1 text-[11px] leading-relaxed text-fog" title={e.assessment ?? undefined}>{e.assessment}</p>
                  <div className="mt-2.5 flex items-center gap-3 border-t border-line pt-2 text-[10px] text-fog">
                    {e.chamberZone && <span>zone <Mono className="text-snow">{e.chamberZone}</Mono></span>}
                    {e.lotId && <span>lot <Mono className="text-snow">{e.lotId}</Mono></span>}
                    <span className="ml-auto flex items-center gap-1"><Layers size={10} /> <Mono className="text-snow">{e.affectedCount}</Mono> units</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <div className="mt-3 flex items-start gap-2.5 rounded-lg border border-purple-400/25 bg-purple-400/10 p-3 text-[11px] leading-relaxed text-purple-200">
          <Sparkles size={13} className="mt-0.5 shrink-0" />
          <span>
            <b className="font-medium">Invisible failures:</b> {stats.hiddenCount ?? 0} components pass static limits but are anomalous vs population dynamics — the reason this pipeline exists.{" "}
            <Link href="/anomalies?mode=hidden" className="underline underline-offset-2 hover:text-purple-100">Inspect them</Link>
          </span>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
        {/* Priority anomaly queue */}
        <Card className="card-hover xl:col-span-2">
          <CardHead
            title="Priority anomaly queue"
            sub="ranked by dynamic anomaly score"
            right={<Link href="/anomalies" className="flex items-center gap-1 text-[11px] text-sky-300 hover:text-sky-200">Open triage <ArrowRight size={11} /></Link>}
          />
          <div className="divide-y divide-line">
            {queue.map(({ a, c, sig }) => (
              <Link key={a.id} href={`/components/${c.componentCode}`} className="group flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-panel2">
                <Mono className="w-24 shrink-0 text-[12px] text-sky-300 group-hover:text-sky-200">{c.componentCode}</Mono>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12px] text-snow">{sig?.signature ?? a.signature}</div>
                  <div className="text-[10.5px] text-fog">{c.lotId} · {c.socketId} · onset T+{a.hour}h</div>
                </div>
                <DecisionPill decision={c.decision} />
                <span className="hidden w-14 shrink-0 sm:block">
                  <Meter value={a.anomalyScore * 100} tone={a.anomalyScore >= 0.85 ? "#f87171" : "#fbbf24"} />
                </span>
                <span className={cn("tabular w-10 shrink-0 text-right font-mono text-[12px]", a.anomalyScore >= 0.85 ? "text-red-300" : "text-amber-300")}>{a.anomalyScore.toFixed(2)}</span>
              </Link>
            ))}
            {queue.length === 0 && <Empty msg="No anomalies in queue." />}
          </div>
        </Card>

        {/* Audit + decision provenance */}
        <div className="space-y-3">
          <Card className="card-hover">
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
          <Card className="card-hover">
            <CardHead title="Decision provenance" sub="deterministic · model-versioned · reproducible" />
            <div className="space-y-2 px-4 py-3 text-[11px] text-fog">
              <div className="flex items-center gap-2"><ShieldCheck size={12} className="shrink-0 text-emerald-300" /> Thresholds configurable per lot class, versioned with every run</div>
              <div className="flex items-center gap-2"><Gauge size={12} className="shrink-0 text-sky-300" /> Runtime <Mono className="text-snow">{fmt(stats.pipelineMs, 0)} ms</Mono> · analyzed {stats.analyzedAt ? dt(stats.analyzedAt) : "—"}</div>
              <div className="flex flex-wrap gap-1.5 pt-0.5">
                {(Object.entries(stats.decisionCounts ?? {}) as [string, number][]).map(([k, v]) => (
                  <span key={k} className="rounded border border-line bg-panel2 px-1.5 py-0.5 font-mono text-[10px]"><span className="text-snow">{v}</span> <span className="text-fog">{k}</span></span>
                ))}
              </div>
            </div>
          </Card>
        </div>
      </div>

      {/* Summary strip */}
      <Card>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 text-[11px] text-fog">
          <span className="flex items-center gap-1.5"><ShieldAlert size={12} className="text-amber-300" /> Decision engine: deterministic, model-versioned, thresholds configurable</span>
          <span>Analyzed: <Mono className="text-snow">{stats.analyzedAt ? dt(stats.analyzedAt) : "—"}</Mono></span>
          <span className="ml-auto font-mono">PRES-IF v1.4 · DRIFT-LIN v2.1 · offline profile</span>
        </div>
      </Card>
    </div>
  );
}
