"use client";

import { RotateCcwIcon, SaveIcon } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { AdminError } from "@/components/admin/admin-error";
import { message, useAdminData } from "@/components/admin/use-admin-data";
import { PageTitle } from "@/components/analyze/file-picker";
import { refreshInfo } from "@/components/help-note";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { api, type Setting } from "@/lib/api";

type Values = Record<string, string | number | boolean | null>;

const GROUPS: { title: string; description: string; fields: Record<string, [string, string]> }[] = [
  {
    title: "Contact",
    description: "Shown on the login and signup pages, in Info and in the help of the Streamlit app",
    fields: {
      admin_email: ["Admin e-mail", "Whom users ask for a password reset or in case of an error"],
      admin_communication: ["Chat", "e.g. slack – \"ping on …\" in the FAQ"],
    },
  },
  {
    title: "Analysis views",
    description: "Limits of the analysis pages",
    fields: {
      max_header_count: ["Metrics in Compare Metrics", "How many heading/device/metric combinations one chart can hold"],
      cols_per_line: ["Select boxes per line", "Layout of the metric selection in the Streamlit app"],
    },
  },
  {
    title: "Redis",
    description: "Optional cache of the analyzer; a changed connection is used with the next access",
    fields: {
      redis_enabled: ["Use Redis", "Off: the analyzer caches on disk only"],
      redis_host: ["Host", ""],
      redis_port: ["Port", ""],
      redis_user: ["User", "Empty: no ACL user"],
      redis_password: ["Password", "Never shown; type a new one to replace it"],
    },
  },
];

const loadSettings = api.admin.settings;

// The runtime-editable values of sarfile_analyzer_ng's config.py. Stored
// values win over the environment variables; Reset goes back to them.
export function Settings() {
  const { data, error, reload } = useAdminData(loadSettings);
  const [busy, setBusy] = useState(false);

  async function save(values: Values, success: string) {
    setBusy(true);
    try {
      await api.admin.updateSettings(values);
      refreshInfo();
      toast.success(success);
      await reload();
    } catch (err) {
      toast.error(message(err));
    } finally {
      setBusy(false);
    }
  }

  if (error && !data) return <AdminError error={error} />;

  const byName = Object.fromEntries((data ?? []).map((s) => [s.name, s]));
  return (
    <div className="space-y-6">
      <PageTitle
        title="Settings"
        description="Values of config.py – they apply to the web frontend and the Streamlit app without a restart"
      />
      {!data ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <div className="grid gap-6 xl:grid-cols-2">
          {GROUPS.map((group) => (
            <SettingsGroup
              // re-mounted (fresh form state) when one of its own values changed
              key={group.title + Object.keys(group.fields).map((n) => `${byName[n]?.source}${byName[n]?.value}`).join()}
              title={group.title}
              description={group.description}
              fields={group.fields}
              settings={byName}
              busy={busy}
              onSave={save}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SettingsGroup({
  title,
  description,
  fields,
  settings,
  busy,
  onSave,
}: {
  title: string;
  description: string;
  fields: Record<string, [string, string]>;
  settings: Record<string, Setting>;
  busy: boolean;
  onSave: (values: Values, success: string) => Promise<void>;
}) {
  const names = Object.keys(fields).filter((name) => settings[name]);
  // the form state starts from the current values (the parent re-mounts the
  // group after a save); a secret starts empty = unchanged
  const [draft, setDraft] = useState<Record<string, string | boolean>>(() =>
    Object.fromEntries(
      names.map((name) => {
        const s = settings[name];
        return [name, s.secret ? "" : s.type === "bool" ? Boolean(s.value) : String(s.value)];
      }),
    ),
  );

  const changes: Values = {};
  for (const name of names) {
    const s = settings[name];
    const value = draft[name];
    if (s.secret) {
      if (value !== "") changes[name] = value;
    } else if (s.type === "bool") {
      if (value !== s.value) changes[name] = value;
    } else if (String(value) !== String(s.value)) {
      changes[name] = s.type === "int" ? Number(value) : value;
    }
  }
  const dirty = Object.keys(changes).length > 0;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void onSave(changes, `${title} saved`);
  }

  return (
    <Card data-testid="settings-group" data-group={title}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4">
          {names.map((name) => {
            const s = settings[name];
            const [label, hint] = fields[name];
            const id = `setting-${name}`;
            return (
              <div key={name} className="space-y-1.5" data-testid="setting" data-setting={name}>
                <div className="flex flex-wrap items-center gap-2">
                  <Label htmlFor={id}>{label}</Label>
                  <Source setting={s} />
                  {s.source === "admin" && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      disabled={busy}
                      onClick={() => void onSave({ [name]: null }, `${label}: back to ${s.env_var}`)}
                      title={`Remove the stored value; ${s.env_var} or the default applies again`}
                    >
                      <RotateCcwIcon /> Reset
                    </Button>
                  )}
                </div>
                {s.type === "bool" ? (
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      id={id}
                      type="checkbox"
                      checked={Boolean(draft[name])}
                      onChange={(event) => setDraft({ ...draft, [name]: event.target.checked })}
                    />
                    {hint}
                  </label>
                ) : (
                  <>
                    <Input
                      id={id}
                      className="max-w-sm"
                      type={s.secret ? "password" : s.type === "int" ? "number" : name === "admin_email" ? "email" : "text"}
                      min={s.type === "int" ? (s.min ?? undefined) : undefined}
                      max={s.type === "int" ? (s.max ?? undefined) : undefined}
                      maxLength={s.type === "str" ? (s.max ?? undefined) : undefined}
                      required={s.type === "int" || (s.type === "str" && (s.min ?? 0) > 0)}
                      autoComplete={s.secret ? "new-password" : "off"}
                      placeholder={s.secret ? (s.value ? "•••••• (set)" : "not set") : undefined}
                      value={String(draft[name])}
                      onChange={(event) => setDraft({ ...draft, [name]: event.target.value })}
                    />
                    {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
                  </>
                )}
              </div>
            );
          })}
          <Button type="submit" size="sm" disabled={!dirty || busy}>
            <SaveIcon /> Save
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function Source({ setting }: { setting: Setting }) {
  if (setting.source === "admin") return <Badge>set here</Badge>;
  if (setting.source === "environment")
    return (
      <Badge variant="secondary" title="Environment variable">
        {setting.env_var}
      </Badge>
    );
  return <Badge variant="outline">default</Badge>;
}
