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

// "2026-10-01 13:05:00" for an epoch-ms timestamp from the API.
export function dateTime(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 19).replace("T", " ");
}

// Device order of the Streamlit views: 'all' first, CPUs numerically
// (2 before 10), then names alphabetically.
export function sortDevices(devices: string[]): string[] {
  const rank = (d: string) => (d === "all" ? 0 : /^\d+$/.test(d) ? 1 : 2);
  return [...devices].sort((a, b) => {
    const diff = rank(a) - rank(b);
    if (diff !== 0) return diff;
    return rank(a) === 1 ? Number(a) - Number(b) : a.localeCompare(b);
  });
}
