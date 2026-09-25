// Thin fetch wrapper for the API. Every failure mode (network down, timeout,
// HTTP error, non-JSON body) surfaces as a single ApiError, so callers handle
// one error type and can never be left in a stuck "loading" state.
//
// Requests go to this app's own /api routes, never to Django directly. The
// session lives in httpOnly cookies that the browser sends automatically and
// JS cannot read; the Next server attaches the real Bearer token (see
// src/lib/server/session.ts). So there are no tokens in here at all.

const API_URL = "/api";

/** A request that takes longer than this is aborted and reported as an error. */
const REQUEST_TIMEOUT_MS = 10_000;

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
async function send(path: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
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
    throw new ApiError(
      0,
      timedOut
        ? `Request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`
        : error instanceof Error
          ? error.message
          : "Network error",
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

let refreshing: Promise<boolean> | null = null;
let generation = 0;

function refreshSession(): Promise<boolean> {
  refreshing ??= send("/auth/refresh", { method: "POST" })
    .then(
      (res) => {
        if (res.ok) generation += 1;
        return res.ok;
      },
      () => false,
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

/** DRF errors are JSON like {"detail": "..."}; surface that sentence when present. */
function errorMessage(body: string, data: unknown, fallback: string): string {
  if (data && typeof data === "object" && "detail" in data) {
    const { detail } = data as { detail: unknown };
    if (typeof detail === "string") return detail;
  }
  return body || fallback;
}

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const sentAt = generation;
  let res = await send(path, init);

  // Access cookie expired: refresh once (shared) and retry. If the refresh
  // itself is refused the session is over.
  if (res.status === 401 && !SESSION_PATHS.has(normalize(path))) {
    const renewed = sentAt !== generation || (await refreshSession());
    if (renewed) {
      res = await send(path, init);
    } else {
      expiredListeners.forEach((listener) => listener());
    }
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const data = parseJson(body);
    const retryAfter = Number(res.headers.get("retry-after"));
    throw new ApiError(res.status, errorMessage(body, data, res.statusText), {
      retryAfterSeconds: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
      data,
    });
  }

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
    throw new ApiError(res.status, "The server returned a response that is not valid JSON");
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
