import type { NextRequest } from "next/server";

import { ACCESS_COOKIE, callDjango, isCrossOrigin, jsonError, relay } from "@/lib/server/session";

/**
 * Same-origin gateway to the Django API: /api/<path> -> Django /api/<path>/,
 * with the access cookie turned into an Authorization header. (The /api/auth
 * login/refresh/logout routes are separate, more specific handlers.)
 */
async function forward(request: NextRequest, ctx: RouteContext<"/api/[...path]">) {
  const { path } = await ctx.params;

  // Raw tokens must never reach browser JS, so Django's token endpoints are
  // only reachable through the dedicated auth routes. Dot segments (or
  // encoded slashes) could otherwise walk out of /api/, e.g. to /admin/.
  if (path[0] === "auth" && path[1]?.startsWith("token")) return jsonError(404, "Not found.");
  // Segments arrive percent-decoded, so "%2F" shows up here as a real "/".
  const unsafe = (segment: string) =>
    segment === "." || segment === ".." || segment.includes("/") || segment.includes("\\");
  if (path.some(unsafe)) {
    return jsonError(400, "Invalid path.");
  }
  if (request.method !== "GET" && isCrossOrigin(request)) {
    return jsonError(403, "Cross-origin request refused.");
  }

  const target = `/${path.map(encodeURIComponent).join("/")}/${request.nextUrl.search}`;
  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  const upstream = await callDjango(target, {
    method: request.method,
    access: request.cookies.get(ACCESS_COOKIE)?.value,
    body: hasBody ? (await request.text()) || undefined : undefined,
  });
  return relay(upstream);
}

export { forward as GET, forward as POST, forward as PUT, forward as PATCH, forward as DELETE };
