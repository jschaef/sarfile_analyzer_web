import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Multi } from "./multi";

export const metadata = { title: "Multiple SAR Files · SAR Analyzer" };

export default function MultiPage() {
  return (
    <Suspense fallback={<Skeleton className="h-64 w-full" />}>
      <Multi />
    </Suspense>
  );
}
