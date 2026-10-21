"use client";

import { ActivityIcon, LogOutIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { isAnalyzePath } from "@/components/analyze/analyze-nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/overview", label: "Analyze", active: isAnalyzePath },
  { href: "/files", label: "Manage SAR Files", active: (path: string) => path.startsWith("/files") },
];

export function AppHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<string | null>(null);

  useEffect(() => {
    api
      .me()
      .then((me) => setUser(me.username))
      .catch(() => setUser(null));
  }, []);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-30 border-b bg-background/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-screen-2xl items-center gap-6 px-4">
        <Link href="/overview" className="flex items-center gap-2 font-semibold">
          <ActivityIcon className="size-5 text-primary" />
          SAR Analyzer
        </Link>
        <nav className="flex items-center gap-1" aria-label="Main">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm transition-colors hover:bg-muted",
                item.active(pathname) && "bg-muted font-medium text-foreground",
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          {user && (
            <span className="text-sm text-muted-foreground" data-testid="current-user">
              {user}
            </span>
          )}
          <ThemeToggle />
          <Button variant="outline" size="sm" onClick={logout} data-testid="logout">
            <LogOutIcon /> Logout
          </Button>
        </div>
      </div>
    </header>
  );
}
