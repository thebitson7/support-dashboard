// Server-side only (Route Handlers and proxy.ts). Owns the JWT cookies: the
// browser holds them as httpOnly cookies it can send but never read, and this
// layer turns them into `Authorization: Bearer` headers for Django.

import { NextResponse, type NextRequest } from "next/server";

/** Django is only ever called server-side, so its URL is not public config. */
export const DJANGO_API_URL = process.env.DJANGO_API_URL ?? "http://127.0.0.1:8000/api";

export const ACCESS_COOKIE = "sd_access";
export const REFRESH_COOKIE = "sd_refresh";

const UPSTREAM_TIMEOUT_MS = 10_000;

export type Tokens = { access: string; refresh?: string };

/**
 * Reads a JWT's `exp` (seconds since epoch) WITHOUT verifying its signature.
 * Good enough to size cookies and for proxy.ts's optimistic check; Django
 * verifies every token for real on every API call.
 */
export function tokenExpiry(token: string | undefined): number | null {
  const payload = token?.split(".")[1];
  if (!payload) return null;
  try {
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const exp: unknown = JSON.parse(json).exp;
    return typeof exp === "number" ? exp : null;
  } catch {
    return null;
  }
}

/** True while the refresh cookie holds an unexpired token (optimistic; not verified). */
export function hasSession(request: NextRequest): boolean {
  const exp = tokenExpiry(request.cookies.get(REFRESH_COOKIE)?.value);
  return exp !== null && exp * 1000 > Date.now();
}

function cookieOptions(token: string) {
  const exp = tokenExpiry(token);
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    // The cookie dies with its token, so a stale cookie is never sent.
    ...(exp ? { expires: new Date(exp * 1000) } : {}),
  };
}

export function setSessionCookies(response: NextResponse, tokens: Tokens) {
  response.cookies.set(ACCESS_COOKIE, tokens.access, cookieOptions(tokens.access));
  if (tokens.refresh) {
    response.cookies.set(REFRESH_COOKIE, tokens.refresh, cookieOptions(tokens.refresh));
  }
}

export function clearSessionCookies(response: NextResponse) {
  response.cookies.delete({ name: ACCESS_COOKIE, path: "/" });
  response.cookies.delete({ name: REFRESH_COOKIE, path: "/" });
}

/**
 * CSRF defence for cookie-authenticated, state-changing requests. SameSite=Lax
 * already withholds the cookies from cross-site POSTs; this also refuses any
 * request a browser labels as coming from another origin.
 */
export function isCrossOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin) return true;
  return request.headers.get("sec-fetch-site") === "cross-site";
}

/** A fetch to Django with a timeout; network failures resolve to a 502 Response. */
export async function callDjango(
  path: string,
  init: RequestInit & { access?: string; forwardedFor?: string | null } = {},
): Promise<Response> {
  const { access, forwardedFor, headers, ...rest } = init;
  try {
    return await fetch(`${DJANGO_API_URL}${path}`, {
      ...rest,
      cache: "no-store",
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      headers: {
        Accept: "application/json",
        ...(rest.body ? { "Content-Type": "application/json" } : {}),
        ...(access ? { Authorization: `Bearer ${access}` } : {}),
        // Lets Django rate-limit per browser IP rather than per proxy.
        ...(forwardedFor ? { "X-Forwarded-For": forwardedFor } : {}),
        ...headers,
      },
    });
  } catch {
    return Response.json({ detail: "The API server is unreachable." }, { status: 502 });
  }
}

/** Relays Django's status, JSON body and Retry-After to the browser, nothing else. */
export async function relay(upstream: Response): Promise<NextResponse> {
  const body = upstream.status === 204 ? null : await upstream.text();
  const headers = new Headers();
  const contentType = upstream.headers.get("content-type");
  if (contentType) headers.set("Content-Type", contentType);
  const retryAfter = upstream.headers.get("retry-after");
  if (retryAfter) headers.set("Retry-After", retryAfter);
  headers.set("Cache-Control", "no-store");
  return new NextResponse(body, { status: upstream.status, headers });
}

export function jsonError(status: number, detail: string) {
  return NextResponse.json({ detail }, { status, headers: { "Cache-Control": "no-store" } });
}
