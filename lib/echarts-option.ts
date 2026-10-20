// Pure option builder for the SAR line charts. No runtime imports on purpose:
// perf/bench.mjs transpiles this file as-is and runs it in the browser, so the
// benchmark measures exactly the option the app renders.
import type { EChartsOption, LineSeriesOption } from "echarts";
import type { Columns } from "@/lib/sar";

// Bokeh's Category10 - the palette of the current Streamlit charts.
export const PALETTE = [
  "#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd",
  "#8c564b", "#e377c2", "#7f7f7f", "#bcbd22", "#17becf",
];

// Name of the internal series that carries the restart markers.
export const RESTART_SERIES = "LINUX RESTART";

export type LineChartInput = {
  columns: Columns;
  restarts?: number[];
  dark?: boolean;
  // legend state: metric -> visible; missing keys count as visible
  selected?: Record<string, boolean>;
  // 'lttb' keeps peaks while drawing at most ~2 points per pixel
  sampling?: LineSeriesOption["sampling"];
};

export function buildLineOption(input: LineChartInput): EChartsOption {
  const { columns, restarts = [], dark = false, selected = {}, sampling = "lttb" } = input;
  const text = dark ? "#d4d4d4" : "#404040";
  const grid = dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)";
  const many = columns.metrics.length > 12;

  const source: Record<string, (number | null)[]> = { date: columns.x, ...columns.series };

  const series: LineSeriesOption[] = columns.metrics.map((metric) => ({
    type: "line",
    name: metric,
    encode: { x: "date", y: metric },
    showSymbol: false,
    sampling,
    // line series have no `large` mode in ECharts (only scatter/bar/lines);
    // sampling + no animation is what keeps big line charts fast
    lineStyle: { width: many ? 1 : 1.5 },
    emphasis: { focus: "series" },
    connectNulls: false,
  }));

  // Restart markers live on their own empty series that is not in the legend:
  // a markLine disappears together with its series, so attaching it to a metric
  // would hide the restarts whenever that metric is switched off.
  if (restarts.length > 0) {
    series.push({
      type: "line",
      name: RESTART_SERIES,
      data: [],
      silent: true,
      tooltip: { show: false },
      markLine: {
        symbol: "none",
        silent: true,
        lineStyle: { color: "#d62728", type: "dashed", width: 1.5 },
        label: { formatter: "LINUX RESTART", color: text, position: "insideEndTop" },
        data: restarts.map((x) => ({ xAxis: x })),
      },
    });
  }

  return {
    backgroundColor: "transparent",
    animation: false,
    useUTC: true,
    color: PALETTE,
    textStyle: { color: text },
    dataset: { source },
    legend: {
      type: "scroll",
      top: 0,
      left: 0,
      right: 0,
      textStyle: { color: text },
      // metrics only - the restart series must not be toggleable
      data: columns.metrics,
      selected,
    },
    // legend in the first row, toolbox below it - a scrolling legend's pager
    // would otherwise run into the toolbox icons
    grid: { left: 8, right: 16, top: 64, bottom: 64, containLabel: true },
    tooltip: {
      trigger: "axis",
      confine: true,
      axisPointer: { type: "cross", snap: true },
      valueFormatter: (value) =>
        typeof value === "number" ? value.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "–",
    },
    toolbox: {
      right: 8,
      top: 28,
      feature: {
        dataZoom: { yAxisIndex: "none", title: { zoom: "Zoom", back: "Undo zoom" } },
        restore: { title: "Reset" },
        saveAsImage: { title: "Save PNG", backgroundColor: dark ? "#171717" : "#ffffff" },
      },
      iconStyle: { borderColor: text },
    },
    xAxis: {
      type: "time",
      // fixed to the data range so the axis (and the restart markers) stay
      // when every metric is switched off
      min: columns.x[0],
      max: columns.x[columns.x.length - 1],
      // a sar file covers one day: plain clock times instead of ECharts'
      // default month/day labels at day boundaries
      axisLabel: { color: text, hideOverlap: true, formatter: "{HH}:{mm}" },
      axisLine: { lineStyle: { color: grid } },
      splitLine: { show: false },
    },
    yAxis: {
      type: "value",
      scale: true,
      axisLabel: { color: text },
      splitLine: { lineStyle: { color: grid } },
    },
    dataZoom: [
      { type: "inside", xAxisIndex: 0, filterMode: "filter" },
      { type: "slider", xAxisIndex: 0, height: 20, bottom: 8, filterMode: "filter" },
    ],
    series,
  };
}
