"use client";

import { ListFilterIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { useMemo, useState } from "react";
import { LineChart } from "@/components/charts/line-chart";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { DeviceSeries } from "@/lib/api";
import { toColumns } from "@/lib/sar";
import { MetricDescriptions } from "./metric-descriptions";
import { StatisticsTable } from "./statistics-table";

type Props = {
  file: string;
  alias: string;
  series: DeviceSeries;
  metrics: string[];
  title: string | null;
  subtitle?: string;
  start?: string;
  end?: string;
  restarts: number[];
  descriptions: Record<string, string>;
};

const NO_RESTARTS: number[] = [];

export function ChartCard(props: Props) {
  const { file, alias, series, metrics, title, subtitle, start, end, restarts, descriptions } = props;
  const { resolvedTheme } = useTheme();
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [tab, setTab] = useState<string>("chart");
  const columns = useMemo(() => toColumns(series, metrics), [series, metrics]);

  // restart markers only make sense inside the plotted range
  const first = columns.x[0];
  const last = columns.x[columns.x.length - 1];
  const visibleRestarts = restarts.some((x) => x >= first && x <= last) ? restarts : NO_RESTARTS;
  const visibleCount = metrics.filter((m) => selected[m] !== false).length;
  const label = title ? `${alias} ${title}` : alias;

  function setAll(visible: boolean) {
    setSelected(Object.fromEntries(metrics.map((m) => [m, visible])));
  }

  return (
    <Card size="sm" data-testid="chart-card" data-alias={alias} data-device={series.device ?? ""}>
      <CardHeader>
        {title && <CardTitle>{title}</CardTitle>}
        <CardDescription>
          {subtitle && <span className="mr-2 font-medium">{subtitle}</span>}
          {`${series.rows.toLocaleString()} samples · ${metrics.length} metrics`}
        </CardDescription>
        <CardAction>
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" size="sm" data-testid="metric-filter" />}>
              <ListFilterIcon /> Metrics {visibleCount}/{metrics.length}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-80 w-56">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Show metrics</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => setAll(true)}>Show all</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setAll(false)}>Hide all</DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              {metrics.map((metric) => (
                <DropdownMenuCheckboxItem
                  key={metric}
                  checked={selected[metric] !== false}
                  onCheckedChange={(checked) => setSelected((s) => ({ ...s, [metric]: checked }))}
                  closeOnClick={false}
                  title={descriptions[metric]}
                >
                  {metric}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-3">
        {series.duplicates > 0 && (
          // the Streamlit overview warns about "multiple indexes" the same way
          <Alert data-testid="duplicates-warning">
            <AlertDescription>
              {series.duplicates} duplicate timestamp(s) in this data - only the first value per
              timestamp is plotted.
            </AlertDescription>
          </Alert>
        )}
        <Tabs value={tab} onValueChange={(value) => setTab(String(value))}>
          <TabsList>
            <TabsTrigger value="chart">Chart</TabsTrigger>
            <TabsTrigger value="statistics">Statistics</TabsTrigger>
            <TabsTrigger value="metrics">Metrics</TabsTrigger>
          </TabsList>
          <TabsContent value="chart" keepMounted>
            <LineChart
              columns={columns}
              restarts={visibleRestarts}
              dark={resolvedTheme === "dark"}
              selected={selected}
              onSelectedChange={setSelected}
              label={`${label} chart`}
            />
          </TabsContent>
          <TabsContent value="statistics">
            {tab === "statistics" && (
              <StatisticsTable file={file} alias={alias} device={series.device} start={start} end={end} />
            )}
          </TabsContent>
          <TabsContent value="metrics">
            <MetricDescriptions metrics={metrics} descriptions={descriptions} />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
