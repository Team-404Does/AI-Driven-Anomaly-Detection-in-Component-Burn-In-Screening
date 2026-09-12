"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Play, Pause, SkipForward, Users } from "lucide-react";
import { cn } from "@/lib/utils";

interface Pt { h: number; l: number | null }

export default function Replay({ tel, peerTel, anomalyHour, limit = 5 }: {
  tel: Pt[]; peerTel: Pt[] | null; anomalyHour: number | null; limit?: number;
}) {
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [showPeer, setShowPeer] = useState(false);
  const raf = useRef<any>(null);

  const maxH = tel[tel.length - 1]?.h ?? 168;
  const stateAt = (h: number) => {
    const v = tel.filter((p) => p.h <= h && p.l != null).pop()?.l ?? 0;
    if (v > limit) return "CRITICAL";
    if (anomalyHour != null && h >= anomalyHour && v > limit * 0.7) return "ANOMALOUS";
    if (anomalyHour != null && h >= anomalyHour) return "WATCH";
    if (v > limit * 0.8) return "WATCH";
    return "NORMAL";
  };
  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    const tick = (t: number) => {
      if (t - last > 220 / speed) {
        last = t;
        setCursor((c) => (c >= tel.length - 1 ? 0 : c + 1));
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [playing, speed, tel.length]);

  const W = 640, H = 170, PL = 40, PR = 8, PB = 20;
  const x = (h: number) => PL + (h / maxH) * (W - PL - PR);
  const yMax = Math.max(limit * 1.4, ...tel.map((p) => p.l ?? 0)) * 1.08;
  const y = (v: number) => H - PB - (v / yMax) * (H - PB - 12);
  const shown = tel.slice(0, cursor + 1);
  const path = useMemo(() => shown.filter((p) => p.l != null).map((p, i) => `${i === 0 ? "M" : "L"}${x(p.h).toFixed(1)},${y(p.l!).toFixed(1)}`).join(" "), [cursor, tel]);
  const peerPath = useMemo(() => (peerTel ?? []).filter((p) => p.l != null).map((p, i) => `${i === 0 ? "M" : "L"}${x(p.h).toFixed(1)},${y(p.l!).toFixed(1)}`).join(" "), [peerTel, showPeer]);
  const cur = shown[shown.length - 1];
  const curH = cur?.h ?? 0;
  const state = stateAt(curH);
  const stateColor = { NORMAL: "#34d399", WATCH: "#fbbf24", ANOMALOUS: "#fb923c", CRITICAL: "#f87171" }[state];
  const anomalyIdx = anomalyHour != null ? tel.findIndex((p) => p.h >= anomalyHour) : -1;

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <button onClick={() => setPlaying((p) => !p)} className="flex items-center gap-1.5 rounded border border-line2 bg-panel2 px-2.5 py-1 text-[11px] text-snow hover:border-sky-400/40">
          {playing ? <Pause size={11} /> : <Play size={11} />} {playing ? "Pause" : "Play"}
        </button>
        {[1, 4, 16].map((s) => (
          <button key={s} onClick={() => setSpeed(s)} className={cn("rounded border px-2 py-1 font-mono text-[10px]", speed === s ? "border-sky-400/40 bg-sky-400/10 text-sky-200" : "border-line bg-panel2 text-fog")}>{s}×</button>
        ))}
        {anomalyIdx >= 0 && (
          <button onClick={() => { setCursor(anomalyIdx); setPlaying(false); }} className="flex items-center gap-1 rounded border border-amber-400/30 bg-amber-400/10 px-2 py-1 font-mono text-[10px] text-amber-200">
            <SkipForward size={10} /> jump to anomaly T+{anomalyHour}h
          </button>
        )}
        {peerTel && (
          <button onClick={() => setShowPeer((s) => !s)} className={cn("flex items-center gap-1 rounded border px-2 py-1 font-mono text-[10px]", showPeer ? "border-sky-400/40 bg-sky-400/10 text-sky-200" : "border-line bg-panel2 text-fog")}>
            <Users size={10} /> peer comparison
          </button>
        )}
        <div className="ml-auto flex items-center gap-2">
          <span className="font-mono text-[11px] text-fog">T+{curH}h</span>
          <span className="rounded border px-1.5 py-0.5 font-mono text-[10px]" style={{ color: stateColor, borderColor: stateColor + "55", background: stateColor + "18" }}>{state}</span>
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded border border-line bg-[#0a0e13]">
        {/* limit line */}
        <line x1={PL} x2={W - PR} y1={y(limit)} y2={y(limit)} stroke="#f87171" strokeDasharray="5 4" strokeWidth="1" />
        <text x={W - PR - 4} y={y(limit) - 4} fill="#f87171" fontSize="9" textAnchor="end" fontFamily="JetBrains Mono">STATIC LIMIT {limit} µA</text>
        {/* warn band */}
        <rect x={PL} width={W - PL - PR} y={y(limit * 0.8)} height={y(0) - y(limit * 0.8) > 0 ? y(limit * 0.8) - y(limit) : 0} fill="rgba(251,191,36,0.05)" />
        {/* grid */}
        {[0, 42, 84, 126, 168].filter((h) => h <= maxH).map((h) => (
          <g key={h}>
            <line x1={x(h)} x2={x(h)} y1={H - PB} y2={8} stroke="#1a2230" strokeDasharray="2 4" />
            <text x={x(h)} y={H - 6} fill="#8b95a5" fontSize="9" textAnchor="middle" fontFamily="JetBrains Mono">{h}h</text>
          </g>
        ))}
        {anomalyHour != null && (
          <g>
            <line x1={x(anomalyHour)} x2={x(anomalyHour)} y1={10} y2={H - PB} stroke="#fb923c" strokeWidth="1.2" />
            <text x={x(anomalyHour) + 4} y={16} fill="#fb923c" fontSize="9" fontFamily="JetBrains Mono">anomaly start</text>
          </g>
        )}
        {showPeer && peerPath && <path d={peerPath} fill="none" stroke="#38bdf8" strokeWidth="1.2" strokeDasharray="4 3" opacity="0.7" />}
        <path d={path} fill="none" stroke="#e2e8f0" strokeWidth="1.6" />
        {cur?.l != null && <circle cx={x(cur.h)} cy={y(cur.l)} r="3.5" fill={stateColor} stroke="#0a0e13" strokeWidth="1.5" />}
        <line x1={x(curH)} x2={x(curH)} y1={10} y2={H - PB} stroke={stateColor} strokeWidth="0.7" opacity="0.4" />
      </svg>
      <input type="range" min={0} max={tel.length - 1} value={cursor} onChange={(e) => { setCursor(+e.target.value); setPlaying(false); }}
        className="mt-1.5 w-full accent-sky-400" />
    </div>
  );
}
