import { Suspense } from "react";
import { AnalyzeNav } from "@/components/analyze/analyze-nav";

export default function AnalyzeLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* useSearchParams() (?file=) needs a Suspense boundary with Cache Components */}
      <Suspense>
        <AnalyzeNav />
      </Suspense>
      {children}
    </>
  );
}
