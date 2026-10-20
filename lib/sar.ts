import type { DeviceSeries } from "@/lib/api";

// Mirrors services.DEFAULT_OVERVIEW_ALIASES / dia_overview_pl.initial_aliases.
export const DEFAULT_OVERVIEW_ALIASES = [
  "CPU",
  "Kernel tables",
  "Load",
  "Memory utilization",
  "Swap utilization",
];

// What a chart needs. sar timestamps carry no time zone: sar-web-api sends the
// wall-clock time as epoch milliseconds interpreted as UTC, and the charts
// render with useUTC so the axis shows exactly the time from the file.
export type Columns = {
  x: number[];
  series: Record<string, (number | null)[]>;
  metrics: string[];
};

export function toColumns(series: Pick<DeviceSeries, "x" | "values">, metrics: string[]): Columns {
  return { x: series.x, series: series.values, metrics };
}

// "HH:MM:SS" of an epoch-ms timestamp from the API.
export function clockTime(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(11, 19);
}
