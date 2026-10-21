// Browser-side client for sar-web-api (backend/). All calls are same-origin:
// /api/v2/* is rewritten to the API and proxy.ts attaches the bearer token.

export type SarFile = {
  name: string;
  size_bytes: number;
  host: string | null;
  sar_date: string | null;
  uploaded: string | null;
};

export type HeaderInfo = { header: string; alias: string; metrics: string[]; has_devices: boolean };

export type Restart = { time: number; iso: string; raw: string };

export type FileInfo = {
  name: string;
  os_details: string;
  host: string | null;
  cpu_count: number | null;
  start: string;
  end: string;
  restarts: Restart[];
  // every sample time of the file, epoch ms (sar wall-clock time as UTC)
  timestamps: number[];
  headers: HeaderInfo[];
};

export type HeaderDetails = {
  header: string;
  alias: string;
  metrics: string[];
  devices: string[];
  device_count: number;
  cpu_like: boolean;
  overview_devices: (string | null)[];
  start: string;
  end: string;
  timestamps: number[];
};

export type ThresholdResponse = {
  header: string;
  alias: string;
  metric: string;
  value_min: number | null;
  value_max: number | null;
  start: string;
  end: string;
  // only with min/max:
  matches?: number;
  rows_returned?: number;
  devices?: { device: string; count: number; first: number; last: number; peak: number }[];
  rows?: { time: number; device: string; value: number }[];
};

export type DeviceSeries = {
  device: string | null;
  rows: number;
  returned: number;
  sampled: boolean;
  duplicates: number;
  x: number[];
  values: Record<string, (number | null)[]>;
};

export type SeriesResponse = {
  file: string;
  header: string;
  alias: string;
  metrics: string[];
  devices: string[];
  device_count: number;
  cpu_like: boolean;
  series: DeviceSeries[];
};

export type StatisticsResponse = {
  header: string;
  alias: string;
  series: { device: string | null; statistics: Record<string, Record<string, number | null>> }[];
};

export type UploadResult = {
  uploaded: { name: string; rows: number; headers: number; warnings: string[] }[];
  errors: { file: string; detail: string }[];
};

export type Info = {
  admin_email: string;
  admin_communication: string;
  code_url: string;
  web_code_url: string;
  signup: boolean;
};

export type UserEntry = { username: string; role: string };

export type UsersResponse = {
  users: UserEntry[];
  roles: string[];
  login_count: number;
  login_count_excludes: string;
};

export type LoginRecord = { username: string; time: string; success: boolean };

export type MetricEntry = { metric: string; description: string };

export type HeadingEntry = { header: string; alias: string; keyword: string; description: string };

export type RedisKey = { key: string; type: string; fields: string[] };

export type RedisResponse = { enabled: boolean; reachable: boolean; keys: RedisKey[]; truncated?: boolean };

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function handleUnauthorized() {
  await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
  const next = encodeURIComponent(window.location.pathname + window.location.search);
  // full reload on purpose: drops all client state of the expired session
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.assign(`/login?next=${next}`);
}

async function parse<T>(response: Response): Promise<T> {
  if (response.status === 401) {
    await handleUnauthorized();
    throw new ApiError("Session expired", 401);
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail =
      typeof body?.detail === "string" ? body.detail : `Request failed (${response.status})`;
    throw new ApiError(detail, response.status);
  }
  return body as T;
}

function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  return fetch(`/api/v2${path}`, { signal, cache: "no-store" }).then((r) => parse<T>(r));
}

