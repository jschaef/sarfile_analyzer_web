import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Devices } from "./devices";

export const metadata = { title: "Metrics on many devices · SAR Analyzer" };

export default function DevicesPage() {
  return (
    // useSearchParams() (?file=) needs a Suspense boundary with Cache Components
    <Suspense fallback={<Skeleton className="h-64 w-full" />}>
      <Devices />
    </Suspense>
  );
}
