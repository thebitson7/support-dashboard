// Thin fetch wrapper for the API. Every failure mode (network down, timeout,
// HTTP error, non-JSON body) surfaces as a single ApiError, so callers handle
// one error type and can never be left in a stuck "loading" state.
//
// Requests go to this app's own /api routes, never to Django directly. The
// session lives in httpOnly cookies that the browser sends automatically and
// JS cannot read; the Next server attaches the real Bearer token (see
// src/lib/server/session.ts). So there are no tokens in here at all.

import { genericErrorMessage, isJsonContentType, safeServerMessage } from "@/lib/http-errors";

const API_URL = "/api";

/** A request that takes longer than this is aborted and reported as an error. */
const REQUEST_TIMEOUT_MS = 10_000;
/** File exports are built on demand and can take longer than a normal request. */
const DOWNLOAD_TIMEOUT_MS = 60_000;

/** Endpoints that must never trigger a refresh-and-retry themselves. */
const SESSION_PATHS = new Set(["/auth/login", "/auth/refresh", "/auth/logout"]);

export class ApiError extends Error {
  /** HTTP status, or 0 when the request never got a response (offline, timeout, CORS). */
  readonly status: number;
  /** From a 429's Retry-After header: seconds until trying again makes sense. */
  readonly retryAfterSeconds?: number;
  /** The parsed JSON error body, e.g. DRF's per-field errors on a 400. */
  readonly data?: unknown;

  constructor(
    status: number,
    message: string,
    options: { retryAfterSeconds?: number; data?: unknown } = {},
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.data = options.data;
  }
}

// --- Session expiry -----------------------------------------------------------

const expiredListeners = new Set<() => void>();

/** Called when the session can't be refreshed any more (the user must sign in again). */
export function onSessionExpired(listener: () => void) {
  expiredListeners.add(listener);
  return () => {
    expiredListeners.delete(listener);
  };
}

// --- Transport ----------------------------------------------------------------

