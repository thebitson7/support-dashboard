import { NextResponse, type NextRequest } from "next/server";

import {
  REFRESH_COOKIE,
  callDjango,
  clearSessionCookies,
  isCrossOrigin,
  jsonError,
} from "@/lib/server/session";

/**
 * Blacklists the refresh token in Django (so a copy of it is useless) and
 * clears both cookies. The cookies are cleared even if the API is down.
 */
export async function POST(request: NextRequest) {
  if (isCrossOrigin(request)) return jsonError(403, "Cross-origin request refused.");

  const refresh = request.cookies.get(REFRESH_COOKIE)?.value;
  if (refresh) {
    const upstream = await callDjango("/auth/token/blacklist/", {
      method: "POST",
      body: JSON.stringify({ refresh }),
    });
    // 401 = already invalid/blacklisted, which is the goal anyway. Anything
    // else leaves a live refresh token behind: worth an operator's attention.
    if (!upstream.ok && upstream.status !== 401) {
      console.warn(`[auth] logout could not revoke the refresh token (HTTP ${upstream.status})`);
    }
  }

  const response = new NextResponse(null, { status: 204 });
  clearSessionCookies(response);
  return response;
}
