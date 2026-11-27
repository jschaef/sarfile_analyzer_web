// The collective statistics CSV of the Graphical Overview - "Generate csv for
// all statistical data" of the Streamlit app.
//
// Layout follows dia_overview_pl.build_overview_stats_csv: one wide block per
// data set, headed by its label, the statistic names in the first column and
// one column per metric, blocks separated by a blank line so a multi-device
// export stays unambiguous.
import type { StatsSource } from "@/components/charts/chart-registry";
import { api, type StatisticsResponse } from "@/lib/api";
import { apiLimit } from "@/lib/limit";

// pandas describe() rows, in its order - the same list the table on screen uses
const STATS = ["count", "mean", "std", "min", "25%", "50%", "75%", "max"];

function cell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function statsBlock(label: string, statistics: StatisticsResponse["series"][number]["statistics"]): string {
  const metrics = Object.keys(statistics);
  const head = ["statistic", ...metrics].map(cell).join(",");
  const rows = STATS.map((stat) =>
    [stat, ...metrics.map((metric) => statistics[metric]?.[stat])].map(cell).join(","),
  );
  return [label, head, ...rows].join("\n");
}

// One request per data set, through the shared limiter: the API parses the
// whole parquet per request.
export async function buildStatsCsv(
  sources: StatsSource[],
  onProgress?: (done: number, total: number) => void,
): Promise<string> {
  if (sources.length === 0) throw new Error("no diagrams to export");
  const blocks: string[] = [];
  await Promise.all(
    sources.map((source, index) =>
      apiLimit(() =>
        api.statistics(source.file, {
          header: source.alias,
          devices: source.device ?? undefined,
          start: source.start,
          end: source.end,
        }),
      ).then((response) => {
        blocks[index] = statsBlock(source.label, response.series[0]?.statistics ?? {});
        onProgress?.(blocks.filter(Boolean).length, sources.length);
      }),
    ),
  );
  return `${blocks.join("\n\n")}\n`;
}

export function downloadCsv(text: string, fileName: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
