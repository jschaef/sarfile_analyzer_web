import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Details } from "./details";

export const metadata = { title: "Detailed Metrics · SAR Analyzer" };

export default function DetailsPage() {
  return (
    // useSearchParams() (?file=) needs a Suspense boundary with Cache Components
    <Suspense fallback={<Skeleton className="h-64 w-full" />}>
      <Details />
    </Suspense>
  );
}
