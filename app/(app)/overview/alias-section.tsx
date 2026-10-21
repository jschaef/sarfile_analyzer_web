"use client";

import { useEffect, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { api, type SeriesResponse } from "@/lib/api";
import { apiLimit } from "@/lib/limit";
import { ChartCard } from "./chart-card";

type Props = {
  file: string;
  alias: string;
  start?: string;
  end?: string;
  restarts: number[];
  descriptions: Record<string, string>;
};

// One header (alias) of the overview, one request: sar-web-api applies the
// rules of dia_compute.prepare_df_for_pandas itself (no sub-devices -> one
// series; CPU-like -> only 'all'; DEV, IFACE, ... -> every device).
export function AliasSection({ file, alias, start, end, restarts, descriptions }: Props) {
  const [data, setData] = useState<SeriesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    apiLimit(() => api.series(file, { header: alias, start, end }, controller.signal))
      .then(setData)
      .catch((e: Error) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => controller.abort();
  }, [file, alias, start, end]);

  return (
    <section className="space-y-3" data-testid="alias-section" data-alias={alias}>
      <h2 className="text-lg font-semibold">{alias}</h2>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {!data && !error && <Skeleton className="h-[440px] w-full" />}
      {data?.series.map((series) => (
        <ChartCard
          key={series.device ?? "-"}
          file={file}
          alias={alias}
          series={series}
          metrics={data.metrics}
          // "all of N" for the CPU aggregate, the device name for DEV/IFACE charts
          title={series.device && series.device !== "all" ? series.device : null}
          subtitle={series.device === "all" ? `all of ${data.device_count}` : undefined}
          start={start}
          end={end}
          restarts={restarts}
          descriptions={descriptions}
        />
      ))}
    </section>
  );
}
