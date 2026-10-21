"use client";

import { KeyRoundIcon } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { PageTitle } from "@/components/analyze/file-picker";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";

// "Self Service" of the Streamlit app: change your own password.
export function Account() {
  const [me, setMe] = useState<{ username: string; role: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    api.me().then(setMe).catch(() => setMe(null));
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const next = String(form.get("new") ?? "");
    if (next !== form.get("repeat")) {
      setError("The new passwords do not match");
      return;
    }
    setPending(true);
    setError(null);
    try {
      await api.changeOwnPassword(String(form.get("current") ?? ""), next);
      toast.success("Your password has been changed");
      formRef.current?.reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not change the password");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageTitle title="Self Service" description="Your account" />
      <Card className="max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {me?.username ?? "…"}
            {me && <Badge variant="secondary">{me.role}</Badge>}
          </CardTitle>
          <CardDescription>Change your password</CardDescription>
        </CardHeader>
        <CardContent>
          <form ref={formRef} onSubmit={onSubmit} className="space-y-4" data-testid="password-form">
            <div className="space-y-2">
              <Label htmlFor="current">Current password</Label>
              <Input id="current" name="current" type="password" autoComplete="current-password" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new">New password</Label>
              <Input id="new" name="new" type="password" autoComplete="new-password" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="repeat">Repeat new password</Label>
              <Input id="repeat" name="repeat" type="password" autoComplete="new-password" required />
            </div>
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <Button type="submit" disabled={pending}>
              <KeyRoundIcon /> {pending ? "Saving…" : "Change password"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
