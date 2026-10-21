"use client";

import { PlusIcon, SearchIcon, Trash2Icon } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { AdminError } from "@/components/admin/admin-error";
import { message, useAdminData } from "@/components/admin/use-admin-data";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";

export function MetricsTable() {
  const { data, error, reload } = useAdminData(api.admin.metrics);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!data || !term) return data ?? [];
    return data.filter((m) => m.metric.toLowerCase().includes(term) || m.description.toLowerCase().includes(term));
  }, [data, search]);

  function toggle(metric: string, checked: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(metric);
      else next.delete(metric);
      return next;
    });
    setConfirming(false);
  }

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const metric = String(form.get("metric") ?? "").trim();
    setBusy(true);
    try {
      await api.admin.addMetric({ metric, description: String(form.get("description") ?? "") });
      toast.success(`Metric ${metric} added`);
      formElement.reset();
      setSearch(metric);
      await reload();
    } catch (err) {
      toast.error(message(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      const result = await api.admin.deleteMetrics([...selected]);
      toast.success(`Deleted: ${result.deleted.join(", ")}`);
      setSelected(new Set());
      setConfirming(false);
      await reload();
    } catch (err) {
      toast.error(message(err));
    } finally {
      setBusy(false);
    }
  }

  if (error && !data) return <AdminError error={error} />;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <Card>
        <CardHeader>
          <CardTitle>Metric descriptions</CardTitle>
          <CardDescription>
            {data ? `${rows.length} of ${data.length}` : "…"} · shown as &quot;man pages&quot; in the analysis views
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-72">
              <SearchIcon className="absolute top-2 left-2 size-4 text-muted-foreground" />
              <Input
                aria-label="Search metrics"
                placeholder="Search metric or description"
                className="pl-8"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <div className="ml-auto flex gap-2">
              {confirming ? (
                <>
                  <Button variant="destructive" size="sm" disabled={busy} onClick={() => void remove()} data-testid="confirm-delete-metrics">
                    Delete {selected.size} metric(s)
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
                    Cancel
                  </Button>
                </>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={selected.size === 0}
                  onClick={() => setConfirming(true)}
                  data-testid="delete-metrics"
                >
                  <Trash2Icon /> Delete selected ({selected.size})
                </Button>
              )}
            </div>
          </div>
          {!data ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <div className="max-h-[560px] overflow-auto rounded-lg border">
              <Table data-testid="metric-table">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-0" />
                    <TableHead>Metric</TableHead>
                    <TableHead>Description</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((m) => (
                    <TableRow key={m.metric} data-testid="metric-row" data-metric={m.metric}>
                      <TableCell>
                        <input
                          type="checkbox"
                          aria-label={`Select ${m.metric}`}
                          checked={selected.has(m.metric)}
                          onChange={(event) => toggle(m.metric, event.target.checked)}
                        />
                      </TableCell>
                      <TableCell className="align-top font-mono text-xs">{m.metric}</TableCell>
                      <TableCell className="text-sm whitespace-normal text-muted-foreground">{m.description}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
      <Card className="h-fit">
        <CardHeader>
          <CardTitle>Add metric</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={add} className="space-y-3" data-testid="add-metric-form">
            <div className="space-y-1.5">
              <Label htmlFor="new-metric">Metric</Label>
              <Input id="new-metric" name="metric" required maxLength={100} placeholder="e.g. rkB/s" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-metric-description">Description</Label>
              <Textarea id="new-metric-description" name="description" maxLength={1000} rows={5} />
            </div>
            <Button type="submit" disabled={busy}>
              <PlusIcon /> Add metric
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
