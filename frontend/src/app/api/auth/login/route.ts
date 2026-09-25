import { NextResponse, type NextRequest } from "next/server";

import {
  callDjango,
  isCrossOrigin,
  jsonError,
  relay,
  setSessionCookies,
  type Tokens,
} from "@/lib/server/session";

/**
 * POST {username, password} -> Django's JWT endpoint. The tokens go into
 * httpOnly cookies; the browser only gets back the signed-in user.
 */
export async function POST(request: NextRequest) {
  if (isCrossOrigin(request)) return jsonError(403, "Cross-origin request refused.");

  const body: unknown = await request.json().catch(() => null);
  const { username, password } = (body ?? {}) as Record<string, unknown>;
  if (typeof username !== "string" || typeof password !== "string") {
    return jsonError(400, "Username and password are required.");
  }

  const forwardedFor = request.headers.get("x-forwarded-for");
  const tokenRes = await callDjango("/auth/token/", {
    method: "POST",
    body: JSON.stringify({ username, password }),
    forwardedFor,
  });
  // 401 bad credentials, 429 throttled (with Retry-After), 502 unreachable...
  if (!tokenRes.ok) return relay(tokenRes);

  const tokens = (await tokenRes.json()) as Tokens;
  const meRes = await callDjango("/auth/me/", { access: tokens.access });
  if (!meRes.ok) return relay(meRes);

  const response = NextResponse.json(
    { user: await meRes.json() },
    { headers: { "Cache-Control": "no-store" } },
  );
  setSessionCookies(response, tokens);
  return response;
}
