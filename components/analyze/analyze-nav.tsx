"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

// The "Analyze/Compare" modes of the Streamlit app (analyze_pl.analyze).
export const ANALYZE_VIEWS = [
  { href: "/overview", label: "Graphical Overview" },
  { href: "/details", label: "Detailed Metrics" },
  { href: "/devices", label: "Metrics on many devices" },
  { href: "/compare", label: "Compare Metrics" },
  { href: "/multi", label: "Multiple SAR Files" },
];

export function isAnalyzePath(pathname: string) {
  return ANALYZE_VIEWS.some((view) => pathname.startsWith(view.href));
}

export function AnalyzeNav() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // keep the chosen file when switching views
  const file = searchParams.get("file");
  const suffix = file ? `?file=${encodeURIComponent(file)}` : "";

  return (
    <nav aria-label="Analyze" className="-mt-2 mb-6 overflow-x-auto border-b" data-testid="analyze-nav">
      <ul className="flex min-w-max gap-1">
        {ANALYZE_VIEWS.map((view) => {
          const active = pathname.startsWith(view.href);
          return (
            <li key={view.href}>
              <Link
                href={view.href + suffix}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-block border-b-2 px-3 py-2 text-sm transition-colors",
                  active
                    ? "border-primary font-medium text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {view.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
