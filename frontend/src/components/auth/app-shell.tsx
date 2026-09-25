"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { LoaderCircle } from "lucide-react";

import { useAuth } from "@/lib/auth";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { Sidebar } from "@/components/layout/sidebar";

const LOGIN_PATH = "/login";

function FullScreenStatus({ label }: { label: string }) {
  return (
    <div role="status" className="flex h-dvh flex-1 items-center justify-center">
      <LoaderCircle className="size-6 animate-spin text-muted-foreground motion-reduce:animate-none" />
      <span className="sr-only">{label}</span>
    </div>
  );
}

/**
 * Client-side route guard, the second layer behind src/proxy.ts (which
 * already redirects requests without a session cookie on the server). This
 * one reacts to state changes inside the running app: logout, or a session
 * that expired mid-use, sends the user to /login (remembering where they
 * were); signed-in users never see the login page.
 *
 * This only decides what the UI renders. Data protection lives on the API,
 * which rejects every unauthenticated or unauthorised request on its own.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const onLogin = pathname === LOGIN_PATH;

  useEffect(() => {
    if (isLoading) return;
    if (!user && !onLogin) {
      const next = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname)}`;
      router.replace(`${LOGIN_PATH}${next}`);
    } else if (user && onLogin) {
      router.replace(safeRedirectPath(new URLSearchParams(window.location.search).get("next")));
    }
  }, [isLoading, user, onLogin, pathname, router]);

  if (onLogin) {
    return user ? <FullScreenStatus label="Redirecting" /> : children;
  }
  if (isLoading || !user) {
    return (
      <FullScreenStatus label={isLoading ? "Checking your session" : "Redirecting to sign in"} />
    );
  }

  return (
    <div className="flex h-dvh overflow-hidden">
      <Sidebar />
      <main className="relative flex min-w-0 flex-1 flex-col overflow-y-auto p-6">{children}</main>
    </div>
  );
}
