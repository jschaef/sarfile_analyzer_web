// Client-side PDF export of the SAR line charts.
//
// The Streamlit app exports its Bokeh figures server-side (Selenium
// `export_png` -> PIL -> PDF, see `code/multi_pdf.py` in
// sarfile_analyzer_ng). Here the browser does it: an ECharts instance renders
// a PNG off-screen, jsPDF puts one page per chart around it. Both ways produce
// raster pages, so the result is no worse than the classic app's.
//
// Two rules apply to every page:
//   * PDFs are always light, whatever theme the app is in - they are made for
//     printing and passing on.
//   * A page shows what the user sees: the current zoom window and the metrics
//     that are switched off in the legend.
//
// jsPDF is loaded lazily (dynamic `import()` inside `buildPdf`) so it stays
// out of the initial page bundles.
import { LineChart } from "echarts/charts";
import {
  DataZoomComponent,
  DatasetComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TooltipComponent,
} from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import type { EChartsOption } from "echarts";

// The same set `components/charts/line-chart.tsx` registers; `echarts.use()`
// is idempotent, this only makes the module usable on its own.
echarts.use([
  LineChart,
  DataZoomComponent,
  DatasetComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TooltipComponent,
  CanvasRenderer,
]);

// Off-screen render size in CSS pixels; `pixelRatio` 2 doubles it in the PNG.
// The ratio is chosen so the image fills an A4 landscape page below the title
// instead of sitting in it as a wide strip.
const WIDTH = 1200;
const HEIGHT = 740;

// A4 landscape in mm.
const PAGE_WIDTH = 297;
const MARGIN = 12;

export type ChartPdfMeta = {
  // parts of the download name, joined with "_" after sanitising
  name: (string | null | undefined)[];
  // headline of the page
  title: string;
  // second line: file name, time range, ...
  subtitle?: string;
};

// A chart's option in light colours plus the zoom window of the visible
// instance, as percentages of the x axis (ECharts' `dataZoom.start/end`).
export type ChartExport = {
  option: EChartsOption;
  zoomStart?: number;
  zoomEnd?: number;
};

export type ChartPdfSource = {
  meta: ChartPdfMeta;
  // read late: the user may zoom or hide metrics before pressing the button
  option: () => ChartExport;
};

// `helpers_pl.validate_convert_names` of sarfile_analyzer_ng, so a chart keeps
// the download name it has in the Streamlit app. Characters that rule does not
// touch but a file name cannot carry ("/" in "I/O and transfer rate") become
// "_" afterwards.
export function sanitizeName(subject: string): string {
  return subject
    .replace(/ /g, "_")
    .replace(/%/g, "percent_")
    .replace(/\/s/g, "_per_second_")
    .replace(/_-/g, "-")
    .replace(/[^\w.-]+/g, "_");
}

export function pdfFileName(meta: ChartPdfMeta): string {
  const parts = meta.name.filter((part): part is string => Boolean(part)).map(sanitizeName);
  return `${parts.join("_") || "chart"}.pdf`;
}

type Patched = {
  toolbox?: unknown;
  dataZoom?: unknown;
  legend?: Record<string, unknown>;
  grid?: Record<string, unknown>;
  xAxis?: Record<string, unknown>;
};

// Turns the on-screen option into a printable one: no toolbox and no zoom
// slider, the zoom window baked into the axis, and a legend that wraps instead
// of scrolling (a scroll pager would hide metrics in a still image).
function toPrintOption(exported: ChartExport): EChartsOption {
  const { option, zoomStart = 0, zoomEnd = 100 } = exported;
  const patched = { ...option } as EChartsOption & Patched;
  const xAxis = { ...(patched.xAxis as Record<string, unknown>) };

  // The axis is fixed to the data range, so the dataZoom percentages map
  // linearly onto it.
  const min = Number(xAxis.min);
  const max = Number(xAxis.max);
  if (Number.isFinite(min) && Number.isFinite(max) && (zoomStart > 0 || zoomEnd < 100)) {
    const span = max - min;
    xAxis.min = min + (span * zoomStart) / 100;
    xAxis.max = min + (span * zoomEnd) / 100;
  }

  patched.xAxis = xAxis;
  patched.toolbox = { show: false };
  patched.dataZoom = [];
  patched.legend = { ...patched.legend, type: "plain", top: 8, left: "center", width: WIDTH - 40 };
  patched.grid = { ...patched.grid, top: 84, bottom: 28 };
  patched.backgroundColor = "#ffffff";
  return patched;
}

// Renders one option off-screen and returns a PNG data URL. The container has
// to be in the document for ECharts to measure it, so it is parked far to the
// left instead of being hidden with `display: none`.
async function renderPng(exported: ChartExport): Promise<string> {
  const container = document.createElement("div");
  container.style.cssText =
    `position:fixed;left:-20000px;top:0;width:${WIDTH}px;height:${HEIGHT}px;pointer-events:none`;
  container.setAttribute("aria-hidden", "true");
  document.body.appendChild(container);
  // no theme name: the default ECharts theme is the light one
  const chart = echarts.init(container, undefined, { renderer: "canvas", width: WIDTH, height: HEIGHT });
  try {
    await new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };
      chart.on("finished", finish);
      chart.setOption(toPrintOption(exported));
      // the option switches animation off, so "finished" has fired by now;
      // the timeout only keeps a surprise from blocking the export
      setTimeout(finish, 2000);
    });
    return chart.getDataURL({ type: "png", pixelRatio: 2, backgroundColor: "#ffffff" });
  } finally {
    chart.dispose();
    container.remove();
  }
}

type Page = { png: string; meta: ChartPdfMeta };

async function buildPdf(pages: Page[]): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const width = PAGE_WIDTH - 2 * MARGIN;
  const height = (width * HEIGHT) / WIDTH;
  pages.forEach((page, index) => {
    if (index > 0) doc.addPage();
    doc.setFontSize(13);
    doc.setTextColor(32);
    doc.text(page.meta.title, MARGIN, 15);
    let top = 21;
    if (page.meta.subtitle) {
      doc.setFontSize(9);
      doc.setTextColor(110);
      doc.text(page.meta.subtitle, MARGIN, 21);
      top = 26;
    }
    // without a compression the PNG goes into the file as raw RGB - 7 MB for
    // one page of 2400x1000 pixels
    doc.addImage(page.png, "PNG", MARGIN, top, width, height, undefined, "FAST");
  });
  return doc.output("blob");
}

function download(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

// One chart, one page - the toolbox icon of every chart.
export async function downloadChartPdf(source: ChartPdfSource): Promise<void> {
  const png = await renderPng(source.option());
  download(await buildPdf([{ png, meta: source.meta }]), pdfFileName(source.meta));
}

// All diagrams of the overview, one page each, in the given order. Rendering
// runs one after another and reports progress, like "Prepare Multi-PDF" in the
// Streamlit app (which exports in parallel because Selenium is the bottleneck
// there).
export async function downloadChartsPdf(
  sources: ChartPdfSource[],
  fileName: string,
  onProgress?: (page: number, total: number) => void,
): Promise<void> {
  const pages: Page[] = [];
  for (const source of sources) {
    onProgress?.(pages.length + 1, sources.length);
    pages.push({ png: await renderPng(source.option()), meta: source.meta });
    // give the browser a frame between charts so the progress toast updates
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  if (pages.length === 0) throw new Error("no diagrams to export");
  download(await buildPdf(pages), fileName);
}