// state-changing calls; a JSON body makes cross-site requests need a CORS
// preflight, which is never served
function send<T>(method: "POST" | "PUT" | "DELETE", path: string, body?: unknown): Promise<T> {
  return fetch(`/api/v2${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then((r) => parse<T>(r));
}

const enc = encodeURIComponent;

type RangeParams = { header: string; devices?: string; start?: string; end?: string };

type ThresholdParams = {
  header: string;
  metric: string;
  min?: string;
  max?: string;
  start?: string;
  end?: string;
  limit?: string;
};

export const api = {
  me: () => get<{ username: string; role: string }>("/users/me"),
  info: () => get<Info>("/info"),
  changeOwnPassword: (current_password: string, new_password: string) =>
    send<{ changed: boolean }>("PUT", "/users/me/password", { current_password, new_password }),
  admin: {
    users: () => get<UsersResponse>("/admin/users"),
    setRole: (username: string, role: string) => send("PUT", `/admin/users/${enc(username)}/role`, { role }),
    setPassword: (username: string, password: string) =>
      send("PUT", `/admin/users/${enc(username)}/password`, { password }),
    deleteUser: (username: string) =>
      send<{ deleted: string; files_removed: boolean }>("DELETE", `/admin/users/${enc(username)}`),
    logins: (limit = 5000) => get<{ total: number; logins: LoginRecord[] }>(`/admin/logins?limit=${limit}`),
    deleteLogins: (before: string) =>
      send<{ deleted: number; remaining: number }>("DELETE", `/admin/logins?${query({ before })}`),
    metrics: () => get<{ metrics: MetricEntry[] }>("/admin/metrics").then((r) => r.metrics),
    addMetric: (entry: MetricEntry) => send("POST", "/admin/metrics", entry),
    deleteMetrics: (metrics: string[]) =>
      send<{ deleted: string[] }>("DELETE", `/admin/metrics?${repeated("metric", metrics)}`),
    headers: () => get<{ headers: HeadingEntry[] }>("/admin/headers").then((r) => r.headers),
    addHeader: (entry: HeadingEntry) => send("POST", "/admin/headers", entry),
    updateHeader: (original_header: string, entry: HeadingEntry) =>
      send("PUT", "/admin/headers", { ...entry, original_header }),
    deleteHeader: (header: string) => send("DELETE", `/admin/headers?${query({ header })}`),
    redis: () => get<RedisResponse>("/admin/redis"),
    deleteRedisFields: (key: string, fields: string[]) =>
      send<{ deleted: number }>("DELETE", `/admin/redis/fields?${query({ key })}&${repeated("field", fields)}`),
  },
  listFiles: () => get<{ files: SarFile[] }>("/files").then((r) => r.files),
  fileInfo: (name: string, signal?: AbortSignal) => get<FileInfo>(`/files/${enc(name)}`, signal),
  header: (name: string, header: string, signal?: AbortSignal) =>
    get<HeaderDetails>(`/files/${enc(name)}/header?${query({ header })}`, signal),
  // devices omitted: what the Graphical Overview shows (one request per alias)
  series: (
    name: string,
    params: RangeParams & { metrics?: string; max_points?: string },
    signal?: AbortSignal,
  ) =>
    get<SeriesResponse>(`/files/${enc(name)}/series?${query(params)}`, signal),
  threshold: (name: string, params: ThresholdParams, signal?: AbortSignal) =>
    get<ThresholdResponse>(`/files/${enc(name)}/threshold?${query(params)}`, signal),
  statistics: (name: string, params: RangeParams, signal?: AbortSignal) =>
    get<StatisticsResponse>(`/files/${enc(name)}/statistics?${query(params)}`, signal),
  metrics: () => get<{ metrics: Record<string, string> }>("/metrics").then((r) => r.metrics),
  deleteFile: (name: string) =>
    fetch(`/api/v2/files/${enc(name)}`, { method: "DELETE" }).then((r) =>
      parse<{ deleted: string }>(r),
    ),
  // XMLHttpRequest instead of fetch: fetch has no upload progress events,
  // and SAR files are often >100 MB.
  upload: (files: File[], onProgress?: (fraction: number) => void) =>
    new Promise<UploadResult>((resolve, reject) => {
      const form = new FormData();
      for (const file of files) form.append("files", file, file.name);
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/upload");
      xhr.responseType = "json";
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress?.(event.loaded / event.total);
      };
      xhr.onerror = () => reject(new ApiError("Upload failed - network error", 0));
      xhr.onload = () => {
        const body = xhr.response;
        if (xhr.status === 401) {
          void handleUnauthorized();
          reject(new ApiError("Session expired", 401));
        } else if (body && Array.isArray(body.errors)) {
          // a batch where every file failed comes back as 400 with the same shape
          resolve(body as UploadResult);
        } else {
          reject(new ApiError(body?.detail ?? `Upload failed (${xhr.status})`, xhr.status));
        }
      };
      xhr.send(form);
    }),
};

function repeated(name: string, values: string[]): string {
  const search = new URLSearchParams();
  for (const value of values) search.append(name, value);
  return search.toString();
}

function query(params: Record<string, string | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }
  return search.toString();
}
