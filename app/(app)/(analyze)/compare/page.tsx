import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Compare } from "./compare";

export const metadata = { title: "Compare Metrics · SAR Analyzer" };

export default function ComparePage() {
  return (
    // useSearchParams() (?file=) needs a Suspense boundary with Cache Components
    <Suspense fallback={<Skeleton className="h-64 w-full" />}>
      <Compare />
    </Suspense>
  );
}
