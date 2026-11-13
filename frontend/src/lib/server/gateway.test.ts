// @vitest-environment node
//
// The server-side gateway: the session helpers, the /api/auth routes, the
// /api/[...path] proxy to Django, and proxy.ts (the page gate). Django is a
// stubbed `fetch`; requests are real NextRequest objects, so the handlers run
// exactly as in production.

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as login } from "@/app/api/auth/login/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { POST as refresh } from "@/app/api/auth/refresh/route";
import { DELETE, GET, PATCH, POST } from "@/app/api/[...path]/route";
import { proxy } from "@/proxy";
import {
  ACCESS_COOKIE,
  DJANGO_API_URL,
  REFRESH_COOKIE,
  callDjango,
  clearSessionCookies,
  clientAddress,
  hasSession,
  isCrossOrigin,
  relay,
  setSessionCookies,
  tokenExpiry,
} from "@/lib/server/session";
import { NextResponse } from "next/server";

const ORIGIN = "http://localhost:3000";
const NOW_S = Math.floor(Date.now() / 1000);

/** An unsigned JWT-shaped token expiring `inSeconds` from now. */
function jwt(inSeconds: number, extra: Record<string, unknown> = {}) {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "HS256" })}.${b64({ exp: NOW_S + inSeconds, ...extra })}.sig`;
}

function request(
  path: string,
  init: {
    method?: string;
    headers?: Record<string, string>;
    cookies?: Record<string, string>;
    body?: BodyInit;
  } = {},
) {
  const headers = new Headers(init.headers);
  if (init.cookies) {
    headers.set(
      "cookie",
      Object.entries(init.cookies)
        .map(([k, v]) => `${k}=${v}`)
        .join("; "),
    );
  }
  return new NextRequest(`${ORIGIN}${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body,
  });
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

/** Every call Django received: [path after /api, init]. */
const fetchMock = vi.fn<typeof fetch>();
const djangoCalls = () =>
  fetchMock.mock.calls.map(([url, init]) => ({
    path: String(url).slice(DJANGO_API_URL.length),
    init: init as RequestInit & { headers: Record<string, string> },
  }));

/** The first call Django received (fails the test if there was none). */
function firstCall() {
  const [call] = djangoCalls();
  if (!call) throw new Error("Django was not called");
  return call;
}

/** A Set-Cookie header parsed into name -> attributes (lower-cased keys). */
function setCookies(response: Response) {
  const out: Record<string, Record<string, string>> = {};
  for (const line of response.headers.getSetCookie()) {
    const [pair = "", ...attrs] = line.split(/;\s*/);
    const [name = "", value = ""] = pair.split("=");
    out[name] = { value };
    for (const attr of attrs) {
      const [k = "", v = "true"] = attr.split("=");
      out[name][k.toLowerCase()] = v;
    }
  }
  return out;
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
});

// --- Session helpers -------------------------------------------------------------

describe("tokenExpiry / hasSession", () => {
  it("reads exp without verifying, and rejects garbage", () => {
    expect(tokenExpiry(jwt(60))).toBe(NOW_S + 60);
    for (const bad of [
      undefined,
      "",
      "abc",
      "a.!!!.c",
      `a.${Buffer.from("{}").toString("base64url")}.c`,
    ]) {
      expect(tokenExpiry(bad)).toBeNull();
    }
  });

  it("is signed in only while the refresh cookie is unexpired", () => {
    expect(hasSession(request("/", { cookies: { [REFRESH_COOKIE]: jwt(3600) } }))).toBe(true);
    expect(hasSession(request("/", { cookies: { [REFRESH_COOKIE]: jwt(-1) } }))).toBe(false);
    expect(hasSession(request("/", { cookies: { [ACCESS_COOKIE]: jwt(3600) } }))).toBe(false);
    expect(hasSession(request("/"))).toBe(false);
  });
});

describe("session cookies", () => {
  it("are httpOnly, SameSite=Lax, site-wide, and expire with their token", () => {
    const access = jwt(300);
    const refreshToken = jwt(86400);
    const response = NextResponse.json({});
    setSessionCookies(response, { access, refresh: refreshToken });
    const cookies = setCookies(response);
    for (const [name, token, ttl] of [
      [ACCESS_COOKIE, access, 300],
      [REFRESH_COOKIE, refreshToken, 86400],
    ] as const) {
      expect(cookies[name]?.value).toBe(token);
      expect(cookies[name]?.httponly).toBe("true");
      expect(cookies[name]?.samesite).toBe("lax");
      expect(cookies[name]?.path).toBe("/");
      expect(new Date(cookies[name]?.expires ?? "").getTime() / 1000).toBe(NOW_S + ttl);
    }
  });

  it("leave the refresh cookie alone when only an access token is given", () => {
    const response = NextResponse.json({});
    setSessionCookies(response, { access: jwt(300) });
    expect(Object.keys(setCookies(response))).toEqual([ACCESS_COOKIE]);
  });

  it("are cleared with already-expired cookies on the same path", () => {
    const response = NextResponse.json({});
    clearSessionCookies(response);
    const cookies = setCookies(response);
    for (const name of [ACCESS_COOKIE, REFRESH_COOKIE]) {
      expect(cookies[name]?.value).toBe("");
      expect(cookies[name]?.path).toBe("/");
      expect(new Date(cookies[name]?.expires ?? "").getTime()).toBeLessThan(Date.now());
    }
  });
});

