"use client";

import { useCallback, useEffect, useState } from "react";

import { ApiError, apiGet } from "@/lib/api";

type Settled<T> = {
  path: string;
  key: string;
  data?: T;
  error?: ApiError;
  /** When the response arrived. */
  at: Date;
};

/**
 * GETs `path` and re-fetches whenever it changes (pass null to skip). A newer
 * request aborts the previous one, and results are tagged with the request
 * they answer, so a slow earlier response can never be shown for a later
 * path (e.g. the previous user's numbers after switching users).
 *
 * `retry()` re-fetches the same path; if data is already on screen it stays
 * there (`isRefreshing`) instead of flashing back to a skeleton. With
 * `keepPreviousData`, that also holds across paths (e.g. paging a table):
 * the old rows stay visible, flagged as `isRefreshing`, until the new ones land.
 */
export function useApiGet<T>(path: string | null, options: { keepPreviousData?: boolean } = {}) {
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState<Settled<T> | null>(null);
  const key = `${path}#${attempt}`;

  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    apiGet<T>(path, { signal: controller.signal }).then(
      (data) => {
        if (!controller.signal.aborted) setSettled({ path, key, data, at: new Date() });
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        setSettled({
          path,
          key,
          error: error instanceof ApiError ? error : new ApiError(0, "Unexpected error"),
          at: new Date(),
        });
      },
    );
    return () => controller.abort();
  }, [path, key]);

  const current = settled?.key === key ? settled : null;
  // Older data kept on screen while the new request is in flight: same path
  // only, unless the caller opted into keeping it across paths.
  const previous =
    !current && settled?.data !== undefined && (settled.path === path || options.keepPreviousData)
      ? settled
      : null;
  const shown = current ?? previous;
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return {
    data: shown?.data,
    error: current?.error,
    fetchedAt: shown?.at,
    isLoading: path !== null && shown === null,
    isRefreshing: previous !== null,
    retry,
  };
}
