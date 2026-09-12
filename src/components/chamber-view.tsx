"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cn, fmt, STATUS_META } from "@/lib/utils";
import { DecisionPill, StatusPill } from "@/components/ui";
import { Card, CardHead, Meter } from "@/components/ui";
import { Flame, Activity, TrendingUp, Wrench, X, ArrowUpRight } from "lucide-react";

interface SocketComp {
  id: number; code: string; row: number; col: number; socket: string; lot: string; wafer: string;
  channel: string; status: string; decision: string | null; anomalyScore: number | null;
  driftSlope: number | null; riskLevel: string | null; hidden: boolean | null;
}
type Overlay = "status" | "heat" | "anomaly" | "drift";

const OVERLAYS: { key: Overlay; label: string; icon: any }[] = [
  { key: "status", label: "Status", icon: Activity },
  { key: "heat", label: "Heat", icon: Flame },
  { key: "anomaly", label: "Anomaly", icon: Activity },
  { key: "drift", label: "Drift", icon: TrendingUp },
];

export default function ChamberView({ batchCode, rack, comps, telStats, equipChannels, channels }: {
  batchCode: string; rack: number; comps: SocketComp[];
  telStats: Record<number, { meanTemp: number; maxLeak: number; lastLeak: number }>;
  equipChannels: (string | null)[]; channels: { channel: string; count: number; flagged: number }[];
}) {
  const router = useRouter();
  const [overlay, setOverlay] = useState<Overlay>("status");
  const [filter, setFilter] = useState("all");
  const [lotFilter, setLotFilter] = useState("all");
  const [sel, setSel] = useState<SocketComp | null>(null);

  const lots = useMemo(() => [...new Set(comps.map((c) => c.lot))].sort(), [comps]);
  const temps = comps.map((c) => telStats[c.id]?.meanTemp).filter((x): x is number => x != null);
  const tMin = Math.min(...temps, 121), tMax = Math.max(...temps, 130);
  const zoneA_t = temps.length ? temps.reduce((a, b) => a + b, 0) / temps.length : 0;
  const zoneHot = comps.filter((c) => (c.row === 2 || c.row === 3) && c.col >= 8 && c.col <= 10);
  const hotT = zoneHot.map((c) => telStats[c.id]?.meanTemp ?? 0).filter(Boolean);
  const hotMean = hotT.length ? hotT.reduce((a, b) => a + b) / hotT.length : 0;

  const colorFor = (c: SocketComp): string => {
    const t = telStats[c.id];
    if (overlay === "heat") {
      if (!t) return "#232a36";
      const f = Math.max(0, Math.min(1, (t.meanTemp - tMin) / Math.max(0.5, tMax - tMin)));
      return `rgb(${Math.round(40 + f * 190)}, ${Math.round(90 - f * 40)}, ${Math.round(120 - f * 70)})`;
    }
    if (overlay === "anomaly") {
      const s = c.anomalyScore ?? 0;
      if (s >= 0.85) return "#b91c1c"; if (s >= 0.6) return "#d97706"; if (s >= 0.3) return "#3f6212";
      return "#166534";
    }
    if (overlay === "drift") {
      const d = c.driftSlope ?? 0;
      if (d > 0.08) return "#b91c1c"; if (d > 0.035) return "#d97706"; if (d > 0.012) return "#eab30880";
      return "#1e3a5f";
    }
    const m = STATUS_META[c.status] ?? STATUS_META.unknown;
    return m.hex + (c.status === "healthy" ? "55" : "");
  };

  const visible = (c: SocketComp) =>
    (filter === "all" || c.status === filter || (filter === "equip" && c.decision === "EQUIP HOLD") || (filter === "hidden" && c.hidden)) &&
    (lotFilter === "all" || c.lot === lotFilter);

  const counts = useMemo(() => {
    const o: Record<string, number> = {};
    comps.forEach((c) => (o[c.status] = (o[c.status] ?? 0) + 1));
    return o;
  }, [comps]);

  // histogram of temps
  const hist = useMemo(() => {
    const bins = new Array(12).fill(0);
    const lo = tMin, hi = tMax + 0.01;
    temps.forEach((t) => bins[Math.min(11, Math.floor(((t - lo) / (hi - lo)) * 12))]++);
    return { bins, lo, hi };
  }, [temps, tMin, tMax]);

  return (
    <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1fr_290px]">
      <Card>
        <CardHead
          title={`${batchCode} · chamber rack R${rack + 1} / 8`}
          sub="8 rows × 16 columns · channel = column group"
          right={
            <div className="flex items-center gap-1.5">
              {OVERLAYS.map((o) => (
                <button key={o.key} onClick={() => setOverlay(o.key)}
                  className={cn("flex items-center gap-1 rounded border px-2 py-1 text-[10.5px] transition-colors",
                    overlay === o.key ? "border-sky-400/40 bg-sky-400/10 text-sky-200" : "border-line bg-panel2 text-fog hover:text-snow")}>
                  <o.icon size={11} /> {o.label}
                </button>
              ))}
              <select value={rack} onChange={(e) => router.push(`/chamber?r=${e.target.value}`)}
                className="ml-2 rounded border border-line bg-panel2 px-2 py-1 font-mono text-[11px] text-snow outline-none">
                {[0, 1, 2, 3, 4, 5, 6, 7].map((r) => <option key={r} value={r}>Rack R{r + 1}</option>)}
              </select>
            </div>
          }
        />
        <div className="p-4">
          {/* column numbers */}
          <div className="mb-1 grid grid-cols-[28px_repeat(16,1fr)] gap-[5px]">
            <div />
            {Array.from({ length: 16 }, (_, i) => (
              <div key={i} className={cn("text-center font-mono text-[9px] text-fog", equipChannels.includes(`CH-0${(i % 8) + 1}`) && "text-cyan-300")}>
                {String(i + 1).padStart(2, "0")}
              </div>
            ))}
          </div>
          {Array.from({ length: 8 }, (_, row) => (
            <div key={row} className="mb-[5px] grid grid-cols-[28px_repeat(16,1fr)] gap-[5px]">
              <div className="flex items-center justify-center font-mono text-[9px] text-fog">{"ABCDEFGH"[row]}</div>
              {Array.from({ length: 16 }, (_, col) => {
                const c = comps.find((x) => x.row === row && x.col === col);
                if (!c) return <div key={col} className="aspect-square rounded-[3px] border border-line/60 bg-[#0a0e13]" />;
                const dim = !visible(c);
                const isEquip = c.decision === "EQUIP HOLD";
                return (
                  <button
                    key={col} onClick={() => setSel(c)}
                    title={`${c.code} · ${c.socket}\n${c.status} · AS ${fmt(c.anomalyScore)} · ${fmt(telStats[c.id]?.meanTemp)}°C`}
                    className={cn("socket group relative aspect-square rounded-[3px] border", dim && "opacity-20",
                      isEquip ? "border-cyan-300/70" : "border-black/40")}
                    style={{ background: colorFor(c) }}
                  >
                    {c.hidden && <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-purple-300 ring-2 ring-ink" />}
                    {isEquip && <span className="absolute inset-0 m-auto h-1 w-1 rounded-full bg-cyan-200" />}
                  </button>
                );
              })}
            </div>
          ))}
          {/* legend */}
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[10px] text-fog">
            {overlay === "status" && (Object.entries(STATUS_META) as [string, any][]).map(([k, m]) => (
              <span key={k} className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: m.hex }} />{m.label}</span>
            ))}
            {overlay === "heat" && <><span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: "rgb(40,90,120)" }} />cool</span><span>→</span><span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: "rgb(230,50,50)" }} />hot</span></>}
            {overlay === "anomaly" && <><span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-emerald-700" />AS &lt; 0.3</span><span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-amber-600" />0.6+</span><span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-red-700" />0.85+</span></>}
            {overlay === "drift" && <><span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: "#1e3a5f" }} />stable</span><span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-amber-600" />slope &gt; 0.035/h</span><span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-red-700" />&gt; 0.08/h</span></>}
            <span className="ml-auto flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-purple-300" /> hidden (static-pass) <span className="ml-3 inline-block h-1.5 w-1.5 rounded-full bg-cyan-200" /> equipment-correlated</span>
          </div>
        </div>
      </Card>

      {/* side panel */}
      <div className="space-y-3">
        <Card>
          <CardHead title="Filters" />
          <div className="space-y-2 p-3">
            <select value={filter} onChange={(e) => setFilter(e.target.value)} className="w-full rounded border border-line bg-panel2 px-2 py-1.5 text-[11.5px] text-snow outline-none">
              <option value="all">All statuses ({comps.length})</option>
              {Object.entries(counts).map(([k, v]) => <option key={k} value={k}>{STATUS_META[k]?.label ?? k} ({v})</option>)}
              <option value="equip">Equipment-correlated</option>
              <option value="hidden">Hidden anomalies</option>
            </select>
            <select value={lotFilter} onChange={(e) => setLotFilter(e.target.value)} className="w-full rounded border border-line bg-panel2 px-2 py-1.5 font-mono text-[11.5px] text-snow outline-none">
              <option value="all">All lots</option>
              {lots.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
        </Card>
        <Card>
          <CardHead title="Chamber temperature" sub={`rack mean ${fmt(zoneA_t)}°C`} />
          <div className="p-3">
            <div className="flex h-16 items-end gap-[3px]">
              {hist.bins.map((b, i) => (
                <div key={i} className="flex-1 rounded-t-sm bg-sky-400/50" style={{ height: `${Math.max(4, (b / Math.max(...hist.bins, 1)) * 100)}%` }} title={`${b} sockets`} />
              ))}
            </div>
            <div className="mt-1 flex justify-between font-mono text-[9px] text-fog"><span>{hist.lo.toFixed(1)}°C</span><span>{hist.hi.toFixed(1)}°C</span></div>
            <div className={cn("mt-2 rounded border p-2 text-[10.5px]", hotMean - zoneA_t > 1.5 ? "border-amber-400/25 bg-amber-400/10 text-amber-200" : "border-line bg-panel2 text-fog")}>
              Spatial hotspot: zone C09–C11/B rows runs <b className="font-mono">+{fmt(hotMean - zoneA_t)}°C</b> vs rack mean — physics normalization compensates.
            </div>
          </div>
        </Card>
        <Card>
          <CardHead title="Channel watch" sub="flagged units per measurement channel (batch)" />
          <div className="space-y-2 p-3">
            {channels.map((ch) => (
              <div key={ch.channel} className="flex items-center gap-2">
                <span className={cn("w-14 font-mono text-[10px]", ch.flagged >= 8 ? "text-cyan-300" : "text-fog")}>{ch.channel}</span>
                <Meter value={ch.flagged} max={Math.max(4, ...channels.map((x) => x.flagged))} tone={ch.flagged >= 8 ? "#22d3ee" : ch.flagged > 0 ? "#f87171" : "#243042"} />
                <span className="w-6 text-right font-mono text-[10px] text-snow">{ch.flagged}</span>
              </div>
            ))}
            <div className="pt-1 text-[10px] leading-relaxed text-fog">CH-07 cohort flagged with synchronized onset → instrumentation event, not component failures.</div>
          </div>
        </Card>
      </div>

      {/* drawer */}
      {sel && (
        <div className="fixed inset-y-0 right-0 z-40 w-[380px] border-l border-line2 bg-panel shadow-2xl">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <div>
              <div className="font-mono text-[14px] text-sky-300">{sel.code}</div>
              <div className="font-mono text-[10px] text-fog">{sel.socket} · {sel.channel} · {sel.lot} / {sel.wafer}</div>
            </div>
            <button onClick={() => setSel(null)} className="text-fog hover:text-snow"><X size={16} /></button>
          </div>
          <div className="space-y-3 p-4">
            <div className="flex items-center gap-2"><StatusPill status={sel.status} /><DecisionPill decision={sel.decision} /></div>
            <div className="grid grid-cols-2 gap-2">
              {[
                ["Anomaly score", fmt(sel.anomalyScore)], ["Drift slope", `${fmt(sel.driftSlope, 3)} µA/24h`],
                ["Mean temp", `${fmt(telStats[sel.id]?.meanTemp)}°C`], ["Last leak", `${fmt(telStats[sel.id]?.lastLeak)} µA`],
                ["Max leak", `${fmt(telStats[sel.id]?.maxLeak)} µA`], ["Risk level", sel.riskLevel ?? "—"],
              ].map(([k, v]) => (
                <div key={k} className="rounded border border-line bg-panel2 px-2.5 py-2">
                  <div className="text-[9px] uppercase tracking-wider text-fog">{k}</div>
                  <div className="tabular mt-0.5 font-mono text-[13px] text-snow">{v}</div>
                </div>
              ))}
            </div>
            {sel.hidden && (
              <div className="rounded border border-purple-400/30 bg-purple-400/10 p-2.5 text-[11px] leading-relaxed text-purple-200">
                Static screen PASS, dynamic model ANOMALOUS — invisible-failure candidate. Recommend manual review.
              </div>
            )}
            <Link href={`/components/${sel.code}`} className="flex items-center justify-center gap-1.5 rounded-md border border-sky-400/30 bg-sky-400/10 px-3 py-2 text-[12px] text-sky-200 hover:bg-sky-400/15">
              Open Digital Passport <ArrowUpRight size={13} />
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