describe("isCrossOrigin", () => {
  it("allows same-origin and header-less requests", () => {
    expect(isCrossOrigin(request("/api/x", { headers: { origin: ORIGIN } }))).toBe(false);
    expect(isCrossOrigin(request("/api/x", { headers: { "sec-fetch-site": "same-origin" } }))).toBe(
      false,
    );
    expect(isCrossOrigin(request("/api/x"))).toBe(false);
  });

  it("refuses another origin or a browser-labelled cross-site request", () => {
    expect(isCrossOrigin(request("/api/x", { headers: { origin: "https://evil.example" } }))).toBe(
      true,
    );
    expect(isCrossOrigin(request("/api/x", { headers: { "sec-fetch-site": "cross-site" } }))).toBe(
      true,
    );
  });
});

describe("clientAddress", () => {
  it("takes the right-most X-Forwarded-For entry when it's a real IP", () => {
    const from = (xff: string) =>
      clientAddress(request("/", { headers: { "x-forwarded-for": xff } }));
    expect(from("203.0.113.9")).toBe("203.0.113.9");
    expect(from("1.2.3.4, 198.51.100.7")).toBe("198.51.100.7");
    expect(from("2001:db8::1")).toBe("2001:db8::1");
  });

  it("drops anything that isn't a well-formed IP", () => {
    const from = (xff: string) =>
      clientAddress(request("/", { headers: { "x-forwarded-for": xff } }));
    expect(from("198.51.100.7, evil")).toBeNull();
    expect(from("999.1.1.1")).toBeNull();
    expect(clientAddress(request("/"))).toBeNull();
  });
});

describe("callDjango", () => {
  it("sends the Bearer token and forwarded IP, never cached", async () => {
    fetchMock.mockResolvedValue(json(200, {}));
    await callDjango("/tickets/", { access: "AAA", forwardedFor: "203.0.113.9" });
    const { path, init } = firstCall();
    expect(path).toBe("/tickets/");
    expect(init.cache).toBe("no-store");
    expect(init.headers.Authorization).toBe("Bearer AAA");
    expect(init.headers["X-Forwarded-For"]).toBe("203.0.113.9");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("turns a network failure into a JSON 502", async () => {
    fetchMock.mockRejectedValue(new TypeError("connect ECONNREFUSED"));
    const response = await callDjango("/tickets/");
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ detail: "The API server is unreachable." });
  });
});

describe("relay", () => {
  it("replaces a non-JSON error (e.g. a Django traceback) with a generic message", async () => {
    const upstream = new Response("<html>Traceback: SECRET_KEY=…</html>", {
      status: 500,
      headers: { "content-type": "text/html", "retry-after": "30" },
    });
    const response = await relay(upstream);
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).not.toContain("Traceback");
    expect(JSON.parse(text)).toEqual({ detail: "The server returned an unexpected error." });
    expect(response.headers.get("retry-after")).toBe("30");
  });

  it("passes JSON through with only allow-listed headers, never cached", async () => {
    const response = await relay(
      json(
        400,
        { site: "Must be a site id." },
        { "set-cookie": "x=1", server: "WSGIServer", "x-debug": "1" },
      ),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ site: "Must be a site id." });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("server")).toBeNull();
    expect(response.headers.get("x-debug")).toBeNull();
  });

  it("keeps a CSV's bytes (byte-order mark included) and its file name", async () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("a,b\r\n")]);
    const response = await relay(
      new Response(bytes, {
        status: 200,
        headers: {
          "content-type": "text/csv",
          "content-disposition": 'attachment; filename="t.csv"',
        },
      }),
    );
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="t.csv"');
  });

  it("relays a 204 with no body", async () => {
    const response = await relay(new Response(null, { status: 204 }));
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
  });
});

// --- /api/[...path] ------------------------------------------------------------------

const ctx = (...path: string[]) => ({ params: Promise.resolve({ path }) });

