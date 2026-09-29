// @vitest-environment node
// (Node's own fetch primitives: Response, AbortSignal.any, DOMException.)

import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

type ApiModule = typeof import("@/lib/api");

let api: ApiModule;
let fetchMock: Mock<typeof fetch>;

beforeEach(async () => {
  // The client keeps session state at module level (the refresh in flight,
  // its generation): a fresh copy per test keeps tests independent.
  vi.resetModules();
  fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetchMock);
  api = await import("@/lib/api");
});

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

const html = (body: string, status: number) =>
  new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });

/** Runs `promise`, expecting an ApiError, and returns it. */
async function failure(promise: Promise<unknown>) {
  const error = await promise.then(
    () => {
      throw new Error("expected the request to fail");
    },
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(api.ApiError);
  return error as InstanceType<ApiModule["ApiError"]>;
}

const calledPaths = () => fetchMock.mock.calls.map(([url]) => String(url));

describe("successful responses", () => {
  it("parses JSON and calls this app's own /api route without the trailing slash", async () => {
    fetchMock.mockResolvedValue(json({ ok: true }));
    await expect(api.apiGet("/working-hours/summary/?user_id=3")).resolves.toEqual({ ok: true });
    expect(calledPaths()).toEqual(["/api/working-hours/summary?user_id=3"]);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: "GET",
      credentials: "same-origin",
    });
  });

  it("returns undefined for 204 No Content", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(api.apiDelete("/working-hours/entries/5/")).resolves.toBeUndefined();
  });

  it("sends JSON bodies with a JSON content type, FormData with the browser's own", async () => {
    fetchMock.mockImplementation(async () => json({}));
    await api.apiPost("/tickets/", { a: 1 });
    const form = new FormData();
    form.append("x", "1");
    await api.apiPatch("/tickets/1/", form);

    const [jsonInit, formInit] = fetchMock.mock.calls.map(([, init]) => init);
    expect(jsonInit?.body).toBe('{"a":1}');
    expect(jsonInit?.headers).toMatchObject({ "Content-Type": "application/json" });
    expect(formInit?.body).toBe(form);
    expect(formInit?.headers).toBeUndefined();
  });

  it("reports a 2xx whose body isn't JSON as an unexpected response", async () => {
    fetchMock.mockResolvedValue(html("<html>Welcome to nginx</html>", 200));
    const error = await failure(api.apiGet("/tickets/"));
    expect(error.status).toBe(200);
    expect(error.message).toBe("The server returned an unexpected response.");
  });
});

// Regression: a non-JSON error page (Django's debug traceback, a proxy's 502)
// must never leak into the UI. Only a short plain {"detail"} is shown.
describe("error responses never show a raw body", () => {
  it("replaces an HTML 500 (e.g. Django's debug page) with a generic message", async () => {
    const page = "<!DOCTYPE html><title>OperationalError at /api/tickets/</title><pre>Traceback…";
    const response = html(page, 500);
    const textSpy = vi.spyOn(response, "text");
    fetchMock.mockResolvedValue(response);

    const error = await failure(api.apiGet("/tickets/"));
    expect(error.status).toBe(500);
    expect(error.message).toBe("The server returned an unexpected error.");
    expect(error.data).toBeUndefined();
    // Discarded unread, so nothing from it can reach a toast or a log.
    expect(textSpy).not.toHaveBeenCalled();
  });

  it.each([
    [502, "The server is unavailable right now. Try again in a moment."],
    [503, "The server is unavailable right now. Try again in a moment."],
    [504, "The server is unavailable right now. Try again in a moment."],
    [404, "Not found."],
    [413, "The upload is too large."],
    [418, "The request couldn't be completed."],
  ])("gives an HTML %i the generic line for its status", async (status, message) => {
    fetchMock.mockResolvedValue(html("<h1>Bad Gateway</h1>", status));
    const error = await failure(api.apiGet("/x/"));
    expect(error.status).toBe(status);
    expect(error.message).toBe(message);
  });

  it("survives a body that claims to be JSON but isn't", async () => {
    fetchMock.mockResolvedValue(
      new Response("<html>oops</html>", {
        status: 500,
        headers: { "content-type": "application/json" },
      }),
    );
    const error = await failure(api.apiGet("/x/"));
    expect(error.message).toBe("The server returned an unexpected error.");
    expect(error.data).toBeUndefined();
  });

  it("shows the API's own short {detail} sentence", async () => {
    fetchMock.mockResolvedValue(
      json({ detail: "You do not have permission to perform this action." }, 403),
    );
    const error = await failure(api.apiGet("/x/"));
    expect(error.message).toBe("You do not have permission to perform this action.");
  });

  it("accepts a +json media type such as application/problem+json", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ detail: "Gone fishing." }), {
        status: 409,
        headers: { "content-type": "application/problem+json" },
      }),
    );
    expect((await failure(api.apiGet("/x/"))).message).toBe("Gone fishing.");
  });

  it.each([
    ["markup", { detail: "<b>Internal</b> error" }],
    ["a wall of text", { detail: "x".repeat(301) }],
    ["an empty string", { detail: "   " }],
    ["a non-string", { detail: { nested: true } }],
  ])("replaces a {detail} that is %s", async (_, body) => {
    fetchMock.mockResolvedValue(json(body, 500));
    expect((await failure(api.apiGet("/x/"))).message).toBe(
      "The server returned an unexpected error.",
    );
  });

  it("keeps DRF's per-field errors as data, with a generic message", async () => {
    const fields = { end_time: ["End time must be after the start time."] };
    fetchMock.mockResolvedValue(json(fields, 400));
    const error = await failure(api.apiPost("/working-hours/entries/", {}));
    expect(error.message).toBe("The request couldn't be completed.");
    expect(error.data).toEqual(fields);
  });

  it("reads Retry-After on a 429, ignoring nonsense values", async () => {
    fetchMock.mockResolvedValueOnce(json({ detail: "Slow down." }, 429, { "retry-after": "30" }));
    expect((await failure(api.apiGet("/x/"))).retryAfterSeconds).toBe(30);

    fetchMock.mockResolvedValueOnce(json({}, 429, { "retry-after": "soon" }));
    const error = await failure(api.apiGet("/x/"));
    expect(error.retryAfterSeconds).toBeUndefined();
    expect(error.message).toBe("Too many requests. Wait a moment and try again.");
  });
});

