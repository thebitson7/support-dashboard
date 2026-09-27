import { NextResponse, type NextRequest } from "next/server";

import {
  callDjango,
  clientAddress,
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

  const forwardedFor = clientAddress(request);
  const tokenRes = await callDjango("/auth/token/", {
    method: "POST",
    body: JSON.stringify({ username, password }),
    forwardedFor,
  });
  // 401 bad credentials, 429 throttled (with Retry-After), 502 unreachable...
  if (!tokenRes.ok) return relay(tokenRes);

  // A 200 that isn't the expected JSON (e.g. a misconfigured proxy's page) is a
  // clean 502, not an unhandled exception.
  const tokens = (await tokenRes.json().catch(() => null)) as Tokens | null;
  if (!tokens?.access) return jsonError(502, "The API server returned an unexpected response.");
  const meRes = await callDjango("/auth/me/", { access: tokens.access });
  if (!meRes.ok) return relay(meRes);
  const me: unknown = await meRes.json().catch(() => null);
  if (!me) return jsonError(502, "The API server returned an unexpected response.");

  const response = NextResponse.json({ user: me }, { headers: { "Cache-Control": "no-store" } });
  setSessionCookies(response, tokens);
  return response;
}