describe("the API gateway", () => {
  it("forwards to Django with the access cookie as a Bearer token, keeping the query", async () => {
    fetchMock.mockResolvedValue(json(200, { results: [] }));
    const response = await GET(
      request("/api/tickets?status=open&search=a%20b", {
        cookies: { [ACCESS_COOKIE]: "ACCESS" },
        headers: { "x-forwarded-for": "203.0.113.9" },
      }),
      ctx("tickets"),
    );
    expect(response.status).toBe(200);
    const { path, init } = firstCall();
    expect(path).toBe("/tickets/?status=open&search=a%20b");
    expect(init.method).toBe("GET");
    expect(init.headers.Authorization).toBe("Bearer ACCESS");
    expect(init.headers["X-Forwarded-For"]).toBe("203.0.113.9");
  });

  it("never exposes Django's token endpoints", async () => {
    for (const second of ["token", "token-refresh"]) {
      const response = await POST(
        request(`/api/auth/${second}`, { method: "POST" }),
        ctx("auth", second),
      );
      expect(response.status).toBe(404);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses path traversal, including percent-encoded slashes", async () => {
    for (const path of [[".."], ["tickets", "."], ["..", "admin"], ["a/b"], ["a\\b"]]) {
      const response = await GET(request("/api/x"), ctx(...path));
      expect(response.status, path.join("|")).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses cross-origin writes but not cross-origin reads", async () => {
    const evil = { origin: "https://evil.example" };
    for (const handler of [POST, PATCH, DELETE]) {
      const response = await handler(
        request("/api/tickets/1", { method: "POST", headers: evil }),
        ctx("tickets", "1"),
      );
      expect(response.status).toBe(403);
    }
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockResolvedValue(json(200, {}));
    expect((await GET(request("/api/tickets", { headers: evil }), ctx("tickets"))).status).toBe(
      200,
    );
  });

  it("refuses oversized uploads before reading them", async () => {
    const response = await POST(
      request("/api/tickets", {
        method: "POST",
        headers: { "content-length": String(13 * 1024 * 1024) },
      }),
      ctx("tickets"),
    );
    expect(response.status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps a multipart body's bytes and boundary", async () => {
    fetchMock.mockResolvedValue(json(201, {}));
    const form = new FormData();
    form.set("notes", "n");
    form.set(
      "pdf_attachment",
      new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0xff])]),
      "a.pdf",
    );
    const outgoing = new Request(`${ORIGIN}/x`, { method: "POST", body: form });
    const contentType = outgoing.headers.get("content-type") ?? "";
    const bytes = await outgoing.arrayBuffer();
    await POST(
      request("/api/tickets", {
        method: "POST",
        headers: { "content-type": contentType },
        body: bytes,
      }),
      ctx("tickets"),
    );
    const { init } = firstCall();
    expect(init.headers["Content-Type"]).toBe(contentType);
    expect(new Uint8Array(init.body as ArrayBuffer)).toEqual(new Uint8Array(bytes));
  });

  it("never relays a non-JSON upstream error", async () => {
    fetchMock.mockResolvedValue(
      new Response("<h1>Bad Gateway</h1>", {
        status: 502,
        headers: { "content-type": "text/html" },
      }),
    );
    const response = await GET(request("/api/tickets"), ctx("tickets"));
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      detail: "The server is unavailable right now. Try again in a moment.",
    });
  });
});

// --- /api/auth/* -----------------------------------------------------------------------

