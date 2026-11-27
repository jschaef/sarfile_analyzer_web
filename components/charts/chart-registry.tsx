"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import type { ChartPdfSource } from "@/lib/chart-pdf";

// Collects the charts that are mounted below a <ChartRegistry>, so one button
// can export all of them into a single PDF ("Create PDF from all diagrams" in
// the Streamlit overview). Charts report themselves on mount and remove
// themselves on unmount; that works because the overview mounts every card at
// once (overview.tsx -> AliasSection -> ChartCard, the chart tab keeps its
// content mounted).
export type ChartSlot = {
  // where the chart belongs in the export: the position of its alias in the
  // option order (not the click order, like sel_order_map in Streamlit) and,
  // below that, the position of its device
  order: number;
  subOrder: number;
};

// What the collective statistics CSV needs per card: which series to ask the
// API for, and the label that heads its block.
export type StatsSource = {
  file: string;
  alias: string;
  device: string | null;
  start?: string;
  end?: string;
  label: string;
};

export type RegisteredChart = ChartSlot & {
  id: number;
  // read late so zoom, legend state and labels are the current ones
  source: () => ChartPdfSource;
  // missing for charts outside the overview
  stats?: () => StatsSource;
};

type Register = (chart: Omit<RegisteredChart, "id">) => () => void;

const RegisterContext = createContext<Register | null>(null);
const ChartsContext = createContext<RegisteredChart[]>([]);

export function ChartRegistry({ children }: { children: ReactNode }) {
  const [charts, setCharts] = useState<RegisteredChart[]>([]);
  const nextId = useRef(0);

  // stable: a chart registers once per mount, not on every render of the page
  const register = useCallback<Register>((chart) => {
    const id = nextId.current++;
    setCharts((current) => [...current, { ...chart, id }]);
    return () => setCharts((current) => current.filter((entry) => entry.id !== id));
  }, []);

  const sorted = useMemo(
    () => [...charts].sort((a, b) => a.order - b.order || a.subOrder - b.subOrder),
    [charts],
  );

  return (
    <RegisterContext.Provider value={register}>
      <ChartsContext.Provider value={sorted}>{children}</ChartsContext.Provider>
    </RegisterContext.Provider>
  );
}

// null outside a <ChartRegistry> - the other chart pages show one chart only
// and need no collective export.
export function useChartRegister(): Register | null {
  return useContext(RegisterContext);
}

export function useRegisteredCharts(): RegisteredChart[] {
  return useContext(ChartsContext);
}
