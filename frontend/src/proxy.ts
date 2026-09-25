import { NextResponse, type NextRequest } from "next/server";

import { safeRedirectPath } from "@/lib/safe-redirect";
import { hasSession } from "@/lib/server/session";

const LOGIN_PATH = "/login";

/**
 * The primary gate for pages: no session cookie, no page. This is an
 * optimistic check (it reads the refresh cookie's expiry and never calls the
 * API, as the Next docs recommend for Proxy); the API itself verifies every
 * token. The client-side AppShell guard remains as a second layer.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const signedIn = hasSession(request);

  if (pathname === LOGIN_PATH) {
    if (!signedIn) return NextResponse.next();
    const next = safeRedirectPath(request.nextUrl.searchParams.get("next"));
    return NextResponse.redirect(new URL(next, request.url));
  }
  if (!signedIn) {
    const url = new URL(LOGIN_PATH, request.url);
    if (pathname !== "/") url.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // Pages only: API routes answer 401 themselves, and assets (anything with a
  // file extension) are public. Backslashes are doubled: this is a JS string.
  matcher: ["/((?!api/|_next/static|_next/image|favicon\\.ico|.*\\.\\w+$).*)"],
};