describe("login", () => {
  const body = (data: unknown) => ({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data),
  });

  it("sets both cookies and returns only the user, never the tokens", async () => {
    const access = jwt(300);
    const refreshToken = jwt(86400);
    fetchMock
      .mockResolvedValueOnce(json(200, { access, refresh: refreshToken }))
      .mockResolvedValueOnce(json(200, { id: 2, username: "syed" }));
    const response = await login(
      request("/api/auth/login", {
        ...body({ username: "syed", password: "pw" }),
        headers: { "x-forwarded-for": "203.0.113.9" },
      }),
    );
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ user: { id: 2, username: "syed" } });
    expect(text).not.toContain(access);
    const cookies = setCookies(response);
    expect(cookies[ACCESS_COOKIE]?.value).toBe(access);
    expect(cookies[REFRESH_COOKIE]?.value).toBe(refreshToken);
    const [tokenCall, meCall] = djangoCalls();
    expect(tokenCall?.path).toBe("/auth/token/");
    expect(tokenCall?.init.headers["X-Forwarded-For"]).toBe("203.0.113.9");
    expect(meCall?.init.headers.Authorization).toBe(`Bearer ${access}`);
  });

  it("validates the body and refuses cross-origin posts", async () => {
    expect((await login(request("/api/auth/login", body({ username: "syed" })))).status).toBe(400);
    expect(
      (await login(request("/api/auth/login", { method: "POST", body: "not json" }))).status,
    ).toBe(400);
    const evil = await login(
      request("/api/auth/login", {
        ...body({ username: "a", password: "b" }),
        headers: { origin: "https://evil.example" },
      }),
    );
    expect(evil.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("relays refused credentials and throttling without setting cookies", async () => {
    fetchMock.mockResolvedValueOnce(
      json(429, { detail: "Too many sign-in attempts." }, { "retry-after": "120" }),
    );
    const response = await login(
      request("/api/auth/login", body({ username: "a", password: "b" })),
    );
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("120");
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it("answers a 200 that isn't the token JSON with a clean 502", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("<html>proxy</html>", { status: 200, headers: { "content-type": "text/html" } }),
    );
    const response = await login(
      request("/api/auth/login", body({ username: "a", password: "b" })),
    );
    expect(response.status).toBe(502);
    expect(response.headers.getSetCookie()).toEqual([]);
  });
});

describe("refresh", () => {
  const post = (cookies?: Record<string, string>) =>
    refresh(request("/api/auth/refresh", { method: "POST", cookies }));

  it("swaps the refresh cookie for a new access cookie", async () => {
    const access = jwt(300);
    fetchMock.mockResolvedValueOnce(json(200, { access }));
    const response = await post({ [REFRESH_COOKIE]: "R" });
    expect(response.status).toBe(204);
    expect(setCookies(response)[ACCESS_COOKIE]?.value).toBe(access);
    expect(JSON.parse(String(djangoCalls()[0]?.init.body))).toEqual({ refresh: "R" });
  });

  it("ends the session (401, cookies cleared) without a cookie or when Django refuses it", async () => {
    const none = await post();
    expect(none.status).toBe(401);
    expect(setCookies(none)[REFRESH_COOKIE]?.value).toBe("");
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockResolvedValueOnce(json(401, { detail: "Token is blacklisted" }));
    const refused = await post({ [REFRESH_COOKIE]: "R" });
    expect(refused.status).toBe(401);
    expect(setCookies(refused)[ACCESS_COOKIE]?.value).toBe("");
  });

  it("keeps the session on a server failure (502, cookies untouched)", async () => {
    fetchMock.mockResolvedValueOnce(json(500, { detail: "boom" }));
    const response = await post({ [REFRESH_COOKIE]: "R" });
    expect(response.status).toBe(502);
    expect(response.headers.getSetCookie()).toEqual([]);
  });
});

describe("logout", () => {
  it("revokes the refresh token and clears both cookies", async () => {
    fetchMock.mockResolvedValueOnce(json(200, {}));
    const response = await logout(
      request("/api/auth/logout", { method: "POST", cookies: { [REFRESH_COOKIE]: "R" } }),
    );
    expect(response.status).toBe(204);
    expect(djangoCalls()[0]?.path).toBe("/auth/token/blacklist/");
    const cookies = setCookies(response);
    expect(cookies[ACCESS_COOKIE]?.value).toBe("");
    expect(cookies[REFRESH_COOKIE]?.value).toBe("");
  });

  it("still clears the cookies when the API is down", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("down"));
    const response = await logout(
      request("/api/auth/logout", { method: "POST", cookies: { [REFRESH_COOKIE]: "R" } }),
    );
    expect(response.status).toBe(204);
    expect(setCookies(response)[REFRESH_COOKIE]?.value).toBe("");
  });

  it("refuses a cross-origin logout", async () => {
    const response = await logout(
      request("/api/auth/logout", { method: "POST", headers: { origin: "https://evil.example" } }),
    );
    expect(response.status).toBe(403);
  });
});

// --- proxy.ts (the page gate) ------------------------------------------------------------

describe("proxy", () => {
  const signedIn = { [REFRESH_COOKIE]: jwt(3600) };
  const location = (response: Response) => response.headers.get("location");

  it("sends a visitor without a session to sign in, remembering the page", () => {
    expect(location(proxy(request("/reports?x=1")))).toBe(
      `${ORIGIN}/login?next=%2Freports%3Fx%3D1`,
    );
    expect(location(proxy(request("/")))).toBe(`${ORIGIN}/login`);
    expect(
      location(proxy(request("/reports", { cookies: { [REFRESH_COOKIE]: jwt(-5) } }))),
    ).toContain("/login");
  });

  it("lets a signed-in user through, and away from /login to a safe next page", () => {
    expect(location(proxy(request("/reports", { cookies: signedIn })))).toBeNull();
    expect(location(proxy(request("/login?next=/audit-log", { cookies: signedIn })))).toBe(
      `${ORIGIN}/audit-log`,
    );
    expect(location(proxy(request("/login?next=//evil.example", { cookies: signedIn })))).toBe(
      `${ORIGIN}/`,
    );
    expect(location(proxy(request("/login")))).toBeNull();
  });
});
