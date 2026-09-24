"use client";

import { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import { LineChart, BarChart, ScatterChart, PieChart, BoxplotChart } from "echarts/charts";
import {
  GridComponent, TooltipComponent, MarkLineComponent, MarkAreaComponent,
  DataZoomComponent, LegendComponent, VisualMapComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([LineChart, BarChart, ScatterChart, PieChart, BoxplotChart, GridComponent, TooltipComponent,
  MarkLineComponent, MarkAreaComponent, DataZoomComponent, LegendComponent, VisualMapComponent, CanvasRenderer]);

export const AXIS = {
  axisLine: { lineStyle: { color: "#243042" } },
  axisLabel: { color: "#8b95a5", fontSize: 10, fontFamily: "JetBrains Mono, monospace" },
  splitLine: { lineStyle: { color: "rgba(36,48,66,0.4)", type: "dashed" as const } },
  axisTick: { show: false },
};
export const TOOLTIP = {
  backgroundColor: "#0e141b", borderColor: "#243042", textStyle: { color: "#dce3ec", fontSize: 11, fontFamily: "JetBrains Mono, monospace" },
};

// Function descriptors, for options built in Server Components.
// Functions cannot cross the server→client serialization boundary, so pages
// pass a small named descriptor and this component restores the real function
// on the client just before the option is handed to ECharts.
export type FnDesc =
  | { kind: "percent"; frac: number; color: string } // value/frac → percent text
  | { kind: "scatterTempLeak" } // [temp, leak, score, code, status]
  | { kind: "hourMedian" } // [hour, median]
  | { kind: "scatterSymbol" } // d[2] = anomaly score
  | { kind: "histBin"; hMax: number; nb: number } // [binStart, count] with zone name
  | { kind: "lotBox" } // lot boxplot quintiles
  | { kind: "donutRisk" } // pie: risk-band explanation
  | { kind: "healthTrend" } // axis trigger: mean µA + onset count
  | { kind: "driftBin" } // drift-slope histogram bin
  | { kind: "corridorTip" } // axis trigger: corridor percentile lines
  | { kind: "sigPie" }; // root-cause signature pie

type Formatter = (p: any) => string;

const percentFormatter = (frac: number): Formatter => (p: any) => {
  const v = typeof p.value === "number" ? p.value : Number(p.value);
  return `${Number.isFinite(v) ? v : p.value}% flagged`;
};
const scatterTempLeakFormatter: Formatter = (p: any) =>
  `<b>${p.data[3]}</b><br/>temp ${(+p.data[0]).toFixed(2)}°C<br/>last leak ${(+p.data[1]).toFixed(3)} µA<br/>${p.data[4]}`;
const hourMedianFormatter: Formatter = (p: any) =>
  `T+${p.data[0]}h · median ${(+p.data[1]).toFixed(3)} µA`;
const zoneOf = (ua: number) => (ua > 5 ? "above static limit — fails screen" : ua > 4 ? "elevated zone (4–5 µA)" : "within normal zone");
const histBinFormatter = (hMax: number, nb: number): Formatter => (p: any) => {
  const start = typeof p.data?.[0] === "number" ? p.data[0] : parseFloat(p.name) || 0;
  const w = hMax / nb;
  return `<b>${start.toFixed(2)}–${(start + w).toFixed(2)} µA</b><br/>${p.data?.[1] ?? p.value} components<br/><span style="color:#8b95a5">${zoneOf(start)}</span>`;
};
const lotBoxFormatter: Formatter = (p: any) => {
  const d = Array.isArray(p.data) ? p.data : [];
  if (d.length >= 5) return `<b>${p.name}</b><br/>P98 max ${(+d[4]).toFixed(2)} · P75 ${(+(d[3] ?? 0)).toFixed(2)}<br/>median <b>${(+d[2]).toFixed(2)} µA</b><br/>P25 ${(+(d[1] ?? 0)).toFixed(2)} · P2 min ${(+d[0]).toFixed(2)}`;
  return `${p.name}: ${String(p.value)}`;
};
const RISK_WHAT: Record<string, string> = {
  Healthy: "risk ≤ 30 — within all limits, nominal dynamics",
  "Early-qualified": "eligible for accelerated release (PASS_EARLY)",
  Watch: "risk 31–60 — in limits, elevated dynamics; monitor",
  Review: "risk 61–80 — engineering review before disposition",
  Critical: "risk > 80 — REJECT path, quarantine for inspection",
  Unknown: "insufficient data — routed to manual QC",
};
const donutRiskFormatter: Formatter = (p: any) =>
  `<b>${p.name}</b> — ${p.value} units (${(p.percent ?? 0).toFixed?.(1) ?? p.percent}%)<br/><span style="color:#8b95a5">${RISK_WHAT[p.name] ?? ""}</span>`;
const healthTrendFormatter: Formatter = (ps: any) => {
  const list = Array.isArray(ps) ? ps : [ps];
  const h = list[0]?.axisValue ?? "";
  const rows = list.map((p: any) => {
    if (p.seriesName === "Batch mean (physics-norm)") return `<b>batch mean</b> ${(+p.value).toFixed(3)} µA`;
    if (p.seriesName === "Onsets") return p.value > 0 ? `<b style="color:#f87171">${p.value} anomaly onset${p.value > 1 ? "s" : ""}</b> at T+${h}h` : "";
    return "";
  }).filter(Boolean);
  return `<b>T+${h}h</b><br/>${rows.join("<br/>")}`;
};
const driftBinFormatter: Formatter = (p: any) => {
  const v = parseFloat(p.name);
  const zone = v > 0.002 ? '<br/><span style="color:#c084fc">rising fast — typical of flagged drifters</span>' : v < -0.002 ? '<br/><span style="color:#38bdf8">falling — settling/anneal behaviour</span>' : "";
  return `<b>${v.toFixed(3)} µA/24h</b><br/>${p.value} components${zone}`;
};
const corridorTipFormatter: Formatter = (ps: any) => {
  const list = Array.isArray(ps) ? ps : [ps];
  const h = list[0]?.value?.[0] ?? list[0]?.axisValue ?? "";
  const med = list.find((p: any) => p.seriesName === "median")?.value?.[1];
  return `<b>T+${h}h · normal cohort</b><br/>median ${med != null ? (+med).toFixed(3) : "—"} µA<br/><span style="color:#38bdf8">P16–P84 band</span> + <span style="color:#fbbf24">P0.15–P99.85 guides</span>`;
};
const SIG_WHAT: Record<string, string> = {
  "TDDB-like leakage growth": "insulation degradation — leakage climbs under sustained field stress",
  "BTI/HCI-like drift": "threshold drift under bias/temperature — parametric wear-out",
  "die-fracture-like": "crack signature — abrupt parametric jump, often handling-related",
  "bond-fatigue-like": "intermittent contact — erratic, non-monotonic behaviour",
  instrumentation: "test-harness artifact — synchronized cohort, not device physics",
};
const sigPieFormatter: Formatter = (p: any) =>
  `<b>${p.name}</b> — ${p.value} component${p.value === 1 ? "" : "s"} (${(p.percent ?? 0).toFixed?.(0) ?? p.percent}%)<br/><span style="color:#8b95a5">${SIG_WHAT[p.name] ?? "pattern-based hypothesis, needs FA to confirm"}</span>`;

export function makeFormatter(desc: FnDesc): Formatter {
  switch (desc.kind) {
    case "percent":
      return (p) => `${p.name ?? ""}: ${p.value}% flagged`;
    case "scatterTempLeak":
      return scatterTempLeakFormatter;
    case "hourMedian":
      return hourMedianFormatter;
    case "scatterSymbol":
      return (p) => String(p.value ?? "");
    case "histBin":
      return histBinFormatter(desc.hMax, desc.nb);
    case "lotBox":
      return lotBoxFormatter;
    case "donutRisk":
      return donutRiskFormatter;
    case "healthTrend":
      return healthTrendFormatter;
    case "driftBin":
      return driftBinFormatter;
    case "corridorTip":
      return corridorTipFormatter;
    case "sigPie":
      return sigPieFormatter;
    default:
      return (p) => String(p.value ?? "");
  }
}

export function makeColorFn(desc: FnDesc): (p: any) => any {
  switch (desc.kind) {
    case "percent":
      return (p) => (typeof p.value === "number" ? p.value : Number(p.value)) / (desc.frac || 1) > 2 ? "#f87171" : (typeof p.value === "number" ? p.value : Number(p.value)) / (desc.frac || 1) > 1 ? "#fbbf24" : "#38bdf8aa";
    case "scatterTempLeak":
      return (p) => ({ healthy: "#34d39966", watch: "#fbbf24cc", critical: "#f87171ee", qualified: "#38bdf866", unknown: "#5b667599" } as any)[p.data[4]] ?? "#5b667599";
    case "hourMedian":
      return () => "#c084fc99";
    case "scatterSymbol":
      return (d: any) => (d[2] > 0.6 ? 7 : 4);
    default:
      return () => "#5b667599";
  }
}

function restoreFns<T>(option: T): T {
  if (Array.isArray(option)) return option.map(restoreFns) as unknown as T;
  if (option && typeof option === "object") {
    const desc = (option as any).__fn;
    if (desc) {
      if (desc.use === "color") {
        const fn = makeColorFn(desc.desc);
        (option as any).__fn = undefined;
        return fn as unknown as T;
      }
      const fn = makeFormatter(desc.desc);
      (option as any).__fn = undefined;
      return fn as unknown as T;
    }
    const out: any = {};
    for (const k of Object.keys(option as any)) out[k] = restoreFns((option as any)[k]);
    return out;
  }
  return option;
}

export default function EChart({ option, height = 260, className, onClickPoint }: {
  option: any; height?: number; className?: string; onClickPoint?: (params: any) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current, undefined, { renderer: "canvas" });
    chartRef.current = chart;
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(ref.current);
    return () => { ro.disconnect(); chart.dispose(); };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const restored = restoreFns(option);
    chart.setOption(restored, { notMerge: true });
    chart.off("click");
    if (onClickPoint) chart.on("click", onClickPoint);
  }, [option, onClickPoint]);

  return <div ref={ref} style={{ height }} className={className} />;
}
