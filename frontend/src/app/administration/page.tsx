"use client";

import { ShieldAlert } from "lucide-react";

import { useAuth } from "@/lib/auth";
import { StatePlaceholder } from "@/components/common/state-placeholder";
import { UsersPage } from "@/components/administration/users-page";
import { Card } from "@/components/ui/card";

/**
 * Administration (user management). Admins only: staff don't see it in the
 * nav, get this access-denied state if they open the URL, and are refused by
 * the API regardless.
 */
export default function AdministrationPage() {
  const { user } = useAuth();
  if (!user) return null; // AppShell only renders pages for a signed-in user.

  if (user.role !== "admin") {
    return (
      <Card className="mx-auto w-full max-w-xl shadow-elev-1">
        <StatePlaceholder icon={ShieldAlert} title="Admins only" alert>
          Administration is for managing accounts, and only admins can open it. Ask an admin if you
          need something changed on your account.
        </StatePlaceholder>
      </Card>
    );
  }
  return <UsersPage viewer={user} />;
}
