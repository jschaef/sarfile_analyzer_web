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

// A line with its own time axis: charts that combine data from several
// headers, devices or files, whose timestamps need not match. Restarts of a
// line (one file of several) are drawn in its colour and hide with it.
export type Line = { name: string; x: number[]; y: (number | null)[]; restarts?: number[] };

export type LineChartInput = {
  // either columns sharing one time axis (one header) ...
  columns?: Columns;
  // ... or independent lines
  lines?: Line[];
  // x axis label format; one sar file covers one day, so clock time by default
  xLabel?: string;
  restarts?: number[];
  dark?: boolean;
  // legend state: metric -> visible; missing keys count as visible
  selected?: Record<string, boolean>;
  // 'lttb' keeps peaks while drawing at most ~2 points per pixel
  sampling?: LineSeriesOption["sampling"];
};

export function buildLineOption(input: LineChartInput): EChartsOption {
  const { columns, lines, restarts = [], dark = false, selected = {}, sampling = "lttb" } = input;
  const xLabel = input.xLabel ?? "{HH}:{mm}";
  const text = dark ? "#d4d4d4" : "#404040";
  const grid = dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)";
  const names = columns ? columns.metrics : (lines ?? []).map((line) => line.name);
  const many = names.length > 12;
  const common: LineSeriesOption = {
    type: "line",
    showSymbol: false,
    sampling,
    // line series have no `large` mode in ECharts (only scatter/bar/lines);
    // sampling + no animation is what keeps big line charts fast
    lineStyle: { width: many ? 1 : 1.5 },
    emphasis: { focus: "series" },
    connectNulls: false,
  };

  let series: LineSeriesOption[];
  let xMin: number | undefined;
  let xMax: number | undefined;
  let dataset: EChartsOption["dataset"];
  if (columns) {
    dataset = { source: { date: columns.x, ...columns.series } };
    series = columns.metrics.map((metric) => ({ ...common, name: metric, encode: { x: "date", y: metric } }));
    xMin = columns.x[0];
    xMax = columns.x[columns.x.length - 1];
  } else {
    for (const line of lines ?? []) {
      if (line.x.length === 0) continue;
      xMin = Math.min(xMin ?? Infinity, line.x[0]);
      xMax = Math.max(xMax ?? -Infinity, line.x[line.x.length - 1]);
    }
    series = (lines ?? []).map((line, index) => {
      const color = PALETTE[index % PALETTE.length];
      const own = (line.restarts ?? []).filter((x) => xMin !== undefined && x >= xMin && x <= xMax!);
      return {
        ...common,
        name: line.name,
        color,
        data: line.x.map((x, i) => [x, line.y[i]]),
        ...(own.length > 0 && {
          markLine: {
            symbol: "none",
            silent: true,
            lineStyle: { color, type: "dashed", width: 1.5 },
            label: { formatter: "LINUX RESTART", color, position: "insideEndTop" },
            data: own.map((x) => ({ xAxis: x })),
          },
        }),
      };
    });
  }

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
    dataset,
    legend: {
      type: "scroll",
      top: 0,
      left: 0,
      right: 0,
      textStyle: { color: text },
      // metrics only - the restart series must not be toggleable
      data: names,
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
      min: xMin,
      max: xMax,
      // plain clock times instead of ECharts' default month/day labels at day
      // boundaries (one sar file covers one day)
      axisLabel: { color: text, hideOverlap: true, formatter: xLabel },
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
