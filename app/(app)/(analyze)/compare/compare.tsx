"use client";

import { PlusIcon, Trash2Icon } from "lucide-react";
import { useTheme } from "next-themes";
import { useMemo, useState } from "react";
import { DataTable } from "@/components/analyze/data-table";
import { FilePicker, NoFiles, PageTitle, SELECT_CLASS } from "@/components/analyze/file-picker";
import { useInfo } from "@/components/help-note";
import { ResultTabs } from "@/components/analyze/result-tabs";
import { StatisticsTable } from "@/components/analyze/statistics-table";
import { LineChart } from "@/components/charts/line-chart";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { api, type FileInfo, type HeaderDetails } from "@/lib/api";
import type { Line } from "@/lib/echarts-option";
import { useFileInfo, useMetricDescriptions, useRequest, useSelectedFile } from "@/lib/hooks";
import { apiLimit } from "@/lib/limit";
import { sortDevices } from "@/lib/sar";

// Up to max_header_count (Admin > Settings, default 6) header/device/metric
// combinations in one chart, like the Streamlit page "Compare Metrics".
const DEFAULT_MAX_SLOTS = 6;
const DEFAULT_SLOTS = 3;

type Slot = { alias: string; device: string | null; metric: string };
type ResolvedSlot = Slot & { label: string };

export function Compare() {
  const { files, fileName, select, error: filesError } = useSelectedFile();
  const { info, error: infoError } = useFileInfo(fileName);
  const descriptions = useMetricDescriptions();
  const error = filesError ?? infoError;

  if (files && files.length === 0) return <NoFiles />;

  return (
    <div className="space-y-6">
      <PageTitle title="Compare Metrics" description="Show different metrics of one file in one chart">
        <FilePicker files={files} value={fileName} onChange={select} />
      </PageTitle>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {info ? (
        <CompareForFile key={info.name} info={info} descriptions={descriptions} />
      ) : (
        !error && <Skeleton className="h-48 w-full" />
      )}
    </div>
  );
}

