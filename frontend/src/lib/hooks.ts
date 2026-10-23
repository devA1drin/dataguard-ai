"use client";
import { useCallback, useEffect, useState } from "react";

/** Minimal data-fetching hook: runs `fn` on mount / when deps change; exposes reload(). */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(fn, deps);
  const reload = useCallback(async () => {
    setLoading(true);
    try { setData(await run()); setError(null); } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  }, [run]);
  useEffect(() => { void reload(); }, [reload]);
  return { data, error, loading, reload, setData };
}
