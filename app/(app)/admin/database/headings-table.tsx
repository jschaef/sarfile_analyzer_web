"use client";

import { PencilIcon, PlusIcon, SearchIcon, Trash2Icon } from "lucide-react";
import { useId, useMemo, useState, type FormEvent } from "react";
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
import { api, type HeadingEntry } from "@/lib/api";

const EMPTY: HeadingEntry = { header: "", alias: "", keyword: "", description: "" };

export function HeadingsTable() {
  const { data, error, reload } = useAdminData(api.admin.headers);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  // like the Streamlit "Search": a metric finds every heading that has it
  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!data || !term) return data ?? [];
    return data.filter(
      (h) =>
        h.alias.toLowerCase().includes(term) ||
        h.header.toLowerCase().includes(term) ||
        h.description.toLowerCase().includes(term),
    );
  }, [data, search]);

  async function run(action: () => Promise<unknown>, success: string) {
    try {
      await action();
      toast.success(success);
      await reload();
      return true;
    } catch (err) {
      toast.error(message(err));
      return false;
    }
  }

  if (error && !data) return <AdminError error={error} />;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Headings</CardTitle>
        <CardDescription>
          {data ? `${rows.length} of ${data.length}` : "…"} · the alias is the name in the analysis views; the
          keyword names the device column (CPU, DEV, IFACE, …), empty or None for headings without devices
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-72">
            <SearchIcon className="absolute top-2 left-2 size-4 text-muted-foreground" />
            <Input
              aria-label="Search headings"
              placeholder="Search alias, metric or description"
              className="pl-8"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <Button className="ml-auto" size="sm" variant="outline" onClick={() => setAdding(!adding)} data-testid="add-heading">
            <PlusIcon /> Add heading
          </Button>
        </div>
        {adding && (
          <HeadingForm
            initial={EMPTY}
            submitLabel="Add heading"
            onCancel={() => setAdding(false)}
            onSubmit={async (entry) => {
              if (await run(() => api.admin.addHeader(entry), `Heading ${entry.alias} added`)) {
                setAdding(false);
                setSearch(entry.alias);
              }
            }}
          />
        )}
        {!data ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <div className="max-h-[640px] overflow-auto rounded-lg border">
            <Table data-testid="heading-table">
              <TableHeader>
                <TableRow>
                  <TableHead>Alias</TableHead>
                  <TableHead>Header</TableHead>
                  <TableHead>Keyword</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="w-0 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((h) =>
                  editing === h.header ? (
                    <TableRow key={h.header}>
                      <TableCell colSpan={5} className="bg-muted/40">
                        <HeadingForm
                          initial={h}
                          submitLabel="Save"
                          onCancel={() => setEditing(null)}
                          onSubmit={async (entry) => {
                            if (await run(() => api.admin.updateHeader(h.header, entry), `Heading ${entry.alias} saved`)) {
                              setEditing(null);
                            }
                          }}
                        />
                      </TableCell>
                    </TableRow>
                  ) : (
                    <TableRow key={h.header} data-testid="heading-row" data-alias={h.alias}>
                      <TableCell className="align-top font-medium">{h.alias}</TableCell>
                      <TableCell className="max-w-md align-top font-mono text-xs whitespace-normal break-words">
                        {h.header}
                      </TableCell>
                      <TableCell className="align-top font-mono text-xs">{h.keyword}</TableCell>
                      <TableCell className="max-w-sm align-top text-sm whitespace-normal text-muted-foreground">
                        {h.description}
                      </TableCell>
                      <TableCell className="align-top">
                        <div className="flex justify-end gap-1">
                          {deleting === h.header ? (
                            <>
                              <Button
                                variant="destructive"
                                size="sm"
                                onClick={() =>
                                  void run(() => api.admin.deleteHeader(h.header), `Heading ${h.alias} deleted`).then(() =>
                                    setDeleting(null),
                                  )
                                }
                                data-testid="confirm-delete-heading"
                              >
                                Confirm
                              </Button>
                              <Button variant="ghost" size="sm" onClick={() => setDeleting(null)}>
                                Cancel
                              </Button>
                            </>
                          ) : (
                            <>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label={`Edit ${h.alias}`}
                                onClick={() => setEditing(h.header)}
                                data-testid="edit-heading"
                              >
                                <PencilIcon />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label={`Delete ${h.alias}`}
                                onClick={() => setDeleting(h.header)}
                                data-testid="delete-heading"
                              >
                                <Trash2Icon />
                              </Button>
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ),
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function HeadingForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: HeadingEntry;
  submitLabel: string;
  onSubmit: (entry: HeadingEntry) => Promise<void>;
  onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false);
  // the add form and an edit row can be open at the same time
  const id = useId();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = (name: string) => String(form.get(name) ?? "");
    setBusy(true);
    try {
      await onSubmit({
        header: value("header"),
        alias: value("alias"),
        keyword: value("keyword"),
        description: value("description"),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-3 rounded-lg border bg-background p-3 md:grid-cols-2" data-testid="heading-form">
      <div className="space-y-1.5 md:col-span-2">
        <Label htmlFor={`${id}-header`}>Header (the metric columns of the sar section)</Label>
        <Textarea
          id={`${id}-header`}
          name="header"
          required
          rows={2}
          className="font-mono text-xs"
          defaultValue={initial.header}
          placeholder="e.g. runq-sz plist-sz ldavg-1 ldavg-5 ldavg-15 blocked"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-alias`}>Alias</Label>
        <Input id={`${id}-alias`} name="alias" required maxLength={200} defaultValue={initial.alias} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-keyword`}>Keyword</Label>
        <Input id={`${id}-keyword`} name="keyword" maxLength={20} defaultValue={initial.keyword} placeholder="CPU, DEV, IFACE, None" />
      </div>
      <div className="space-y-1.5 md:col-span-2">
        <Label htmlFor={`${id}-description`}>Description</Label>
        <Textarea id={`${id}-description`} name="description" maxLength={1000} rows={3} defaultValue={initial.description} />
      </div>
      <div className="flex gap-2 md:col-span-2">
        <Button type="submit" size="sm" disabled={busy}>
          {submitLabel}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
