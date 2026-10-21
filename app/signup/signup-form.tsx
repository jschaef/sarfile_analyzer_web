"use client";

import { UserPlusIcon } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useInfo } from "@/components/help-note";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function SignupForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const info = useInfo();
  // set by the route handler when the form was posted without JavaScript
  const [error, setError] = useState<string | null>(searchParams.get("error"));
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (form.get("password") !== form.get("repeat")) {
      setError("The passwords do not match");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: form.get("username"), password: form.get("password") }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(body.detail ?? "Signup failed");
        return;
      }
      router.replace(body.username ? "/overview" : "/login");
      router.refresh();
    } catch {
      setError("Signup failed - is the server reachable?");
    } finally {
      setPending(false);
    }
  }

  if (info?.signup === false) {
    return (
      <Alert>
        <AlertDescription>Signup is disabled. Ask the admin for an account.</AlertDescription>
      </Alert>
    );
  }

  return (
    <Card>
      <CardContent>
        <form
          onSubmit={onSubmit}
          method="post"
          action="/api/auth/signup"
          className="space-y-4"
          data-testid="signup-form"
        >
          <div className="space-y-2">
            <Label htmlFor="username">Username</Label>
            <Input
              id="username"
              name="username"
              autoComplete="username"
              required
              maxLength={50}
              pattern="[A-Za-z0-9][A-Za-z0-9._@+\-]*"
              title="Letters, digits and . _ @ + - ; start with a letter or digit"
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              Letters, digits and <code>. _ @ + -</code>, starting with a letter or digit.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input id="password" name="password" type="password" autoComplete="new-password" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="repeat">Repeat password</Label>
            <Input id="repeat" name="repeat" type="password" autoComplete="new-password" required />
          </div>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <Button type="submit" className="w-full" disabled={pending}>
            <UserPlusIcon /> {pending ? "Creating account…" : "Create account"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
