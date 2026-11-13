// Each new sign-in (and sign-out) clears the attention alert's
// acknowledgement, so the alert shows again after signing in.

import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, apiGet, apiPost } from "@/lib/api";
import { acknowledge, isAcknowledged } from "@/lib/attention";
import { AuthProvider, useAuth } from "@/lib/auth";

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  apiGet: vi.fn(),
  apiPost: vi.fn(),
}));

const USER = {
  id: 2,
  username: "syed",
  first_name: "Syed",
  last_name: "Hussain",
  role: "staff",
  timezone: "UTC",
};

function setup() {
  const ref: { current: ReturnType<typeof useAuth> | null } = { current: null };
  function Grab() {
    ref.current = useAuth();
    return null;
  }
  render(
    <AuthProvider>
      <Grab />
    </AuthProvider>,
  );
  return ref;
}

beforeEach(() => {
  sessionStorage.clear();
  vi.mocked(apiGet).mockRejectedValue(new ApiError(401, "no session"));
});

describe("attention acknowledgement across sessions", () => {
  it("is cleared by a successful login", async () => {
    vi.mocked(apiPost).mockResolvedValue({ user: USER });
    const auth = setup();
    await waitFor(() => expect(auth.current?.isLoading).toBe(false));
    acknowledge();
    await act(() => auth.current!.login("syed", "pw").then(() => undefined));
    expect(isAcknowledged()).toBe(false);
  });

  it("is kept when a login fails", async () => {
    vi.mocked(apiPost).mockRejectedValue(new ApiError(401, "bad credentials"));
    const auth = setup();
    await waitFor(() => expect(auth.current?.isLoading).toBe(false));
    acknowledge();
    await act(() => auth.current!.login("syed", "nope").catch(() => undefined));
    expect(isAcknowledged()).toBe(true);
  });

  it("is cleared by logout, even when revocation fails", async () => {
    vi.mocked(apiPost).mockRejectedValue(new ApiError(0, "offline"));
    const auth = setup();
    await waitFor(() => expect(auth.current?.isLoading).toBe(false));
    acknowledge();
    await act(() => auth.current!.logout());
    expect(isAcknowledged()).toBe(false);
  });
});
