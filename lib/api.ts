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

function query(params: Record<string, string | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }
  return search.toString();
}
