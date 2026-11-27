"use client";

import { SheetIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useRegisteredCharts } from "@/components/charts/chart-registry";
import { Button } from "@/components/ui/button";
import { sanitizeName } from "@/lib/chart-pdf";

// "Generate csv for all statistical data" of the Streamlit overview: the
// statistics of every displayed data set in one CSV, in the order of the
// diagrams.
export function StatsCsvButton({ file }: { file: string }) {
  const charts = useRegisteredCharts();
  const sources = charts.map((chart) => chart.stats?.()).filter((source) => source !== undefined);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    const id = toast.loading(`Collecting statistics: 0 of ${sources.length}`);
    try {
      const { buildStatsCsv, downloadCsv } = await import("@/lib/stats-csv");
      const csv = await buildStatsCsv(sources, (done, total) =>
        toast.loading(`Collecting statistics: ${done} of ${total}`, { id }),
      );
      downloadCsv(csv, `${sanitizeName(file)}_statistics.csv`);
      toast.success(`CSV with ${sources.length} data set(s) downloaded`, { id });
    } catch (error) {
      toast.error(`CSV export failed: ${(error as Error).message}`, { id });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={run}
      disabled={busy || sources.length === 0}
      data-testid="stats-csv"
      data-sets={sources.length}
    >
      <SheetIcon /> {busy ? "Collecting…" : `Download all statistics as CSV (${sources.length})`}
    </Button>
  );
}
