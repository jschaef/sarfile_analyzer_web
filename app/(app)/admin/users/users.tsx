"use client";

import { KeyRoundIcon, Trash2Icon } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { AdminError } from "@/components/admin/admin-error";
import { message, useAdminData } from "@/components/admin/use-admin-data";
import { PageTitle, SELECT_CLASS } from "@/components/analyze/file-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, type UserEntry } from "@/lib/api";
import { LoginHistory } from "./login-history";

// "User Management" of the Streamlit app: users, roles, passwords, deletion,
// login history.
export function Users() {
  const { data, error, reload } = useAdminData(api.admin.users);
  const [me, setMe] = useState<string | null>(null);

  useEffect(() => {
    api.me().then((user) => setMe(user.username)).catch(() => setMe(null));
  }, []);

  if (error && !data) return <AdminError error={error} />;

  return (
    <div className="space-y-6">
      <PageTitle title="User Management" description="Accounts, roles and passwords">
        {data && (
          <div className="text-right" data-testid="login-count">
            <div className="text-2xl font-semibold tabular-nums">{data.login_count.toLocaleString()}</div>
            <div className="text-xs text-muted-foreground">
              successful logins (without {data.login_count_excludes})
            </div>
          </div>
        )}
      </PageTitle>
      <Card>
        <CardHeader>
          <CardTitle>Users</CardTitle>
          <CardDescription>
            {data ? `${data.users.length} account(s)` : "…"} · deleting a user also deletes their SAR files
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!data ? (
            <Skeleton className="h-32 w-full" />
          ) : (
            <Table data-testid="user-table">
              <TableHeader>
                <TableRow>
                  <TableHead>Username</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead className="w-0 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.users.map((user) => (
                  <UserRow key={user.username} user={user} roles={data.roles} self={user.username === me} onChange={reload} />
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      <LoginHistory />
    </div>
  );
}

function UserRow({
  user,
  roles,
  self,
  onChange,
}: {
  user: UserEntry;
  roles: string[];
  self: boolean;
  onChange: () => Promise<void>;
}) {
  const [mode, setMode] = useState<"idle" | "password" | "delete">("idle");
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    try {
      await action();
      toast.success(success);
      setMode("idle");
      await onChange();
    } catch (error) {
      toast.error(message(error));
    } finally {
      setBusy(false);
    }
  }

  function setPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    if (password !== form.get("repeat")) {
      toast.error("The passwords do not match");
      return;
    }
    void run(() => api.admin.setPassword(user.username, password), `Password of ${user.username} has been changed`);
  }

  return (
    <>
      <TableRow data-testid="user-row" data-user={user.username}>
        <TableCell className="font-medium">
          {user.username} {self && <Badge variant="secondary">you</Badge>}
        </TableCell>
        <TableCell>
          <select
            aria-label={`Role of ${user.username}`}
            className={SELECT_CLASS}
            value={user.role}
            // your own admin role can only be taken away by another admin
            disabled={self || busy}
            onChange={(event) => {
              const role = event.target.value;
              void run(() => api.admin.setRole(user.username, role), `Role ${role} set for ${user.username}`);
            }}
          >
            {roles.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>
        </TableCell>
        <TableCell>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setMode(mode === "password" ? "idle" : "password")}
              data-testid="set-password"
            >
              <KeyRoundIcon /> Password
            </Button>
            {!self &&
              (mode === "delete" ? (
                <>
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      void run(() => api.admin.deleteUser(user.username), `User ${user.username} has been deleted`)
                    }
                    data-testid="confirm-delete-user"
                  >
                    {busy ? "Deleting…" : "Delete user and files"}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setMode("idle")}>
                    Cancel
                  </Button>
                </>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Delete ${user.username}`}
                  onClick={() => setMode("delete")}
                  data-testid="delete-user"
                >
                  <Trash2Icon />
                </Button>
              ))}
          </div>
        </TableCell>
      </TableRow>
      {mode === "password" && (
        <TableRow>
          <TableCell colSpan={3} className="bg-muted/40">
            <form onSubmit={setPassword} className="flex flex-wrap items-end gap-3" data-testid="user-password-form">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`pw-${user.username}`}>New password for {user.username}</Label>
                <Input id={`pw-${user.username}`} name="password" type="password" autoComplete="new-password" required />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`pw2-${user.username}`}>Repeat</Label>
                <Input id={`pw2-${user.username}`} name="repeat" type="password" autoComplete="new-password" required />
              </div>
              <Button type="submit" size="sm" disabled={busy}>
                Save password
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setMode("idle")}>
                Cancel
              </Button>
            </form>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}
