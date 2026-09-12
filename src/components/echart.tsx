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
    chart.setOption(option, { notMerge: true });
    chart.off("click");
    if (onClickPoint) chart.on("click", onClickPoint);
  }, [option, onClickPoint]);

  return <div ref={ref} style={{ height }} className={className} />;
}
