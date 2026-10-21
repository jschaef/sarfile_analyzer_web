"use client";

import { LogInIcon } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { safeNext } from "@/lib/redirect";

// Set by the route handler when the form was posted without JavaScript.
const FORM_ERRORS: Record<string, string> = {
  invalid: "Invalid username or password",
  missing: "Username and password are required",
  unavailable: "Login failed - is the server reachable?",
};

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(FORM_ERRORS[searchParams.get("error") ?? ""] ?? null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: form.get("username"), password: form.get("password") }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(body.detail ?? "Login failed");
        return;
      }
      router.replace(safeNext(searchParams.get("next")));
      router.refresh();
    } catch {
      setError("Login failed - is the server reachable?");
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardContent>
        {/* method/action: without JavaScript the browser posts the form to the
            route handler - never as GET with the password in the URL */}
        <form
          onSubmit={onSubmit}
          method="post"
          action="/api/auth/login"
          className="space-y-4"
          data-testid="login-form"
        >
          <input type="hidden" name="next" value={safeNext(searchParams.get("next"))} />
          <div className="space-y-2">
            <Label htmlFor="username">Username</Label>
            <Input id="username" name="username" autoComplete="username" required autoFocus />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input id="password" name="password" type="password" autoComplete="current-password" required />
          </div>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <Button type="submit" className="w-full" disabled={pending}>
            <LogInIcon /> {pending ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
