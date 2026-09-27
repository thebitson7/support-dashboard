// Wire shape of /api/accounts/admin/users/ (admin role only).

import type { Role } from "@/lib/auth";

export type AdminUser = {
  id: number;
  username: string;
  first_name: string;
  last_name: string;
  role: Role;
  /** IANA zone, e.g. "Asia/Kuala_Lumpur". */
  timezone: string;
  is_active: boolean;
  /** ISO date-times; last_login is null until their first sign-in. */
  last_login: string | null;
  date_joined: string;
};
