"use client";

import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { usePathname, useRouter } from "next/navigation";
import { LoaderCircle } from "lucide-react";

import { useAuth } from "@/lib/auth";
import { safeRedirectPath } from "@/lib/safe-redirect";
import {
  COLLAPSED_WIDTH,
  EXPANDED_WIDTH,
  getServerSnapshot,
  getSnapshot,
  subscribe,
} from "@/components/layout/sidebar-state";
import { UrgentTicketsProvider } from "@/components/attention/urgent-tickets-provider";
import { Toaster } from "@/components/ui/sonner";

// Only signed-in pages show the sidebar and the sign-in alert, so their code
// (with its tooltip, popover and dialog primitives) is split out of the first
// load: /login no longer downloads it. It's fetched in the background as soon
// as any page is up, so it's normally ready before the session check ends.
const loadSidebar = () => import("@/components/layout/sidebar").then((m) => m.Sidebar);
const Sidebar = dynamic(loadSidebar, { loading: SidebarPlaceholder });
const AttentionAlert = dynamic(
  () => import("@/components/attention/attention-alert").then((m) => m.AttentionAlert),
  { ssr: false },
);

/** The sidebar's exact footprint while its code loads, so the page never shifts. */
function SidebarPlaceholder() {
  const collapsed = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return (
    <div
      aria-hidden
      className="h-dvh shrink-0 border-r border-sidebar-border bg-sidebar"
      style={{ width: collapsed ? COLLAPSED_WIDTH : EXPANDED_WIDTH }}
    />
  );
}

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
    void loadSidebar();
  }, []);

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

  // Signed in: the "tickets waiting to be closed" data (sidebar badge, Home
  // box, sign-in alert) lives here, never on /login; keyed by the user so a
  // different sign-in never sees the previous person's tickets.
  return (
    <UrgentTicketsProvider key={user.id}>
      <div className="flex h-dvh overflow-hidden">
        <Sidebar />
        <main className="relative flex min-w-0 flex-1 flex-col overflow-y-auto p-6">
          {children}
        </main>
      </div>
      <AttentionAlert />
      {/* One toast area for every page, so they all appear in the same place. */}
      <Toaster position="bottom-right" />
    </UrgentTicketsProvider>
  );
}