function CompareForFile({ info, descriptions }: { info: FileInfo; descriptions: Record<string, string> }) {
  const { resolvedTheme } = useTheme();
  const headers = useMemo(() => [...info.headers].sort((a, b) => a.alias.localeCompare(b.alias)), [info]);
  const metricsOf = (alias: string) => headers.find((h) => h.alias === alias)?.metrics ?? [];
  // like the Streamlit defaults: the first heading, different metrics per slot
  const maxSlots = useInfo()?.max_header_count ?? DEFAULT_MAX_SLOTS;
  const [allSlots, setSlots] = useState<Slot[]>(() => {
    const first = headers[0];
    return Array.from({ length: Math.min(DEFAULT_SLOTS, first.metrics.length) }, (_, i) => ({
      alias: first.alias,
      device: null,
      metric: first.metrics[i],
    }));
  });
  // a lowered maximum hides the slots beyond it
  const slots = allSlots.slice(0, maxSlots);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const restarts = useMemo(() => info.restarts.map((r) => r.time), [info]);

  // device lists of the headings in use
  const aliases = [...new Set(slots.map((s) => s.alias))].sort();
  const details = useRequest(
    (signal) =>
      Promise.all(aliases.map((alias) => apiLimit(() => api.header(info.name, alias, signal)))).then(
        (list) => Object.fromEntries(list.map((d) => [d.alias, d])) as Record<string, HeaderDetails>,
      ),
    [info.name, aliases],
  );

  // a slot without a chosen device uses the heading's first one ('all' for CPU)
  const resolved: ResolvedSlot[] | null = details.data
    ? slots.map((slot) => {
        const devices = sortDevices(details.data![slot.alias]?.devices ?? []);
        const device = slot.device && devices.includes(slot.device) ? slot.device : (devices[0] ?? null);
        return { ...slot, device, label: [slot.alias, device, slot.metric].filter(Boolean).join(" ") };
      })
    : null;

  const data = useRequest(
    resolved
      ? (signal) =>
          Promise.all(
            resolved.map((slot) =>
              apiLimit(() =>
                api.series(
                  info.name,
                  { header: slot.alias, devices: slot.device ?? undefined, metrics: slot.metric },
                  signal,
                ),
              ),
            ),
          )
      : null,
    [info.name, resolved?.map((s) => [s.alias, s.device, s.metric])],
  );

  const lines = useMemo<Line[] | null>(() => {
    if (!data.data || !resolved) return null;
    return data.data.map((response, i) => ({
      name: resolved[i].label,
      x: response.series[0].x,
      y: response.series[0].values[resolved[i].metric],
    }));
    // resolved is derived from slots + details; data changes whenever they do
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.data]);

  function update(index: number, change: Partial<Slot>) {
    setSlots((current) => current.map((slot, i) => (i === index ? { ...slot, ...change } : slot)));
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Metrics to compare</CardTitle>
          <CardDescription>Up to {maxSlots} combinations of heading, device and metric.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {slots.map((slot, index) => {
            const devices = sortDevices(details.data?.[slot.alias]?.devices ?? []);
            const device = resolved?.[index].device ?? null;
            return (
              <div
                key={index}
                className="flex flex-wrap items-end gap-3 border-b pb-3 last:border-0"
                data-testid="compare-slot"
              >
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`slot-${index}-header`}>Heading {index + 1}</Label>
                  <select
                    id={`slot-${index}-header`}
                    className={SELECT_CLASS}
                    value={slot.alias}
                    onChange={(event) =>
                      update(index, {
                        alias: event.target.value,
                        device: null,
                        metric: metricsOf(event.target.value)[0],
                      })
                    }
                  >
                    {headers.map((h) => (
                      <option key={h.alias} value={h.alias}>
                        {h.alias}
                      </option>
                    ))}
                  </select>
                </div>
                {devices.length > 0 && (
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`slot-${index}-device`}>Device</Label>
                    <select
                      id={`slot-${index}-device`}
                      className={SELECT_CLASS}
                      value={device ?? ""}
                      onChange={(event) => update(index, { device: event.target.value })}
                    >
                      {devices.map((d) => (
                        <option key={d} value={d}>
                          {d}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`slot-${index}-metric`}>Metric</Label>
                  <select
                    id={`slot-${index}-metric`}
                    className={SELECT_CLASS}
                    value={slot.metric}
                    onChange={(event) => update(index, { metric: event.target.value })}
                    title={descriptions[slot.metric]}
                  >
                    {metricsOf(slot.alias).map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove metric ${index + 1}`}
                  disabled={slots.length === 1}
                  onClick={() => setSlots((current) => current.filter((_, i) => i !== index))}
                >
                  <Trash2Icon />
                </Button>
              </div>
            );
          })}
          <Button
            variant="outline"
            size="sm"
            disabled={slots.length >= maxSlots}
            onClick={() => setSlots([...slots, { ...slots[slots.length - 1], device: null }])}
            data-testid="add-slot"
          >
            <PlusIcon /> Add metric
          </Button>
        </CardContent>
      </Card>

      <Card data-testid="compare-card">
        <CardHeader>
          <CardTitle>Compare different metrics</CardTitle>
          <CardDescription>{resolved?.map((s) => s.label).join(" · ")}</CardDescription>
        </CardHeader>
        <CardContent>
          {(details.error || data.error) && (
            <Alert variant="destructive">
              <AlertDescription>{details.error ?? data.error}</AlertDescription>
            </Alert>
          )}
          {!lines || !resolved || !data.data ? (
            !details.error && !data.error && <Skeleton className="h-[380px] w-full" />
          ) : (
            <ResultTabs
              chart={
                <LineChart
                  lines={lines}
                  restarts={restarts}
                  dark={resolvedTheme === "dark"}
                  selected={selected}
                  onSelectedChange={setSelected}
                  label="Compare different metrics chart"
                />
              }
              data={() => (
                <div className="grid gap-6 lg:grid-cols-2">
                  {resolved.map((slot, i) => (
                    <div key={i} className="space-y-1">
                      <h3 className="text-sm font-medium">{slot.label}</h3>
                      <DataTable
                        columns={{
                          x: data.data![i].series[0].x,
                          series: { [slot.metric]: data.data![i].series[0].values[slot.metric] },
                          metrics: [slot.metric],
                        }}
                        restarts={restarts}
                        fileName={`${info.name}_${slot.label}`.replace(/[^\w.-]+/g, "_")}
                      />
                    </div>
                  ))}
                </div>
              )}
              statistics={() => (
                <div className="space-y-4">
                  {resolved.map((slot, i) => (
                    <div key={i} className="space-y-1">
                      <h3 className="text-sm font-medium">{slot.label}</h3>
                      <StatisticsTable
                        file={info.name}
                        alias={slot.alias}
                        device={slot.device}
                        metrics={[slot.metric]}
                      />
                    </div>
                  ))}
                </div>
              )}
              metrics={[...new Set(resolved.map((s) => s.metric))]}
              descriptions={descriptions}
            />
          )}
        </CardContent>
      </Card>
    </>
  );
}
