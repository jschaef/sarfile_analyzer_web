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
import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import { useChartRegister, type ChartSlot } from "@/components/charts/chart-registry";
import { buildLineOption, type Line, type LineChartInput } from "@/lib/echarts-option";
import type { ChartExport, ChartPdfMeta, ChartPdfSource } from "@/lib/chart-pdf";
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
  // download name and page heading of the PDF the toolbox icon creates
  pdf?: ChartPdfMeta;
  // where this chart belongs in a collective PDF; only has an effect inside a
  // <ChartRegistry> (the overview)
  collect?: ChartSlot;
};

// The zoom window lives in the ECharts instance only, not in React state, so
// the export has to read it back from there.
function zoomWindow(chart: echarts.ECharts): { start: number; end: number } {
  const option = chart.getOption() as { dataZoom?: { start?: number; end?: number }[] };
  const slider = option.dataZoom?.[0];
  return { start: slider?.start ?? 0, end: slider?.end ?? 100 };
}

export function LineChart(props: Props) {
  const { columns, lines, xLabel, pointerFormat, restarts, dark, selected, onSelectedChange, height = 380, label, pdf } = props;
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const selectedRef = useRef(selected);
  const onSelectedRef = useRef(onSelectedChange);
  // What the PDF export needs. Kept in refs and updated after every render, so
  // a new label or a changed legend does not rebuild the chart and the toolbox
  // callback below can stay the same function for the chart's whole life.
  const inputRef = useRef<LineChartInput>({ columns, lines, xLabel, pointerFormat, restarts, dark, selected });
  const pdfRef = useRef<ChartPdfMeta | undefined>(pdf);
  const labelRef = useRef(label);

  useEffect(() => {
    selectedRef.current = selected;
    onSelectedRef.current = onSelectedChange;
    inputRef.current = { columns, lines, xLabel, pointerFormat, restarts, dark, selected };
    pdfRef.current = pdf;
    labelRef.current = label;
  });

  // The chart as the PDF should show it: light colours whatever the app's
  // theme is, plus the two states of the visible instance - the legend
  // selection from React state and the zoom window from ECharts.
  const exportOption = useCallback((): ChartExport => {
    const chart = chartRef.current;
    const zoom = chart ? zoomWindow(chart) : { start: 0, end: 100 };
    return {
      option: buildLineOption({ ...inputRef.current, dark: false, selected: selectedRef.current }),
      zoomStart: zoom.start,
      zoomEnd: zoom.end,
    };
  }, []);

  const pdfSource = useCallback(
    (): ChartPdfSource => ({
      meta: pdfRef.current ?? { name: [labelRef.current], title: labelRef.current },
      option: exportOption,
    }),
    [exportOption],
  );

  // jsPDF and the export code arrive with the dynamic import, not in the page
  // bundle.
  const savePdf = useCallback(async () => {
    try {
      const { downloadChartPdf } = await import("@/lib/chart-pdf");
      await downloadChartPdf(pdfSource());
    } catch (error) {
      toast.error(`PDF export failed: ${(error as Error).message}`);
    }
  }, [pdfSource]);

  // report this chart to the page's registry so one button can export them all
  const register = useChartRegister();
  const { order, subOrder } = props.collect ?? {};
  useEffect(() => {
    if (!register || order === undefined) return;
    return register({ order, subOrder: subOrder ?? 0, source: pdfSource });
  }, [register, order, subOrder, pdfSource]);

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
    chart.setOption(
      buildLineOption({
        columns,
        lines,
        xLabel,
        pointerFormat,
        restarts,
        dark,
        selected: selectedRef.current,
        onSavePdf: savePdf,
      }),
    );

    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(element);
    return () => {
      observer.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, [columns, lines, xLabel, pointerFormat, restarts, dark, savePdf]);

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
