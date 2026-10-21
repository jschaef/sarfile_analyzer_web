"use client";

import { useState } from "react";
import { MetricDescriptions } from "@/components/analyze/metric-descriptions";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

// Chart / Data / Statistics / man page tabs shared by the analysis views.
// Data and statistics render only while their tab is open (they can be big).
export function ResultTabs({
  chart,
  data,
  statistics,
  metrics,
  descriptions,
}: {
  chart: React.ReactNode;
  data?: () => React.ReactNode;
  statistics?: () => React.ReactNode;
  metrics: string[];
  descriptions: Record<string, string>;
}) {
  const [tab, setTab] = useState("chart");
  return (
    <Tabs value={tab} onValueChange={(value) => setTab(String(value))}>
      <TabsList>
        <TabsTrigger value="chart">Chart</TabsTrigger>
        {data && <TabsTrigger value="data">Data</TabsTrigger>}
        {statistics && <TabsTrigger value="statistics">Statistics</TabsTrigger>}
        <TabsTrigger value="metrics">Metrics</TabsTrigger>
      </TabsList>
      <TabsContent value="chart" keepMounted>
        {chart}
      </TabsContent>
      {data && <TabsContent value="data">{tab === "data" && data()}</TabsContent>}
      {statistics && <TabsContent value="statistics">{tab === "statistics" && statistics()}</TabsContent>}
      <TabsContent value="metrics">
        <MetricDescriptions metrics={metrics} descriptions={descriptions} />
      </TabsContent>
    </Tabs>
  );
}
