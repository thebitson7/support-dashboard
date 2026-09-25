"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { ApiError, apiGet, apiPost, onSessionExpired } from "@/lib/api";

export type Role = "staff" | "admin";

export type AuthUser = {
  id: number;
  username: string;
  first_name: string;
  last_name: string;
  role: Role;
  /** IANA zone, e.g. "Asia/Kuala_Lumpur". */
  timezone: string;
};

type AuthContextValue = {
  user: AuthUser | null;
  /** True until the existing session (if any) has been checked with the API. */
  isLoading: boolean;
  /** Throws ApiError on bad credentials (401), throttling (429) or an unreachable server. */
  login: (username: string, password: string) => Promise<AuthUser>;
  /** Revokes the session server-side, then signs out locally. */
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

// The session itself is a pair of httpOnly cookies managed by the /api/auth
// route handlers; this context only mirrors *who* is signed in.
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Restore an existing session: the cookie is sent automatically, and /me
  // (refreshing the access token if needed) says whether it is still good.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let restored: AuthUser | null = null;
      try {
        restored = await apiGet<AuthUser>("/auth/me");
      } catch (error) {
        // 401 = no/ended session. Anything else is logged so a flaky API
        // doesn't masquerade silently as "signed out".
        if (!(error instanceof ApiError && error.status === 401)) console.warn(error);
      }
      if (!cancelled) {
        setUser(restored);
        setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // A session that could no longer be refreshed ends up here.
  useEffect(() => onSessionExpired(() => setUser(null)), []);

  const login = useCallback(async (username: string, password: string) => {
    const { user: me } = await apiPost<{ user: AuthUser }>("/auth/login", {
      username,
      password,
    });
    setUser(me);
    return me;
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiPost<void>("/auth/logout");
    } catch {
      // The route clears the cookies even when revocation fails; nothing more
      // the UI can do, so sign out locally regardless.
    } finally {
      setUser(null);
    }
  }, []);

  const value = useMemo(
    () => ({ user, isLoading, login, logout }),
    [user, isLoading, login, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside <AuthProvider>");
  return value;
}

export function displayName(user: Pick<AuthUser, "first_name" | "last_name" | "username">) {
  return [user.first_name, user.last_name].filter(Boolean).join(" ") || user.username;
}

export function initials(user: Pick<AuthUser, "first_name" | "last_name" | "username">) {
  const parts = [user.first_name, user.last_name].filter(Boolean);
  const letters = parts.length ? parts.map((p) => p[0]) : [user.username[0]];
  return letters.join("").slice(0, 2).toUpperCase();
}
