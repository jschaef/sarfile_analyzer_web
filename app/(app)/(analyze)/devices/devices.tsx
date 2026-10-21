"use client";

import { BarChart3Icon, SearchIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { useMemo, useState } from "react";
import { FilePicker, NoFiles, PageTitle, SELECT_CLASS } from "@/components/analyze/file-picker";
import { ResultTabs } from "@/components/analyze/result-tabs";
import { LineChart } from "@/components/charts/line-chart";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, type FileInfo, type ThresholdResponse } from "@/lib/api";
import type { Line } from "@/lib/echarts-option";
import { useFileInfo, useMetricDescriptions, useRequest, useSelectedFile } from "@/lib/hooks";
import { apiLimit } from "@/lib/limit";
import { clockTime, dateTime } from "@/lib/sar";
import { cn } from "@/lib/utils";

// "Metrics on many devices" of the Streamlit app (display_multi.py): find the
// devices whose metric lies in a range, e.g. every CPU with %iowait between
// 15.5 and 50 in a time window, then chart the chosen ones.
export function Devices() {
  const { files, fileName, select, error: filesError } = useSelectedFile();
  const { info, error: infoError } = useFileInfo(fileName);
  const descriptions = useMetricDescriptions();
  const error = filesError ?? infoError;

  if (files && files.length === 0) return <NoFiles />;

  return (
    <div className="space-y-6">
      <PageTitle
        title="Metrics on many devices"
        description="Find devices where a metric lies in a range, e.g. every CPU with %iowait between 15.5 and 50"
      >
        <FilePicker files={files} value={fileName} onChange={select} />
      </PageTitle>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {info ? (
        <DevicesForFile key={info.name} info={info} descriptions={descriptions} />
      ) : (
        !error && <Skeleton className="h-48 w-full" />
      )}
    </div>
  );
}

function DevicesForFile({ info, descriptions }: { info: FileInfo; descriptions: Record<string, string> }) {
  const headers = useMemo(
    () =>
      info.headers
        .filter((h) => h.has_devices)
        .sort((a, b) => a.alias.localeCompare(b.alias)),
    [info],
  );
  const [alias, setAlias] = useState(headers.find((h) => h.alias === "CPU")?.alias ?? headers[0]?.alias);
  const header = headers.find((h) => h.alias === alias);

  if (!header) {
    return (
      <Alert>
        <AlertDescription>This file has no per-device data (CPU, DEV, IFACE, …).</AlertDescription>
      </Alert>
    );
  }
  return (
    <MetricSearch
      // keyed: metric, range and results start fresh for another header
      key={header.alias}
      info={info}
      alias={header.alias}
      aliases={headers.map((h) => h.alias)}
      onAlias={setAlias}
      metrics={header.metrics}
      descriptions={descriptions}
    />
  );
}

type Query = { min: string; max: string; start: string; end: string };

