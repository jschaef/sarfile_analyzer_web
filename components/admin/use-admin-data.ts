"use client";

import { useCallback, useEffect, useState } from "react";

// Data of an admin page that is reloaded after every change. `load` must be
// stable (the module-level functions of api.admin are).
export function useAdminData<T>(load: () => Promise<T>) {
  const [state, setState] = useState<{ data: T | null; error: unknown }>({ data: null, error: null });
  const reload = useCallback(async () => {
    try {
      setState({ data: await load(), error: null });
    } catch (error) {
      setState((current) => ({ data: current.data, error }));
    }
  }, [load]);
  useEffect(() => {
    // initial load; state updates happen after the request resolves
    void reload();
  }, [reload]);
  return { ...state, reload };
}

export function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
