"use client";

import { useState } from "react";
import { PageTitle } from "@/components/analyze/file-picker";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { HeadingsTable } from "./headings-table";
import { MetricsTable } from "./metrics-table";

// "DB Management" of the Streamlit app: the metric descriptions and the sar
// headings (alias, device keyword) in data.db.
export function Database() {
  const [tab, setTab] = useState("metrics");
  return (
    <div className="space-y-6">
      <PageTitle
        title="DB Management"
        description="Metric descriptions and sar headings – changes apply to every user right away"
      />
      <Tabs value={tab} onValueChange={(value) => setTab(String(value))}>
        <TabsList>
          <TabsTrigger value="metrics">Metrics</TabsTrigger>
          <TabsTrigger value="headings">Headings</TabsTrigger>
        </TabsList>
        <TabsContent value="metrics">
          <MetricsTable />
        </TabsContent>
        <TabsContent value="headings">
          <HeadingsTable />
        </TabsContent>
      </Tabs>
    </div>
  );
}
