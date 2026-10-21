"use client";

import { Trash2Icon } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AdminError } from "@/components/admin/admin-error";
import { message, useAdminData } from "@/components/admin/use-admin-data";
import { SELECT_CLASS } from "@/components/analyze/file-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";

const PAGE = 100;
const loadLogins = () => api.admin.logins();

// "Login History" of the Streamlit User Management.
export function LoginHistory() {
  const { data, error, reload } = useAdminData(loadLogins);
  const [user, setUser] = useState("");
  const [failedOnly, setFailedOnly] = useState(false);
  const [shown, setShown] = useState(PAGE);
  const [before, setBefore] = useState("");
  const [confirming, setConfirming] = useState(false);

  const users = useMemo(() => [...new Set(data?.logins.map((l) => l.username))].sort(), [data]);
  const rows = useMemo(
    () => data?.logins.filter((l) => (!user || l.username === user) && (!failedOnly || !l.success)) ?? [],
    [data, user, failedOnly],
  );

  async function removeOld() {
    try {
      const result = await api.admin.deleteLogins(before);
      toast.success(`${result.deleted} record(s) older than ${before} deleted`);
      setConfirming(false);
      await reload();
    } catch (err) {
      toast.error(message(err));
    }
  }

  return (
    <Card data-testid="login-history">
      <CardHeader>
        <CardTitle>Login history</CardTitle>
        <CardDescription>
          {data
            ? `${data.total.toLocaleString()} record(s)${data.total > data.logins.length ? `, newest ${data.logins.length.toLocaleString()} shown` : ""}`
            : "…"}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!data && error ? <AdminError error={error} /> : null}
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="history-user">User</Label>
            <select
              id="history-user"
              className={SELECT_CLASS}
              value={user}
              onChange={(event) => {
                setUser(event.target.value);
                setShown(PAGE);
              }}
            >
              <option value="">All users</option>
              {users.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>
          <label className="flex h-8 items-center gap-2 text-sm">
            <input type="checkbox" checked={failedOnly} onChange={(event) => setFailedOnly(event.target.checked)} />
            Failed only
          </label>
          <div className="ml-auto flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="delete-before">Delete records older than</Label>
              <Input
                id="delete-before"
                type="date"
                className="w-40"
                value={before}
                onChange={(event) => {
                  setBefore(event.target.value);
                  setConfirming(false);
                }}
              />
            </div>
            {confirming ? (
              <>
                <Button variant="destructive" size="sm" onClick={() => void removeOld()} data-testid="confirm-delete-logins">
                  Confirm
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
                  Cancel
                </Button>
              </>
            ) : (
              <Button variant="outline" size="sm" disabled={!before} onClick={() => setConfirming(true)}>
                <Trash2Icon /> Delete
              </Button>
            )}
          </div>
        </div>
        {!data ? (
          error == null && <Skeleton className="h-32 w-full" />
        ) : (
          <>
            <div className="max-h-[480px] overflow-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>User</TableHead>
                    <TableHead>Result</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.slice(0, shown).map((login, index) => (
                    <TableRow key={index} data-testid="login-row">
                      <TableCell className="font-mono text-xs">{login.time.replace("T", " ")}</TableCell>
                      <TableCell>{login.username}</TableCell>
                      <TableCell>
                        {login.success ? (
                          <Badge variant="secondary">success</Badge>
                        ) : (
                          <Badge variant="destructive">failed</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {rows.length > shown && (
              <Button variant="outline" size="sm" onClick={() => setShown(shown + PAGE)}>
                Show more ({(rows.length - shown).toLocaleString()} left)
              </Button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