function MetricSearch({
  info,
  alias,
  aliases,
  onAlias,
  metrics,
  descriptions,
}: {
  info: FileInfo;
  alias: string;
  aliases: string[];
  onAlias: (alias: string) => void;
  metrics: string[];
  descriptions: Record<string, string>;
}) {
  const [metric, setMetric] = useState(metrics[0]);
  const range = useRequest(
    (signal) => apiLimit(() => api.threshold(info.name, { header: alias, metric }, signal)),
    [info.name, alias, metric],
  );

  return (
    <>
      <Card>
        <CardContent className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="header-select">Sar heading</Label>
            <select
              id="header-select"
              className={cn(SELECT_CLASS, "min-w-56")}
              value={alias}
              onChange={(event) => onAlias(event.target.value)}
            >
              {aliases.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="metric-select">Metric</Label>
            <select
              id="metric-select"
              className={SELECT_CLASS}
              value={metric}
              onChange={(event) => setMetric(event.target.value)}
              title={descriptions[metric]}
            >
              {metrics.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
        </CardContent>
      </Card>
      {range.error && (
        <Alert variant="destructive">
          <AlertDescription>{range.error}</AlertDescription>
        </Alert>
      )}
      {!range.data ? (
        !range.error && <Skeleton className="h-40 w-full" />
      ) : (
        <ThresholdForm
          key={metric}
          info={info}
          alias={alias}
          metric={metric}
          range={range.data}
          descriptions={descriptions}
        />
      )}
    </>
  );
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function ThresholdForm({
  info,
  alias,
  metric,
  range,
  descriptions,
}: {
  info: FileInfo;
  alias: string;
  metric: string;
  range: ThresholdResponse;
  descriptions: Record<string, string>;
}) {
  const valueMax = range.value_max ?? 0;
  const valueMin = range.value_min ?? 0;
  const times = useMemo(() => [...new Set(info.timestamps.map(clockTime))], [info]);
  // Streamlit's default: from 0 to half of the maximum (options[0]..options[10])
  const [draft, setDraft] = useState<Query>({
    min: "0",
    max: String(round2(valueMax / 2)),
    start: times[0] ?? "00:00:00",
    end: times.at(-1) ?? "23:59:59",
  });
  const [query, setQuery] = useState<Query | null>(null);
  const invalid =
    draft.min === "" || draft.max === "" || Number(draft.min) > Number(draft.max) || draft.start > draft.end;

  if (valueMin === valueMax) {
    return (
      <Alert>
        <AlertDescription>
          No threshold available: {metric} is constant at {valueMin}.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Threshold range</CardTitle>
          <CardDescription>
            {metric} ranges from {valueMin.toLocaleString()} to {valueMax.toLocaleString()} in this file.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-wrap items-end gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (!invalid) setQuery(draft);
            }}
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="min-value">Min</Label>
              <Input
                id="min-value"
                type="number"
                step="any"
                className="w-32"
                value={draft.min}
                onChange={(event) => setDraft({ ...draft, min: event.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="max-value">Max</Label>
              <Input
                id="max-value"
                type="number"
                step="any"
                className="w-32"
                value={draft.max}
                onChange={(event) => setDraft({ ...draft, max: event.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="start-time">Start time</Label>
              <select
                id="start-time"
                className={SELECT_CLASS}
                value={draft.start}
                onChange={(event) => {
                  const start = event.target.value;
                  setDraft({ ...draft, start, end: draft.end < start ? (times.at(-1) ?? start) : draft.end });
                }}
              >
                {times.map((time) => (
                  <option key={time} value={time}>
                    {time}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="end-time">End time</Label>
              <select
                id="end-time"
                className={SELECT_CLASS}
                value={draft.end}
                onChange={(event) => setDraft({ ...draft, end: event.target.value })}
              >
                {times
                  .filter((time) => time >= draft.start)
                  .map((time) => (
                    <option key={time} value={time}>
                      {time}
                    </option>
                  ))}
              </select>
            </div>
            <Button type="submit" disabled={invalid} data-testid="find-devices">
              <SearchIcon /> Find devices
            </Button>
          </form>
          {Number(draft.min) > Number(draft.max) && (
            <p className="mt-2 text-sm text-destructive">Min must not be greater than max.</p>
          )}
        </CardContent>
      </Card>
      {query && (
        <Matches
          // a new search starts with a fresh device selection
          key={JSON.stringify(query)}
          info={info}
          alias={alias}
          metric={metric}
          query={query}
          descriptions={descriptions}
        />
      )}
    </>
  );
}

function Matches({
  info,
  alias,
  metric,
  query,
  descriptions,
}: {
  info: FileInfo;
  alias: string;
  metric: string;
  query: Query;
  descriptions: Record<string, string>;
}) {
  const result = useRequest(
    (signal) =>
      apiLimit(() =>
        api.threshold(info.name, { header: alias, metric, ...query, limit: "500" }, signal),
      ),
    [info.name, alias, metric, query],
  );
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [shown, setShown] = useState<string[] | null>(null);

  if (result.error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{result.error}</AlertDescription>
      </Alert>
    );
  }
  if (!result.data) return <Skeleton className="h-48 w-full" />;

  const devices = result.data.devices ?? [];
  const rows = result.data.rows ?? [];
  const matches = result.data.matches ?? 0;
  const allChosen = devices.length > 0 && devices.every((d) => chosen.has(d.device));

  function toggle(device: string) {
    setChosen((current) => {
      const next = new Set(current);
      if (next.has(device)) next.delete(device);
      else next.add(device);
      return next;
    });
  }

  if (matches === 0) {
    return (
      <Alert>
        <AlertDescription>No data available for the selected range and time frame.</AlertDescription>
      </Alert>
    );
  }

  return (
    <>
      <Card data-testid="device-matches">
        <CardHeader>
          <CardTitle>
            {matches.toLocaleString()} matches on {devices.length} device(s)
          </CardTitle>
          <CardDescription>
            {metric} between {query.min} and {query.max}, {query.start}–{query.end}. Select devices to chart
            their {metric} over the whole file.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setChosen(allChosen ? new Set() : new Set(devices.map((d) => d.device)))}
              >
                {allChosen ? "Deselect all" : "Select all"}
              </Button>
              <Button
                size="sm"
                disabled={chosen.size === 0}
                onClick={() => setShown(devices.map((d) => d.device).filter((d) => chosen.has(d)))}
                data-testid="show-device-chart"
              >
                <BarChart3Icon /> Show diagram ({chosen.size})
              </Button>
            </div>
            <div className="max-h-96 overflow-auto rounded-lg border">
              <Table>
                <TableHeader className="sticky top-0 bg-background">
                  <TableRow>
                    <TableHead className="w-0" />
                    <TableHead>Device</TableHead>
                    <TableHead className="text-right">Matches</TableHead>
                    <TableHead className="text-right">Peak</TableHead>
                    <TableHead>First</TableHead>
                    <TableHead>Last</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {devices.map((d) => (
                    <TableRow key={d.device} data-testid="device-row" data-device={d.device}>
                      <TableCell>
                        <input
                          type="checkbox"
                          aria-label={`Select ${d.device}`}
                          checked={chosen.has(d.device)}
                          onChange={() => toggle(d.device)}
                          className="size-4 accent-primary"
                        />
                      </TableCell>
                      <TableCell className="font-mono">{d.device}</TableCell>
                      <TableCell className="text-right tabular-nums">{d.count}</TableCell>
                      <TableCell className="text-right tabular-nums">{d.peak.toLocaleString()}</TableCell>
                      <TableCell className="font-mono text-xs">{clockTime(d.first)}</TableCell>
                      <TableCell className="font-mono text-xs">{clockTime(d.last)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Matching samples
              {result.data.rows_returned !== undefined &&
                result.data.rows_returned < matches &&
                ` (first ${result.data.rows_returned.toLocaleString()} of ${matches.toLocaleString()})`}
            </p>
            <div className="max-h-96 overflow-auto rounded-lg border">
              <Table>
                <TableHeader className="sticky top-0 bg-background">
                  <TableRow>
                    <TableHead>date</TableHead>
                    <TableHead>Device</TableHead>
                    <TableHead className="text-right">{metric}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row, i) => (
                    <TableRow key={`${row.time}-${row.device}-${i}`}>
                      <TableCell className="font-mono text-xs">{dateTime(row.time)}</TableCell>
                      <TableCell className="font-mono">{row.device}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.value.toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </CardContent>
      </Card>
      {shown && (
        <DeviceChart
          key={shown.join(",")}
          info={info}
          alias={alias}
          metric={metric}
          devices={shown}
          descriptions={descriptions}
        />
      )}
    </>
  );
}

function DeviceChart({
  info,
  alias,
  metric,
  devices,
  descriptions,
}: {
  info: FileInfo;
  alias: string;
  metric: string;
  devices: string[];
  descriptions: Record<string, string>;
}) {
  const { resolvedTheme } = useTheme();
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const restarts = useMemo(() => info.restarts.map((r) => r.time), [info]);
  const series = useRequest(
    (signal) =>
      apiLimit(() =>
        api.series(info.name, { header: alias, devices: devices.join(","), metrics: metric }, signal),
      ),
    [info.name, alias, metric, devices],
  );
  // one line per device, like bokeh_charts.overview_v5
  const lines = useMemo<Line[] | null>(
    () =>
      series.data
        ? series.data.series.map((s) => ({ name: s.device ?? "", x: s.x, y: s.values[metric] }))
        : null,
    [series.data, metric],
  );

  return (
    <Card data-testid="device-chart">
      <CardHeader>
        <CardTitle>
          {alias} · {metric}
        </CardTitle>
        <CardDescription>{devices.length} device(s)</CardDescription>
      </CardHeader>
      <CardContent>
        {series.error && (
          <Alert variant="destructive">
            <AlertDescription>{series.error}</AlertDescription>
          </Alert>
        )}
        {!lines ? (
          !series.error && <Skeleton className="h-[380px] w-full" />
        ) : (
          <ResultTabs
            chart={
              <LineChart
                lines={lines}
                restarts={restarts}
                dark={resolvedTheme === "dark"}
                selected={selected}
                onSelectedChange={setSelected}
                label={`${alias} ${metric} per device`}
              />
            }
            metrics={[metric]}
            descriptions={descriptions}
          />
        )}
      </CardContent>
    </Card>
  );
}