/** "/working-hours/summary/?x=1" -> "/working-hours/summary?x=1" (Next routes have no trailing slash). */
function normalize(path: string): string {
  return path.replace(/\/(?=\?|#|$)/, "");
}

/** One HTTP round trip with the timeout applied; network failures become ApiError(0). */
async function send(
  path: string,
  init: RequestInit,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${API_URL}${normalize(path)}`, {
      ...init,
      credentials: "same-origin",
      // FormData sets its own multipart Content-Type (with the boundary).
      headers:
        init.body instanceof FormData
          ? init.headers
          : { "Content-Type": "application/json", ...init.headers },
      // A caller-supplied signal can cancel too; the timeout always applies.
      signal: init.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal,
    });
  } catch (error) {
    const timedOut = controller.signal.aborted;
    // A caller cancelling (e.g. a newer search) isn't worth a message anyone sees.
    const cancelled = !timedOut && error instanceof DOMException && error.name === "AbortError";
    throw new ApiError(
      0,
      timedOut
        ? `The server took too long to respond (over ${timeoutMs / 1000}s). Try again.`
        : cancelled
          ? "Request cancelled."
          : genericErrorMessage(0),
    );
  } finally {
    clearTimeout(timer);
  }
}

// --- Refresh (single flight) --------------------------------------------------
// When several requests fail with 401 at once, exactly one refresh runs; the
// others wait for it and then retry. `generation` also catches the straggler
// whose 401 arrives just *after* a refresh finished: it was sent with the old
// cookie, so it simply retries instead of refreshing a second time.

/**
 * "ended" only when the refresh token itself is refused (401): the session is
 * really over. A server or network failure is "unavailable": the session may
 * be fine, so nobody is signed out over a blip.
 */
type RefreshOutcome = "renewed" | "ended" | "unavailable";

let refreshing: Promise<RefreshOutcome> | null = null;
let generation = 0;

function refreshSession(): Promise<RefreshOutcome> {
  refreshing ??= send("/auth/refresh", { method: "POST" })
    .then(
      (res): RefreshOutcome => {
        if (res.ok) {
          generation += 1;
          return "renewed";
        }
        return res.status === 401 ? "ended" : "unavailable";
      },
      (): RefreshOutcome => "unavailable",
    )
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

function parseJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

/**
 * The message for a failed response. Only the API's own JSON {"detail": "…"}
 * sentence is ever shown, and only if it's short plain text; anything else (an
 * HTML error page, a proxy's 502, a traceback, per-field errors) gets a
 * generic line for its status. The raw body is never used as a message.
 */
function errorMessage(data: unknown, status: number): string {
  if (data && typeof data === "object" && "detail" in data) {
    return safeServerMessage((data as { detail: unknown }).detail, status);
  }
  return genericErrorMessage(status);
}

/**
 * One request with the session handling every call shares: an expired access
 * cookie is refreshed once and the request retried; any non-2xx then becomes
 * an ApiError. Returns the (successful) response unread.
 */
async function request(
  path: string,
  init: RequestInit,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const sentAt = generation;
  let res = await send(path, init, timeoutMs);

  // Access cookie expired: refresh once (shared) and retry. If the refresh
  // itself is refused the session is over; if the server couldn't be asked,
  // this request fails as "unavailable" and the session is left alone.
  if (res.status === 401 && !SESSION_PATHS.has(normalize(path))) {
    const outcome = sentAt !== generation ? "renewed" : await refreshSession();
    if (outcome === "renewed") {
      res = await send(path, init, timeoutMs);
    } else if (outcome === "ended") {
      expiredListeners.forEach((listener) => listener());
    } else {
      throw new ApiError(503, genericErrorMessage(503));
    }
  }

  if (!res.ok) {
    // Only a JSON body is read at all; an HTML page (e.g. Django's debug
    // traceback) is discarded unread, so its content can't reach any UI.
    const json = isJsonContentType(res.headers.get("content-type"));
    const data = json ? parseJson(await res.text().catch(() => "")) : undefined;
    const retryAfter = Number(res.headers.get("retry-after"));
    throw new ApiError(res.status, errorMessage(data, res.status), {
      retryAfterSeconds: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
      data,
    });
  }
  return res;
}

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await request(path, init);

  // No body to parse (204 No Content / empty 2xx). Callers of such endpoints
  // request `apiFetch<void>`, so `undefined` is the honest value.
  if (res.status === 204 || res.headers.get("content-length") === "0") {
    return undefined as T;
  }

  try {
    // The response shape is the caller's contract; runtime validation would
    // belong to a schema layer (e.g. zod) once real endpoints exist.
    return (await res.json()) as T;
  } catch {
    throw new ApiError(res.status, "The server returned an unexpected response.");
  }
}

export function apiGet<T>(path: string, init?: { signal?: AbortSignal }): Promise<T> {
  return apiFetch<T>(path, { ...init, method: "GET" });
}

const encodeBody = (body: unknown) =>
  body instanceof FormData ? body : body !== undefined ? JSON.stringify(body) : undefined;

/** JSON body, or a FormData body sent as multipart (for file uploads). */
export function apiPost<T>(path: string, body?: unknown): Promise<T> {
  return apiFetch<T>(path, { method: "POST", body: encodeBody(body) });
}

/** Partial update; same body rules as apiPost. */
export function apiPatch<T>(path: string, body?: unknown): Promise<T> {
  return apiFetch<T>(path, { method: "PATCH", body: encodeBody(body) });
}

export function apiDelete(path: string): Promise<void> {
  return apiFetch<void>(path, { method: "DELETE" });
}

/**
 * GETs a file (e.g. a CSV export) and hands it to the browser as a download,
 * named by the server's Content-Disposition, else `fallbackName`. It goes
 * through the same session refresh as every other call, which a plain link
 * couldn't: with an expired access cookie a link would download the 401
 * error instead of the file.
 */
export async function apiDownload(path: string, fallbackName: string): Promise<void> {
  const res = await request(path, { method: "GET" }, DOWNLOAD_TIMEOUT_MS);
  const blob = await res.blob();
  const named = /filename="?([^";]+)"?/i.exec(res.headers.get("content-disposition") ?? "");
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = named?.[1] ?? fallbackName;
  document.body.append(link);
  link.click();
  link.remove();
  // Revoked on the next tick, once the click has started the download.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
