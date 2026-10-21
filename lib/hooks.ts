"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { api, type FileInfo, type SarFile } from "@/lib/api";

// Files of the logged-in user (null while loading).
export function useSarFiles() {
  const [files, setFiles] = useState<SarFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api
      .listFiles()
      .then(setFiles)
      .catch((e: Error) => setError(e.message));
  }, []);
  return { files, error };
}

// The file the analysis views work on: ?file=..., else the first file. The
// query parameter keeps the choice when switching between the views.
export function useSelectedFile() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { files, error } = useSarFiles();
  const fileName = searchParams.get("file") ?? files?.[0]?.name ?? null;

  function select(name: string) {
    router.replace(`${pathname}?file=${encodeURIComponent(name)}`);
  }

  return { files, fileName, select, error };
}

export function useFileInfo(name: string | null) {
  const [info, setInfo] = useState<FileInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!name) return;
    const controller = new AbortController();
    api
      .fileInfo(name, controller.signal)
      .then((result) => {
        setInfo(result);
        setError(null);
      })
      .catch((e: Error) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => controller.abort();
  }, [name]);
  // stale info of the previously selected file is never handed out
  return { info: info && info.name === name ? info : null, error };
}

// Metric descriptions ("man pages") are the same for every file: fetched once.
let descriptionsRequest: Promise<Record<string, string>> | null = null;

export function useMetricDescriptions(): Record<string, string> {
  const [descriptions, setDescriptions] = useState<Record<string, string>>({});
  useEffect(() => {
    descriptionsRequest ??= api.metrics().catch(() => {
      descriptionsRequest = null;
      return {};
    });
    let active = true;
    void descriptionsRequest.then((result) => {
      if (active) setDescriptions(result);
    });
    return () => {
      active = false;
    };
  }, []);
  return descriptions;
}

// One request with abort on change/unmount. `load` null = nothing to load
// yet. `deps` (JSON-serialisable) say when to load again; while a new
// request runs, data is null and loading is true.
export function useRequest<T>(
  load: ((signal: AbortSignal) => Promise<T>) | null,
  deps: readonly unknown[],
): { data: T | null; error: string | null; loading: boolean } {
  const key = load ? JSON.stringify(deps) : null;
  const [state, setState] = useState<{ key: string | null; data: T | null; error: string | null }>({
    key: null,
    data: null,
    error: null,
  });
  useEffect(() => {
    if (!load || key === null) return;
    const controller = new AbortController();
    load(controller.signal)
      .then((data) => setState({ key, data, error: null }))
      .catch((e: Error) => {
        if (e.name !== "AbortError") setState({ key, data: null, error: e.message });
      });
    return () => controller.abort();
    // `load` is a fresh closure on every render; `key` captures what it uses
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (key === null) return { data: null, error: null, loading: false };
  const fresh = state.key === key;
  return { data: fresh ? state.data : null, error: fresh ? state.error : null, loading: !fresh };
}
