import { ActivityIcon } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";

// Frame of the pages that work without a session (login, signup).
export function AuthPage({ subtitle, children }: { subtitle: string; children: React.ReactNode }) {
  return (
    <div className="relative flex flex-1 items-center justify-center px-4 py-12">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <ActivityIcon className="size-8 text-primary" />
          <h1 className="text-2xl font-semibold tracking-tight">SAR Analyzer</h1>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </div>
        {children}
      </div>
    </div>
  );
}
