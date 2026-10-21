"use client";

import { ChevronLeftIcon, ChevronRightIcon, DownloadIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { dateTime, type Columns } from "@/lib/sar";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 100;

type Row = { time: number; values: (number | null)[]; restart?: boolean };

function format(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "–";
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

// The "Data" tab of the Streamlit views: every sample, restarts as marked rows
// (helpers_pl.restart_headers inserts and highlights them the same way).
export function DataTable({
  columns,
  restarts = [],
  fileName,
}: {
  columns: Columns;
  restarts?: number[];
  fileName: string;
}) {
  const rows = useMemo(() => {
    const result: Row[] = columns.x.map((time, i) => ({
      time,
      values: columns.metrics.map((m) => columns.series[m][i]),
    }));
    const first = columns.x[0];
    const last = columns.x[columns.x.length - 1];
    for (const time of restarts) {
      if (time >= first && time <= last) result.push({ time, values: [], restart: true });
    }
    // stable: a restart row lands after a sample with the same timestamp
    return result.sort((a, b) => a.time - b.time);
  }, [columns, restarts]);
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const shown = rows.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);

  function downloadCsv() {
    const header = ["date", ...columns.metrics].join(",");
    const lines = rows.map((row) =>
      row.restart
        ? `${dateTime(row.time)},LINUX RESTART`
        : [dateTime(row.time), ...row.values.map((v) => (v === null ? "" : String(v)))].join(","),
    );
    const blob = new Blob([[header, ...lines].join("\n") + "\n"], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${fileName}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-2" data-testid="data-table">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
        <span>
          {columns.x.length.toLocaleString()} samples
          {rows.length > columns.x.length && ` · ${rows.length - columns.x.length} restart(s)`}
        </span>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" onClick={downloadCsv}>
            <DownloadIcon /> CSV
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Previous page"
            disabled={current === 0}
            onClick={() => setPage(current - 1)}
          >
            <ChevronLeftIcon />
          </Button>
          <span className="tabular-nums">
            {current + 1} / {pages}
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Next page"
            disabled={current >= pages - 1}
            onClick={() => setPage(current + 1)}
          >
            <ChevronRightIcon />
          </Button>
        </div>
      </div>
      <div className="max-h-[420px] overflow-auto rounded-lg border">
        <Table>
          <TableHeader className="sticky top-0 bg-background">
            <TableRow>
              <TableHead>date</TableHead>
              {columns.metrics.map((metric) => (
                <TableHead key={metric} className="text-right">
                  {metric}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((row, i) => (
              <TableRow
                key={`${row.time}-${row.restart ? "r" : i}`}
                className={cn(row.restart && "bg-destructive/10 font-medium text-destructive")}
              >
                <TableCell className="font-mono text-xs">{dateTime(row.time)}</TableCell>
                {row.restart ? (
                  <TableCell colSpan={columns.metrics.length}>LINUX RESTART</TableCell>
                ) : (
                  row.values.map((value, j) => (
                    <TableCell key={columns.metrics[j]} className="text-right tabular-nums">
                      {format(value)}
                    </TableCell>
                  ))
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
