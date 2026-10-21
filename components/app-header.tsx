"use client";

import { ActivityIcon, LogOutIcon, UserIcon } from "lucide-react";
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
  // only shown to admins; the API checks the role on every admin request
  { href: "/admin/users", label: "Admin", active: (path: string) => path.startsWith("/admin"), admin: true },
  { href: "/info", label: "Info", active: (path: string) => path.startsWith("/info") },
];

export function AppHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<{ username: string; role: string } | null>(null);

  useEffect(() => {
    api
      .me()
      .then(setUser)
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
          {NAV.filter((item) => !item.admin || user?.role === "admin").map((item) => (
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
            <Link
              href="/account"
              title="Self Service"
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                pathname.startsWith("/account") && "bg-muted text-foreground",
              )}
            >
              <UserIcon className="size-4" />
              <span data-testid="current-user">{user.username}</span>
            </Link>
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
