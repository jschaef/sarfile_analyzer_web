"use client";

import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import type { SarFile } from "@/lib/api";

export const SELECT_CLASS =
  "h-8 rounded-lg border border-input bg-background px-2 text-sm disabled:opacity-50 dark:bg-input/30";

export function FilePicker({
  files,
  value,
  onChange,
}: {
  files: SarFile[] | null;
  value: string | null;
  onChange: (name: string) => void;
}) {
  return (
    <div className="flex min-w-72 flex-col gap-1.5">
      <Label htmlFor="file-select">SAR file</Label>
      <select
        id="file-select"
        data-testid="file-select"
        className={SELECT_CLASS}
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value)}
        disabled={!files}
      >
        {files?.map((file) => (
          <option key={file.name} value={file.name}>
            {file.name}
          </option>
        ))}
      </select>
    </div>
  );
}

export function NoFiles() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>No SAR files yet</CardTitle>
        <CardDescription>Upload a file first, then come back here.</CardDescription>
      </CardHeader>
      <CardContent>
        <Link href="/files" className={buttonVariants()}>
          Manage SAR Files
        </Link>
      </CardContent>
    </Card>
  );
}

export function PageTitle({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </div>
  );
}
