"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

// The admin menu items of the Streamlit app.
const ADMIN_VIEWS = [
  { href: "/admin/users", label: "User Management" },
  { href: "/admin/database", label: "DB Management" },
  { href: "/admin/redis", label: "Redis Management" },
];

export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Admin" className="-mt-2 mb-6 overflow-x-auto border-b" data-testid="admin-nav">
      <ul className="flex min-w-max gap-1">
        {ADMIN_VIEWS.map((view) => {
          const active = pathname.startsWith(view.href);
          return (
            <li key={view.href}>
              <Link
                href={view.href}
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
