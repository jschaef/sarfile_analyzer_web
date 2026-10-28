"use client";

import { BarChart3Icon } from "lucide-react";
import { useTheme } from "next-themes";
import { useMemo, useState } from "react";
import { DataTable } from "@/components/analyze/data-table";
import { NoFiles, PageTitle, SELECT_CLASS } from "@/components/analyze/file-picker";
import { ResultTabs } from "@/components/analyze/result-tabs";
import { StatisticsTable } from "@/components/analyze/statistics-table";
import { LineChart } from "@/components/charts/line-chart";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, type FileInfo, type HeaderDetails, type SarFile } from "@/lib/api";
import type { Line } from "@/lib/echarts-option";
import { useMetricDescriptions, useRequest, useSarFiles } from "@/lib/hooks";
import { apiLimit } from "@/lib/limit";
import { clockTime, sortDevices, toColumns } from "@/lib/sar";
import { DESCRIBE_KEYS, describe } from "@/lib/stats";
import { cn } from "@/lib/utils";

const DAY_MS = 24 * 3600 * 1000;
// the diagram's restarts come with each file's line (lib/echarts-option.ts)
const NO_RESTARTS: number[] = [];

// "Multiple Sar Files" of the Streamlit app (multi_files_pl.py): the same
// heading/device/metric across several files, either laid over one 24-hour
// axis or one after another on the real time axis; "Summary" shows every
// metric of the heading per file.
export function Multi() {
  const { files, error } = useSarFiles();
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [compared, setCompared] = useState<string[] | null>(null);
  const descriptions = useMetricDescriptions();

  if (files && files.length === 0) return <NoFiles />;

  const all = files ?? [];
  const allChecked = all.length > 0 && all.every((f) => checked.has(f.name));

  function toggle(name: string) {
    setChecked((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  return (
    <div className="space-y-6">
      <PageTitle title="Multiple SAR Files" description="Compare the same metric on multiple sar files" />
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Files</CardTitle>
          <CardDescription>Headings and devices offered below are the ones all chosen files have.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {!files ? (
            <Skeleton className="h-24 w-full" />
          ) : (
            <>
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={allChecked}
                  onChange={() => setChecked(allChecked ? new Set() : new Set(all.map((f) => f.name)))}
                />
                Select all
              </label>
              <div className="grid gap-1 sm:grid-cols-2" data-testid="multi-files">
                {all.map((file) => (
                  <FileCheckbox key={file.name} file={file} checked={checked.has(file.name)} onToggle={toggle} />
                ))}
              </div>
              <Button
                disabled={checked.size === 0}
                onClick={() => setCompared(all.map((f) => f.name).filter((n) => checked.has(n)))}
                data-testid="compare-files"
              >
                <BarChart3Icon /> Compare {checked.size > 0 ? `${checked.size} file(s)` : ""}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
      {compared && <MultiForFiles key={compared.join("|")} files={compared} descriptions={descriptions} />}
    </div>
  );
}

function FileCheckbox({
  file,
  checked,
  onToggle,
}: {
  file: SarFile;
  checked: boolean;
  onToggle: (name: string) => void;
}) {
  return (
    <label className="flex items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-muted">
      <input
        type="checkbox"
        className="size-4 accent-primary"
        checked={checked}
        onChange={() => onToggle(file.name)}
        aria-label={file.name}
      />
      <span className="font-mono text-xs">{file.name}</span>
    </label>
  );
}

function MultiForFiles({ files, descriptions }: { files: string[]; descriptions: Record<string, string> }) {
  const infos = useRequest(
    (signal) => Promise.all(files.map((name) => apiLimit(() => api.fileInfo(name, signal)))),
    [files],
  );
  // merge_headers: only headings every chosen file has
  const common = useMemo(() => {
    if (!infos.data) return [];
    const sets = infos.data.map((info) => new Set(info.headers.map((h) => h.alias)));
    return [...sets[0]].filter((alias) => sets.every((set) => set.has(alias))).sort();
  }, [infos.data]);
  const [alias, setAlias] = useState<string | null>(null);
  const chosen = alias && common.includes(alias) ? alias : common.includes("CPU") ? "CPU" : (common[0] ?? null);

  if (infos.error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{infos.error}</AlertDescription>
      </Alert>
    );
  }
  if (!infos.data) return <Skeleton className="h-48 w-full" />;
  if (!chosen) {
    return (
      <Alert>
        <AlertDescription>The chosen files have no heading in common.</AlertDescription>
      </Alert>
    );
  }
  return (
    <MultiHeader
      key={chosen}
      infos={infos.data}
      alias={chosen}
      aliases={common}
      onAlias={setAlias}
      descriptions={descriptions}
    />
  );
}

type Range = { start: string; end: string };

function MultiHeader({
  infos,
  alias,
  aliases,
  onAlias,
  descriptions,
}: {
  infos: FileInfo[];
  alias: string;
  aliases: string[];
  onAlias: (alias: string) => void;
  descriptions: Record<string, string>;
}) {
  const files = infos.map((info) => info.name);
  const details = useRequest(
    (signal) => Promise.all(files.map((name) => apiLimit(() => api.header(name, alias, signal)))),
    [files, alias],
  );
  const devices = useMemo(() => commonDevices(details.data ?? []), [details.data]);
  const metrics = details.data?.[0]?.metrics ?? [];
  const [deviceChoice, setDevice] = useState<string | null>(null);
  const [metricChoice, setMetric] = useState<string | null>(null);
  const [mode, setMode] = useState<"diagram" | "summary">("diagram");
  const [consecutive, setConsecutive] = useState(false);
  const device = deviceChoice && devices.includes(deviceChoice) ? deviceChoice : (devices[0] ?? null);
  const metric = metricChoice && metrics.includes(metricChoice) ? metricChoice : (metrics[0] ?? null);

  // clock times of all files, for the 24-hour overlay
  const times = useMemo(
    () => [...new Set(infos.flatMap((info) => info.timestamps.map(clockTime)))].sort(),
    [infos],
  );
  const full: Range = { start: times[0] ?? "00:00:00", end: times.at(-1) ?? "23:59:59" };
  const [draft, setDraft] = useState<Range>(full);
  const [range, setRange] = useState<Range>(full);
  const isFull = range.start === full.start && range.end === full.end;

  return (
    <>
      <Card>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-4">
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
            {mode === "diagram" && metrics.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="metric-select">Metric</Label>
                <select
                  id="metric-select"
                  className={SELECT_CLASS}
                  value={metric ?? ""}
                  onChange={(event) => setMetric(event.target.value)}
                  title={metric ? descriptions[metric] : undefined}
                >
                  {metrics.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Show</span>
              <div className="flex gap-1" role="group" aria-label="Mode">
                {(["diagram", "summary"] as const).map((value) => (
                  <Button
                    key={value}
                    size="sm"
                    variant={mode === value ? "default" : "outline"}
                    aria-pressed={mode === value}
                    onClick={() => setMode(value)}
                  >
                    {value === "diagram" ? "Diagram" : "Summary"}
                  </Button>
                ))}
              </div>
            </div>
          </div>
          {mode === "diagram" && (
            <div className="flex flex-wrap items-end gap-4 border-t pt-4">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={consecutive}
                  onChange={(event) => setConsecutive(event.target.checked)}
                  data-testid="consecutive"
                />
                Horizontal view for consecutive days
              </label>
              {!consecutive && (
                <>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="start-time">Start time</Label>
                    <select
                      id="start-time"
                      className={SELECT_CLASS}
                      value={draft.start}
                      onChange={(event) => {
                        const start = event.target.value;
                        setDraft({ start, end: draft.end < start ? full.end : draft.end });
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
                  <Button variant="outline" size="sm" onClick={() => setRange(draft)}>
                    Apply time range
                  </Button>
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>
      {details.error && (
        <Alert variant="destructive">
          <AlertDescription>{details.error}</AlertDescription>
        </Alert>
      )}
      {!details.data ? (
        !details.error && <Skeleton className="h-[440px] w-full" />
      ) : mode === "diagram" ? (
        metric && (
          <DiagramView
            infos={infos}
            alias={alias}
            device={device}
            metric={metric}
            consecutive={consecutive}
            range={consecutive || isFull ? null : range}
            descriptions={descriptions}
          />
        )
      ) : (
        infos.map((info) => (
          <SummaryCard key={info.name} info={info} alias={alias} device={device} descriptions={descriptions} />
        ))
      )}
    </>
  );
}

// Devices all files have (merge_headers): 'all' first, CPUs numerically.
function commonDevices(details: HeaderDetails[]): string[] {
  if (details.length === 0) return [];
  const sets = details.map((d) => new Set(d.devices));
  return sortDevices(details[0].devices.filter((d) => sets.every((set) => set.has(d))));
}

function DiagramView({
  infos,
  alias,
  device,
  metric,
  consecutive,
  range,
  descriptions,
}: {
  infos: FileInfo[];
  alias: string;
  device: string | null;
  metric: string;
  consecutive: boolean;
  range: Range | null;
  descriptions: Record<string, string>;
}) {
  const { resolvedTheme } = useTheme();
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  // consecutive days: in date order (bokeh_charts.overview_v3)
  const ordered = useMemo(
    () => (consecutive ? [...infos].sort((a, b) => a.start.localeCompare(b.start)) : infos),
    [infos, consecutive],
  );
  const data = useRequest(
    (signal) =>
      Promise.all(
        ordered.map((info) =>
          apiLimit(() =>
            api.series(
              info.name,
              {
                header: alias,
                devices: device ?? undefined,
                metrics: metric,
                start: range?.start,
                end: range?.end,
              },
              signal,
            ),
          ),
        ),
      ),
    [ordered.map((i) => i.name), alias, device, metric, range],
  );

  // overlay: every file on one 24-hour axis (time of day), restarts likewise
  const toAxis = useMemo(() => (consecutive ? (x: number) => x : (x: number) => x % DAY_MS), [consecutive]);
  const lines = useMemo<Line[] | null>(
    () =>
      data.data
        ? data.data.map((response, i) => ({
            name: ordered[i].name,
            x: response.series[0].x.map(toAxis),
            y: response.series[0].values[metric],
            // drawn in the colour of the file's line
            restarts: ordered[i].restarts.map((r) => toAxis(r.time)),
          }))
        : null,
    [data.data, ordered, metric, toAxis],
  );
  const title = [alias, device, metric].filter(Boolean).join(" · ");

  return (
    <Card data-testid="multi-diagram">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>
          {ordered.length} file(s){" "}
          {consecutive ? "on the real time axis" : "laid over one 24-hour axis"}
          {range && `, ${range.start}–${range.end}`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {data.error && (
          <Alert variant="destructive">
            <AlertDescription>{data.error}</AlertDescription>
          </Alert>
        )}
        {!lines || !data.data ? (
          !data.error && <Skeleton className="h-[380px] w-full" />
        ) : (
          <ResultTabs
            chart={
              <LineChart
                lines={lines}
                restarts={NO_RESTARTS}
                xLabel={consecutive ? "{MM}-{dd} {HH}:{mm}" : "{HH}:{mm}"}
                // the overlay's day is 1970-01-01 - only the clock time means something
                pointerFormat={consecutive ? undefined : "{HH}:{mm}:{ss}"}
                dark={resolvedTheme === "dark"}
                selected={selected}
                onSelectedChange={setSelected}
                label={`${title} across files`}
              />
            }
            data={() => (
              <div className="grid gap-6 lg:grid-cols-2">
                {ordered.map((info, i) => (
                  <div key={info.name} className="space-y-1">
                    <h3 className="font-mono text-xs font-medium">{info.name}</h3>
                    <DataTable
                      columns={toColumns(data.data![i].series[0], [metric])}
                      restarts={info.restarts.map((r) => r.time)}
                      fileName={`${info.name}_${title}`.replace(/[^\w.-]+/g, "_")}
                    />
                  </div>
                ))}
              </div>
            )}
            statistics={() => (
              <div className="space-y-6">
                <CombinedStatistics
                  metric={metric}
                  values={data.data!.flatMap((response) => response.series[0].values[metric])}
                  files={ordered.length}
                />
                {ordered.map((info) => (
                  <div key={info.name} className="space-y-1">
                    <h3 className="font-mono text-xs font-medium">{info.name}</h3>
                    <StatisticsTable
                      file={info.name}
                      alias={alias}
                      device={device}
                      metrics={[metric]}
                      start={range?.start}
                      end={range?.end}
                    />
                  </div>
                ))}
              </div>
            )}
            metrics={[metric]}
            descriptions={descriptions}
          />
        )}
      </CardContent>
    </Card>
  );
}

// layout_helper_pl.display_averages: describe() over all files together
function CombinedStatistics({ metric, values, files }: { metric: string; values: (number | null)[]; files: number }) {
  const stats = describe(values);
  return (
    <div className="space-y-1" data-testid="combined-statistics">
      <h3 className="text-sm font-medium">All {files} files together</h3>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Metric</TableHead>
            {DESCRIBE_KEYS.map((key) => (
              <TableHead key={key} className="text-right">
                {key}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell className="font-mono text-xs">{metric}</TableCell>
            {DESCRIBE_KEYS.map((key) => (
              <TableCell key={key} className="text-right tabular-nums">
                {stats[key] === null ? "–" : stats[key]!.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </TableCell>
            ))}
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
}

function SummaryCard({
  info,
  alias,
  device,
  descriptions,
}: {
  info: FileInfo;
  alias: string;
  device: string | null;
  descriptions: Record<string, string>;
}) {
  const { resolvedTheme } = useTheme();
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const restarts = useMemo(() => info.restarts.map((r) => r.time), [info]);
  const series = useRequest(
    (signal) => apiLimit(() => api.series(info.name, { header: alias, devices: device ?? undefined }, signal)),
    [info.name, alias, device],
  );
  const columns = useMemo(
    () => (series.data ? toColumns(series.data.series[0], series.data.metrics) : null),
    [series.data],
  );
  const title = [alias, device].filter(Boolean).join(" · ");

  return (
    <Card data-testid="multi-summary">
      <CardHeader>
        <CardTitle className="font-mono text-sm">{info.name}</CardTitle>
        <CardDescription>{title}</CardDescription>
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
                label={`${info.name} ${title} chart`}
              />
            }
            data={() => (
              <DataTable
                columns={columns}
                restarts={restarts}
                fileName={`${info.name}_${title}`.replace(/[^\w.-]+/g, "_")}
              />
            )}
            statistics={() => <StatisticsTable file={info.name} alias={alias} device={device} />}
            metrics={columns.metrics}
            descriptions={descriptions}
          />
        )}
      </CardContent>
    </Card>
  );
}
