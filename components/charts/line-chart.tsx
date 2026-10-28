"use client";

import { LineChart as LineChartType } from "echarts/charts";
import {
  DataZoomComponent,
  DatasetComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  ToolboxComponent,
  TooltipComponent,
} from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { useEffect, useRef } from "react";
import { buildLineOption, type Line } from "@/lib/echarts-option";
import type { Columns } from "@/lib/sar";

echarts.use([
  LineChartType,
  DataZoomComponent,
  DatasetComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  ToolboxComponent,
  TooltipComponent,
  CanvasRenderer,
]);

type Props = {
  // one header (shared time axis) or independent lines - see buildLineOption
  columns?: Columns;
  lines?: Line[];
  xLabel?: string;
  pointerFormat?: string;
  restarts: number[];
  dark: boolean;
  selected: Record<string, boolean>;
  onSelectedChange: (selected: Record<string, boolean>) => void;
  height?: number;
  label: string;
};

export function LineChart(props: Props) {
  const { columns, lines, xLabel, pointerFormat, restarts, dark, selected, onSelectedChange, height = 380, label } = props;
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const selectedRef = useRef(selected);
  const onSelectedRef = useRef(onSelectedChange);

  useEffect(() => {
    selectedRef.current = selected;
    onSelectedRef.current = onSelectedChange;
  });

  // (Re)create the chart when data or theme change. Legend state is applied
  // separately below so toggling a metric does not rebuild the chart.
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.dataset.state = "rendering";
    const chart = echarts.init(element, dark ? "dark" : undefined, { renderer: "canvas" });
    chartRef.current = chart;
    const started = performance.now();
    chart.on("finished", () => {
      if (element.dataset.state !== "rendered") {
        element.dataset.state = "rendered";
        element.dataset.renderMs = String(Math.round(performance.now() - started));
      }
    });
    chart.on("legendselectchanged", (event) => {
      onSelectedRef.current({ ...(event as { selected: Record<string, boolean> }).selected });
    });
    chart.setOption(buildLineOption({ columns, lines, xLabel, pointerFormat, restarts, dark, selected: selectedRef.current }));

    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(element);
    return () => {
      observer.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, [columns, lines, xLabel, pointerFormat, restarts, dark]);

  useEffect(() => {
    chartRef.current?.setOption({ legend: { selected } });
  }, [selected]);

  return (
    <div
      ref={ref}
      role="img"
      aria-label={label}
      data-testid="echart"
      className="w-full"
      style={{ height }}
    />
  );
}
