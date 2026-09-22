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
  | { kind: "scatterSymbol" }; // d[2] = anomaly score

type Formatter = (p: any) => string;

const percentFormatter = (frac: number): Formatter => (p: any) => {
  const v = typeof p.value === "number" ? p.value : Number(p.value);
  return `${Number.isFinite(v) ? v : p.value}% flagged`;
};
const scatterTempLeakFormatter: Formatter = (p: any) =>
  `<b>${p.data[3]}</b><br/>temp ${(+p.data[0]).toFixed(2)}°C<br/>last leak ${(+p.data[1]).toFixed(3)} µA<br/>${p.data[4]}`;
const hourMedianFormatter: Formatter = (p: any) =>
  `T+${p.data[0]}h · median ${(+p.data[1]).toFixed(3)} µA`;

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
