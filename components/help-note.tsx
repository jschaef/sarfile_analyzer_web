"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, type Info } from "@/lib/api";

let infoRequest: Promise<Info> | null = null;

// /api/v2/info works without a session; loaded once per page load.
export function useInfo(): Info | null {
  const [info, setInfo] = useState<Info | null>(null);
  useEffect(() => {
    infoRequest ??= api.info();
    infoRequest.then(setInfo).catch(() => {
      infoRequest = null;
    });
  }, []);
  return info;
}

export function AdminContact({ info }: { info: Info | null }) {
  if (!info) return <>the admin</>;
  return (
    <a className="underline underline-offset-2" href={`mailto:${info.admin_email}`}>
      {info.admin_email}
    </a>
  );
}

// The Help page of the Streamlit app, below the login and signup forms.
export function HelpNote({ page }: { page: "login" | "signup" }) {
  const info = useInfo();
  return (
    <div className="space-y-1 text-center text-sm text-muted-foreground" data-testid="help-note">
      {page === "login" ? (
        info?.signup !== false && (
          <p>
            No account yet?{" "}
            <Link className="font-medium text-foreground underline underline-offset-2" href="/signup">
              Create one
            </Link>
          </p>
        )
      ) : (
        <p>
          Already registered?{" "}
          <Link className="font-medium text-foreground underline underline-offset-2" href="/login">
            Sign in
          </Link>
        </p>
      )}
      <p>
        Forgot your password? Ask <AdminContact info={info} /> to reset it.
      </p>
    </div>
  );
}
