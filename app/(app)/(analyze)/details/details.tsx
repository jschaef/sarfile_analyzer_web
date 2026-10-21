"use client";

import { useTheme } from "next-themes";
import { useMemo, useState } from "react";
import { DataTable } from "@/components/analyze/data-table";
import { FilePicker, NoFiles, PageTitle, SELECT_CLASS } from "@/components/analyze/file-picker";
import { ResultTabs } from "@/components/analyze/result-tabs";
import { StatisticsTable } from "@/components/analyze/statistics-table";
import { LineChart } from "@/components/charts/line-chart";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { api, type FileInfo, type HeaderDetails } from "@/lib/api";
import { useFileInfo, useMetricDescriptions, useRequest, useSelectedFile } from "@/lib/hooks";
import { apiLimit } from "@/lib/limit";
import { sortDevices, toColumns } from "@/lib/sar";
import { cn } from "@/lib/utils";

type Mode = "details" | "summary";

// "Detailed Metrics View" of the Streamlit app (single_file_pl.py): one header
// and device, either one metric ("Details") or all of them ("Summary").
export function Details() {
  const { files, fileName, select, error: filesError } = useSelectedFile();
  const { info, error: infoError } = useFileInfo(fileName);
  const descriptions = useMetricDescriptions();
  const error = filesError ?? infoError;

  if (files && files.length === 0) return <NoFiles />;

  return (
    <div className="space-y-6">
      <PageTitle title="Detailed Metrics" description="Show metrics for a single sar file">
        <FilePicker files={files} value={fileName} onChange={select} />
      </PageTitle>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {info ? (
        <DetailsForFile key={info.name} info={info} descriptions={descriptions} />
      ) : (
        !error && <Skeleton className="h-48 w-full" />
      )}
    </div>
  );
}

function DetailsForFile({ info, descriptions }: { info: FileInfo; descriptions: Record<string, string> }) {
  const aliases = useMemo(() => [...new Set(info.headers.map((h) => h.alias))].sort(), [info]);
  const [mode, setMode] = useState<Mode>("details");
  const [alias, setAlias] = useState(aliases.includes("CPU") ? "CPU" : aliases[0]);
  const restarts = useMemo(() => info.restarts.map((r) => r.time), [info]);
  const header = useRequest(
    (signal) => apiLimit(() => api.header(info.name, alias, signal)),
    [info.name, alias],
  );

  return (
    <>
      <Card>
        <CardContent className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Show</span>
            <div className="flex gap-1" role="group" aria-label="Mode">
              {(["details", "summary"] as const).map((value) => (
                <Button
                  key={value}
                  size="sm"
                  variant={mode === value ? "default" : "outline"}
                  aria-pressed={mode === value}
                  onClick={() => setMode(value)}
                >
                  {value === "details" ? "Details (one metric)" : "Summary (all metrics)"}
                </Button>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="header-select">Sar heading</Label>
            <select
              id="header-select"
              className={cn(SELECT_CLASS, "min-w-56")}
              value={alias}
              onChange={(event) => setAlias(event.target.value)}
            >
              {aliases.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </div>
        </CardContent>
      </Card>
      {header.error && (
        <Alert variant="destructive">
          <AlertDescription>{header.error}</AlertDescription>
        </Alert>
      )}
      {!header.data ? (
        !header.error && <Skeleton className="h-[480px] w-full" />
      ) : (
        // keyed by header: device and metric start fresh for another header
        <HeaderView
          key={alias}
          file={info.name}
          restarts={restarts}
          details={header.data}
          mode={mode}
          descriptions={descriptions}
        />
      )}
    </>
  );
}

function HeaderView({
  file,
  restarts,
  details,
  mode,
  descriptions,
}: {
  file: string;
  restarts: number[];
  details: HeaderDetails;
  mode: Mode;
  descriptions: Record<string, string>;
}) {
  const { resolvedTheme } = useTheme();
  const devices = useMemo(() => sortDevices(details.devices), [details]);
  const [device, setDevice] = useState<string | null>(devices[0] ?? null);
  const [metric, setMetric] = useState(details.metrics[0]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const metrics = mode === "details" ? [metric] : details.metrics;

  const series = useRequest(
    (signal) =>
      apiLimit(() =>
        api.series(
          file,
          {
            header: details.alias,
            devices: device ?? undefined,
            metrics: mode === "details" ? metric : undefined,
          },
          signal,
        ),
      ),
    [file, details.alias, device, mode, metric],
  );
  const columns = useMemo(
    () => (series.data ? toColumns(series.data.series[0], series.data.metrics) : null),
    [series.data],
  );

  const deviceLabel = device === "all" ? `all of ${details.device_count}` : device;
  const title = [details.alias, deviceLabel, mode === "details" ? metric : null].filter(Boolean).join(" · ");
  const fileLabel = `${file}_${[details.alias, device, mode === "details" ? metric : "summary"]
    .filter(Boolean)
    .join("_")}`.replace(/[^\w.-]+/g, "_");

  return (
    <Card data-testid="details-card">
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-end gap-4">
          {devices.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="device-select">Device</Label>
              <select
                id="device-select"
                className={SELECT_CLASS}
                value={device ?? ""}
                onChange={(event) => setDevice(event.target.value)}
              >
                {devices.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
          )}
          {mode === "details" && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="metric-select">Metric</Label>
              <select
                id="metric-select"
                className={SELECT_CLASS}
                value={metric}
                onChange={(event) => setMetric(event.target.value)}
                title={descriptions[metric]}
              >
                {details.metrics.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
        <CardTitle data-testid="details-title">{title}</CardTitle>
        {series.data && (
          <CardDescription>{series.data.series[0].rows.toLocaleString()} samples</CardDescription>
        )}
      </CardHeader>
      <CardContent>
        {series.error && (
          <Alert variant="destructive">
            <AlertDescription>{series.error}</AlertDescription>
          </Alert>
        )}
        {!columns ? (
          !series.error && <Skeleton className="h-[380px] w-full" />
        ) : (
          <ResultTabs
            chart={
              <LineChart
                columns={columns}
                restarts={restarts}
                dark={resolvedTheme === "dark"}
                selected={selected}
                onSelectedChange={setSelected}
                label={`${title} chart`}
              />
            }
            data={() => <DataTable columns={columns} restarts={restarts} fileName={fileLabel} />}
            statistics={() => (
              <StatisticsTable
                file={file}
                alias={details.alias}
                device={device}
                metrics={mode === "details" ? [metric] : undefined}
              />
            )}
            metrics={metrics}
            descriptions={descriptions}
          />
        )}
      </CardContent>
    </Card>
  );
}
