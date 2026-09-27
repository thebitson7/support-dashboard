"use client";

import { ShieldAlert } from "lucide-react";

import { useAuth } from "@/lib/auth";
import { StatePlaceholder } from "@/components/common/state-placeholder";
import { AuditLogPage } from "@/components/audit/audit-log-page";
import { Card } from "@/components/ui/card";

/**
 * Audit Log. Admins only: staff don't see it in the nav, get this
 * access-denied state if they open the URL, and are refused by the API
 * regardless.
 */
export default function AuditLogRoute() {
  const { user } = useAuth();
  if (!user) return null; // AppShell only renders pages for a signed-in user.

  if (user.role !== "admin") {
    return (
      <Card className="mx-auto w-full max-w-xl shadow-elev-1">
        <StatePlaceholder icon={ShieldAlert} title="Admins only" alert>
          The audit log records who did what across the dashboard, and only admins can open it.
        </StatePlaceholder>
      </Card>
    );
  }
  return <AuditLogPage viewer={user} />;
}
