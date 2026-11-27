"use client";

import { FileDownIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useRegisteredCharts } from "@/components/charts/chart-registry";
import { Button } from "@/components/ui/button";
import { sanitizeName } from "@/lib/chart-pdf";

// "Create PDF from all diagrams" of the Streamlit overview: one PDF with a
// page per diagram, in the order of the aliases. Unlike Streamlit, which
// rebuilds the figures from the full data, this takes the diagrams as they are
// on screen - with their zoom window and the metrics that are switched off.
export function MultiPdfButton({ file }: { file: string }) {
  const charts = useRegisteredCharts();
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    const id = toast.loading(`Preparing PDF: page 1 of ${charts.length}`);
    try {
      const { downloadChartsPdf } = await import("@/lib/chart-pdf");
      await downloadChartsPdf(
        charts.map((chart) => chart.source()),
        `${sanitizeName(file)}_diagrams.pdf`,
        (page, total) => toast.loading(`Preparing PDF: page ${page} of ${total}`, { id }),
      );
      toast.success(`PDF with ${charts.length} page(s) downloaded`, { id });
    } catch (error) {
      toast.error(`PDF export failed: ${(error as Error).message}`, { id });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={run}
      disabled={busy || charts.length === 0}
      data-testid="multi-pdf"
      data-charts={charts.length}
    >
      <FileDownIcon /> {busy ? "Preparing PDF…" : `Download all diagrams as PDF (${charts.length})`}
    </Button>
  );
}
