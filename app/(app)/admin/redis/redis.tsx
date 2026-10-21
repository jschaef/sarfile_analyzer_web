"use client";

import { RefreshCwIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { AdminError } from "@/components/admin/admin-error";
import { message, useAdminData } from "@/components/admin/use-admin-data";
import { PageTitle, SELECT_CLASS } from "@/components/analyze/file-picker";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";

// "Redis Management" of the Streamlit app: delete fields of a Redis hash
// (cached data of the analyzer).
export function Redis() {
  const { data, error, reload } = useAdminData(api.admin.redis);
  const [key, setKey] = useState("");
  const [fields, setFields] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);

  const hashes = data?.keys.filter((k) => k.type === "hash") ?? [];
  const current = hashes.find((k) => k.key === key) ?? hashes[0];

  function choose(next: string) {
    setKey(next);
    setFields(new Set());
    setConfirming(false);
  }

  async function remove() {
    if (!current) return;
    try {
      const result = await api.admin.deleteRedisFields(current.key, [...fields]);
      toast.success(`${result.deleted} field(s) deleted from ${current.key}`);
      setFields(new Set());
      setConfirming(false);
      await reload();
    } catch (err) {
      toast.error(message(err));
    }
  }

  if (error && !data) return <AdminError error={error} />;

  return (
    <div className="space-y-6">
      <PageTitle title="Redis Management" description="Cached data in Redis">
        <Button variant="outline" size="sm" onClick={() => void reload()}>
          <RefreshCwIcon /> Refresh
        </Button>
      </PageTitle>
      {!data ? (
        <Skeleton className="h-48 w-full" />
      ) : !data.reachable ? (
        <Alert data-testid="redis-unavailable">
          <AlertDescription>
            {data.enabled
              ? "Redis is enabled but not reachable from sar-web-api."
              : "Redis is disabled (REDIS_ENABLED=false). The analyzer caches on disk only."}
          </AlertDescription>
        </Alert>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
          <Card>
            <CardHeader>
              <CardTitle>Keys</CardTitle>
              <CardDescription>
                {data.keys.length} key(s){data.truncated ? " (first 1000)" : ""}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="max-h-[480px] space-y-1 overflow-auto text-sm" data-testid="redis-keys">
                {data.keys.map((k) => (
                  <li key={k.key} className="flex items-center gap-2">
                    <span className="font-mono text-xs">{k.key}</span>
                    <Badge variant="secondary">{k.type}</Badge>
                    {k.type === "hash" && <span className="text-xs text-muted-foreground">{k.fields.length} field(s)</span>}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Delete hash fields</CardTitle>
              <CardDescription>Select a hash and the fields to delete</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {!current ? (
                <p className="text-sm text-muted-foreground">No hashes in Redis.</p>
              ) : (
                <>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="redis-hash">Hash</Label>
                    <select
                      id="redis-hash"
                      className={SELECT_CLASS}
                      value={current.key}
                      onChange={(event) => choose(event.target.value)}
                    >
                      {hashes.map((k) => (
                        <option key={k.key} value={k.key}>
                          {k.key}
                        </option>
                      ))}
                    </select>
                  </div>
                  <ul className="max-h-80 space-y-1 overflow-auto rounded-lg border p-2 text-sm">
                    {current.fields.map((field) => (
                      <li key={field}>
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={fields.has(field)}
                            onChange={(event) => {
                              const next = new Set(fields);
                              if (event.target.checked) next.add(field);
                              else next.delete(field);
                              setFields(next);
                              setConfirming(false);
                            }}
                          />
                          <span className="font-mono text-xs break-all">{field}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                  {confirming ? (
                    <div className="flex gap-2">
                      <Button variant="destructive" size="sm" onClick={() => void remove()}>
                        Delete {fields.size} field(s)
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <Button variant="outline" size="sm" disabled={fields.size === 0} onClick={() => setConfirming(true)}>
                      <Trash2Icon /> Delete selected ({fields.size})
                    </Button>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