describe("requests that never get a response", () => {
  it("turns a network failure into status 0", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    const error = await failure(api.apiGet("/x/"));
    expect(error.status).toBe(0);
    expect(error.message).toBe("Couldn't reach the server. Check your connection and try again.");
  });

  /** A fetch that only ever settles by being aborted, like a hung server. */
  const hang: typeof fetch = (_url, init) =>
    new Promise((_, reject) => {
      init!.signal!.addEventListener("abort", () =>
        reject(new DOMException("The operation was aborted.", "AbortError")),
      );
    });

  it("times out a hung request after 10 s", async () => {
    vi.useFakeTimers();
    try {
      fetchMock.mockImplementation(hang);
      const pending = failure(api.apiGet("/x/"));
      await vi.advanceTimersByTimeAsync(10_000);
      const error = await pending;
      expect(error.status).toBe(0);
      expect(error.message).toBe("The server took too long to respond (over 10s). Try again.");
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports a caller's own cancellation quietly", async () => {
    fetchMock.mockImplementation(hang);
    const controller = new AbortController();
    const pending = failure(api.apiGet("/x/", { signal: controller.signal }));
    controller.abort();
    expect((await pending).message).toBe("Request cancelled.");
  });
});

describe("expired sessions", () => {
  it("refreshes once and retries the original request", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ detail: "Token expired." }, 401))
      .mockResolvedValueOnce(json({}, 200)) // POST /auth/refresh
      .mockResolvedValueOnce(json({ id: 7 }));
    await expect(api.apiGet("/tickets/7/")).resolves.toEqual({ id: 7 });
    expect(calledPaths()).toEqual(["/api/tickets/7", "/api/auth/refresh", "/api/tickets/7"]);
  });

  it("shares a single refresh between requests that expire together", async () => {
    let finishRefresh!: (r: Response) => void;
    fetchMock.mockImplementation(async (url) => {
      const path = String(url);
      if (path === "/api/auth/refresh") return new Promise((r) => (finishRefresh = r));
      // First attempt of each call is a 401; its retry succeeds.
      const attempts = calledPaths().filter((p) => p === path).length;
      return attempts === 1 ? json({}, 401) : json({ path });
    });

    const both = Promise.all([api.apiGet("/a/"), api.apiGet("/b/")]);
    await vi.waitFor(() => expect(calledPaths()).toContain("/api/auth/refresh"));
    finishRefresh(json({}));

    await expect(both).resolves.toEqual([{ path: "/api/a" }, { path: "/api/b" }]);
    expect(calledPaths().filter((p) => p === "/api/auth/refresh")).toHaveLength(1);
  });

  it("signs out (listeners fire) only when the refresh itself is refused", async () => {
    const expired = vi.fn();
    api.onSessionExpired(expired);
    fetchMock
      .mockResolvedValueOnce(json({}, 401))
      .mockResolvedValueOnce(json({ detail: "Token is blacklisted." }, 401));

    const error = await failure(api.apiGet("/x/"));
    expect(expired).toHaveBeenCalledTimes(1);
    expect(error.status).toBe(401);
    expect(error.message).toBe("Your session has expired. Sign in again.");
  });

  it("keeps the session when the refresh endpoint is merely unavailable", async () => {
    const expired = vi.fn();
    api.onSessionExpired(expired);
    fetchMock.mockResolvedValueOnce(json({}, 401)).mockResolvedValueOnce(html("<h1>502</h1>", 502));

    const error = await failure(api.apiGet("/x/"));
    expect(expired).not.toHaveBeenCalled();
    expect(error.status).toBe(503);
  });

  it("stops notifying a listener once it unsubscribes", async () => {
    const expired = vi.fn();
    const unsubscribe = api.onSessionExpired(expired);
    unsubscribe();
    fetchMock.mockResolvedValueOnce(json({}, 401)).mockResolvedValueOnce(json({}, 401));
    await failure(api.apiGet("/x/"));
    expect(expired).not.toHaveBeenCalled();
  });

  it("never refreshes on a 401 from the sign-in endpoint itself", async () => {
    fetchMock.mockResolvedValue(
      json({ detail: "No active account found with the given credentials" }, 401),
    );
    const error = await failure(api.apiPost("/auth/login/", { username: "a", password: "b" }));
    expect(error.message).toBe("No active account found with the given credentials");
    expect(calledPaths()).toEqual(["/api/auth/login"]);
  });
});
