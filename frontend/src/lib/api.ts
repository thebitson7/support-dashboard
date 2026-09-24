// Thin fetch wrapper for the Django API. Every failure mode (network down,
// timeout, HTTP error, non-JSON body) surfaces as a single ApiError, so callers
// handle one error type and can never be left in a stuck "loading" state.

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api";

/** A request that takes longer than this is aborted and reported as an error. */
const REQUEST_TIMEOUT_MS = 10_000;

export class ApiError extends Error {
  /** HTTP status, or 0 when the request never got a response (offline, timeout, CORS). */
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...init.headers },
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

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new ApiError(res.status, detail || res.statusText);
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

export function apiGet<T>(path: string): Promise<T> {
  return apiFetch<T>(path, { method: "GET" });
}

export function apiPost<T>(path: string, body?: unknown): Promise<T> {
  return apiFetch<T>(path, {
    method: "POST",
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}
