import { NextResponse, type NextRequest } from "next/server";

import {
  REFRESH_COOKIE,
  callDjango,
  clearSessionCookies,
  isCrossOrigin,
  jsonError,
  setSessionCookies,
  type Tokens,
} from "@/lib/server/session";

/** Swaps the refresh cookie for a new access cookie. 401 (and cookies cleared) when the session is over. */
export async function POST(request: NextRequest) {
  if (isCrossOrigin(request)) return jsonError(403, "Cross-origin request refused.");

  const refresh = request.cookies.get(REFRESH_COOKIE)?.value;
  const upstream = refresh
    ? await callDjango("/auth/token/refresh/", {
        method: "POST",
        body: JSON.stringify({ refresh }),
      })
    : null;

  if (!upstream?.ok) {
    // A server failure (unreachable, 500...) is not a logout: keep the cookies
    // and let the client retry. Only a refused refresh token ends the session.
    if (upstream && upstream.status >= 500) {
      return jsonError(502, "The API server is unavailable right now.");
    }
    const response = jsonError(401, "Your session has ended. Please sign in again.");
    clearSessionCookies(response);
    return response;
  }

  const tokens = (await upstream.json().catch(() => null)) as Tokens | null;
  if (!tokens?.access) return jsonError(502, "The API server returned an unexpected response.");
  const response = new NextResponse(null, { status: 204 });
  setSessionCookies(response, tokens);
  return response;
}
