"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type { AttentionResponse } from "@/types/attention";
import { ApiError, apiGet } from "@/lib/api";

export const ATTENTION_PATH = "/tickets/attention/";
/** Re-checked this often while the tab is visible. */
export const POLL_MS = 5 * 60 * 1000;

type UrgentTickets = {
  data: AttentionResponse | undefined;
  /** True until the first response (or failure). */
  isLoading: boolean;
  /** Only while there's no data to show: a failed refresh keeps the last good data instead. */
  error: ApiError | undefined;
  /** Re-fetch now (after a ticket is created, edited or closed; or "Try again"). */
  refresh: () => void;
};

const UrgentTicketsContext = createContext<UrgentTickets | null>(null);

/**
 * One GET /tickets/attention/ for the whole signed-in app: the sign-in
 * alert, the Home "Needs closing" box and the sidebar badge all read it.
 * Mounted inside the signed-in shell only (never on /login), keyed by the
 * user so a new sign-in starts clean.
 *
 * Refreshes every 5 minutes while the tab is visible, when the tab becomes
 * visible again, and on refresh(). A failure never blocks anything: before
 * the first success it is exposed as `error` (the Home box shows a retry),
 * after it the last good data simply stays.
 */
export function UrgentTicketsProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<AttentionResponse>();
  const [error, setError] = useState<ApiError>();
  const [isLoading, setIsLoading] = useState(true);
  const hasData = useRef(false);
  const inFlight = useRef<AbortController | null>(null);
  const mounted = useRef(true);

  const refresh = useCallback(() => {
    // A newer request supersedes one still running (e.g. save right after a poll).
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    apiGet<AttentionResponse>(ATTENTION_PATH, { signal: controller.signal }).then(
      (next) => {
        if (controller.signal.aborted || !mounted.current) return;
        if (!next || typeof next !== "object" || !next.counts || !Array.isArray(next.results)) {
          // A 2xx with an unexpected body: treat as a failure, never render it.
          if (!hasData.current)
            setError(new ApiError(0, "The server returned an unexpected response."));
        } else {
          hasData.current = true;
          setData(next);
          setError(undefined);
        }
        setIsLoading(false);
      },
      (err: unknown) => {
        if (controller.signal.aborted || !mounted.current) return;
        if (!hasData.current) {
          setError(err instanceof ApiError ? err : new ApiError(0, "Unexpected error"));
        }
        setIsLoading(false);
      },
    );
  }, []);

  useEffect(() => {
    mounted.current = true;
    refresh();
    const visible = () => document.visibilityState === "visible";
    const timer = setInterval(() => {
      if (visible()) refresh();
    }, POLL_MS);
    const onVisibility = () => {
      if (visible()) refresh();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      mounted.current = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      inFlight.current?.abort();
    };
  }, [refresh]);

  const value = useMemo(
    () => ({ data, isLoading, error, refresh }),
    [data, isLoading, error, refresh],
  );
  return <UrgentTicketsContext.Provider value={value}>{children}</UrgentTicketsContext.Provider>;
}

const OUTSIDE: UrgentTickets = {
  data: undefined,
  isLoading: false,
  error: undefined,
  refresh: () => {},
};

/**
 * The shared attention data. Outside the provider (e.g. a component rendered
 * on its own in a test, or the read-only Reports table) it is an inert empty
 * value rather than an error, so nothing ever breaks over this feature.
 */
export function useUrgentTickets(): UrgentTickets {
  return useContext(UrgentTicketsContext) ?? OUTSIDE;
}
