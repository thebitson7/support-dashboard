# Project Status — Support Dashboard

_Snapshot as of 2026-09-27, after the final pre-deployment review. Checked against the code, the full Django suite on **both SQLite and PostgreSQL 16.2**, migrations + seeds + sync on a fresh PostgreSQL database, a fresh-database reachability sweep of every page's API, `check --deploy`, `tsc`, `eslint`, `prettier`, a production `next build`, and headless-browser walkthroughs of every page (both roles, light and dark, 768–1440 px, keyboard only)._

---

## 1. Overview

The Support Dashboard is an internal tool for a support team. It covers:
- **AMS support tickets,** from receipt, through activities, to verified closure.
- **Logged work:** AMS time captured automatically from ticket activities, and Non-AMS time logged by hand, shown per day (Job Sheets) and per period against goals (Working Hours).
- **Reporting** across tickets and the team's logged work, with CSV exports.
- **The reference data** tickets depend on.

**Stack**
- **Frontend:** Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4, shadcn/ui on Base UI, TanStack Table v9, Recharts, Framer Motion, Sonner toasts.
- **Backend:** Django 6.1, Django REST Framework. **PostgreSQL** in production via `DATABASE_URL` (SQLite when unset, for development); optional **Redis** (`REDIS_URL`) for shared rate limits; **whitenoise** for Django's static files.
- **Auth:** SimpleJWT. The tokens live in httpOnly cookies owned by the Next.js server, which forwards calls to Django with a Bearer header. The browser never talks to Django directly.

**Current state:** every data-backed feature is real:
- **AMS Tickets:** list, create, edit, close/reopen.
- **Lookups:** five CRUD pages.
- **Working Hours:** period summaries.
- **Job Sheets:** one person's day, auto AMS plus manual Non-AMS.
- **Reports:** All Tickets and Team Activity, both with CSV export.

- **Administration:** admin-only user management.
- **Audit Log:** admin-only record of sign-ins, ticket, hours, lookup and account changes, with CSV export.

Only the **Home dashboard** still runs on mock data; no placeholders are left. The backend suite has 292 tests, all passing on SQLite **and** PostgreSQL 16.2. Typecheck, lint and formatting are clean, the production build succeeds, and `check --deploy` is clean apart from the deliberately opt-in HSTS. It's ready for the data wipe and deploy; §4.2 lists what's left.

---

## 2. Feature-by-feature breakdown

### 2.1 Project scaffold & conventions

**What it is:** a two-part repo. `backend/` is a Django API and `frontend/` is a Next.js app.

**Decisions worth remembering**
- **Backend: one Django app per domain area:**
  - `core`: ping, CSV export helpers, and the `DevOnlyCommand` guard.
  - `accounts`: users, roles, JWT, shared permission classes.
  - `tickets`: tickets, activities, and the reference-data models.
  - `lookups`: the management API for reference data.
  - `working_hours`: work-log entries, period summaries, the ticket-activity sync, and the exact-minute totals.
  - `reports`: read-only report views.

  Each app's `urls.py` is mounted under `/api/<area>/`. Two exceptions: auth is at `/api/auth/`, and user search at `/api/accounts/users/`.
- **Reference-data models live in the `tickets` app,** because tickets reference them. `lookups` holds only their management API.
- **Settings come from env vars** via `backend/.env`. `.env.example` documents every one.
  - `SECRET_KEY` is required.
  - `DEBUG` is off unless set.
  - HTTPS hardening switches on whenever `DEBUG` is off.
- **Private by default:** the DRF default permission is `IsAuthenticated`. Only `/api/ping/` and the token endpoints opt out.
- **Seed commands refuse to run with `DEBUG` off** (`DevOnlyCommand`). This is tested for every seed. `sync_ticket_work_logs` is deliberately *not* dev-only: it only rebuilds auto entries, and is safe in production.
- **Frontend: all API calls go through `src/lib/api.ts`,** including CSV downloads (`apiDownload`), with `useApiGet` in `src/hooks/use-api.ts`. `useApiGet` aborts a superseded request and keys results to the request they answer.
- **Tooling:** Prettier, ESLint, and a `typecheck` script. There is no CI yet (gap #4).

### 2.2 Sidebar & theming

**What it does:** a dark navy sidebar holds every section. It collapses to an icon rail (remembered in `localStorage`), and its Lookups group shows six pages. The bottom shows who is signed in, with a sign-out menu. A light/dark toggle starts from the system theme.

**Decisions:**
- `src/config/nav.ts` is the single source of truth for navigation.
- **Admin-only items are hidden from staff** (`adminOnly` in `nav.ts`). Today that's Administration and Audit Log, which also guard themselves and is refused by the API.

### 2.3 Home dashboard

**What it does:** KPI cards, period cards, a weekly-hours chart, a ticket-status donut, an activity feed and top sites, with a choreographed entrance and a skeleton.

**Important:** all of it is **mock data** (`src/lib/mock-data.ts`, marked with a visible "Sample data" badge). `getDashboardData()` is the single seam for swapping in real calls.

### 2.4 Authentication (login, JWT, cookies, roles)

**What it does:** username/password sign-in. Signed-out visitors are sent to `/login` and returned to the page they wanted afterwards. Sign-out ends the server session. Sign-in attempts are rate limited.

**Decisions**
- **Cookie-held JWTs.** `sd_access` (5 min) and `sd_refresh` (1 day) are httpOnly, `SameSite=Lax`, and `Secure` in production.
  - Refresh rotation is deliberately off, for multi-tab use.
  - Logout blacklists the refresh token.
- **Guards:**
  - `src/proxy.ts` checks for a session before any page renders.
  - A client-side `AppShell` check is the second layer.
  - Django verifies every token on every call.
- **Rate limiting:** sign-in allows 5 attempts per 5 minutes per (username + client IP), returning 429 with `Retry-After`; `X-Forwarded-For` is trusted only from `TRUSTED_PROXY_IPS`. CSV exports are limited to 30/h per user, and Administration writes to 60/h per admin. All rates are env-configurable, and the counters live in Redis when `REDIS_URL` is set.
- **Deactivation takes effect immediately:** sign-in, existing access tokens and refresh all stop working. Deactivating someone, or resetting their password, also **revokes all their refresh tokens** (`accounts/sessions.py`), signing them out everywhere.
- **Roles:** `User.role` is `staff` or `admin`, separate from Django's `is_staff`/`is_superuser` (which only open `/admin/`). Every user has a validated IANA `timezone`, defaulting to `Asia/Kuala_Lumpur`.
- **Expiry is handled by the client.** An expired access token triggers **exactly one** refresh (single-flight) and a retry.
- **Verified end to end in this audit** through the real frontend and gateway:
  - A signed-out visit redirects to login.
  - The cookies are httpOnly and invisible to page JS.
  - After an expired access token, one refresh happens and the page stays put.
  - Logout clears the cookies, and the old refresh token is refused afterwards.

### 2.5 User Working Hours (Lookups → User Working Hours)

**What it does:** six periods (Today, Yesterday, Current/Last Week, Current/Previous Month), each with the AMS/Non-AMS split, the goal and percent complete. Staff see their own; admins pick a staff member. A "View Job Sheet" button opens that person's day-by-day detail. Logging hours lives on Job Sheets.

**Decisions**
- **Periods are cut in the viewer's time zone** (see §3.5). Weeks run Monday–Sunday. The goals are fixed at 8 / 40 / 176 h.
- **Totals are exact minutes,** summed from the entries' times in one query (`working_hours/totals.py`), the same arithmetic Reports and Job Sheets use. _Fixed in this audit:_ the summary used to add the per-entry rounded `hours` column, so short entries drifted (4 × 20 min read 1h 19m).
- **Permissions:**
  - Staff can see only their own data (403 otherwise).
  - Admins must pass `user_id`.
  - A deactivated user's history is still readable by id (§3.1).

### 2.6 AMS Tickets (list + create/edit)

**What it does:** an 11-column server-side table (paging, sorting, search; status/site/date filters) and a three-tab New/Edit dialog (Ticket, Activities, Verification).

**Decisions**
- **Status is derived:** a ticket is closed exactly when `cms_closed_on` is set. Verification is all-or-nothing, and clearing it reopens the ticket.
- **Total duration is server-computed** from the activities once any exist. Activities are replaced as a set, in one transaction, with a row lock.
- **After every save, activities with a resolver are mirrored into work logs** (§2.8).
- `created_by` is always the requester.
- Deactivated users can't be newly assigned.
- The PDF attachment is checked by its magic bytes and limited to 10 MB. **Downloads go only through `GET /api/tickets/<id>/attachment/`** (any signed-in user; `private, no-store`), offered as a Download button in the edit dialog. Nothing is served from `MEDIA_URL`, in development either.
- **Any signed-in user may list, create and edit any ticket** (gap #5). There is no ticket delete (gap #8).
- **Site and customer quick-add is admin-only,** matching Lookups. Staff get search plus an "ask an admin" hint.
- **Date-times in the form use the browser's zone** (gap #17).

### 2.7 Lookups (Sites, Customers, Countries, Work Done Codes, Holidays)

**What it does:** five generic, config-driven CRUD pages. Everyone can read them; only admins can write (`IsAdminRoleOrReadOnly`).

**Decisions:**
- **Deleting a record that's in use returns 409** with a plain-language count and a hint (deactivate it, or move its tickets first).
- **Deactivation instead of deletion:** inactive sites and codes leave the ticket form's pickers but stay on the records that already use them.
- **Values are normalised,** and uniqueness is checked case-insensitively.
- **Holidays** can be global or per-country, and recurring or one-off. They aren't used by any calculation yet (gap #10).

### 2.8 Job Sheets, and the ticket-activity → work-log sync

**What it does:** `/job-sheets` shows one person's work for one day: a day summary against the 8 h goal (AMS/Non-AMS), and every entry in time order.
- **Navigation:** previous/next day, a date picker, and "Back to today" (no future days).
- **Admins** can pick anyone.
- **The URL holds the state** (`?date=&user_id=`), so links and the back button work.
- **Manual entries** (Non-AMS) have edit and delete, plus **Log Hours** for the day being viewed.
- **Auto entries** show their ticket reference and a "From ticket" lock with an explanation.

**How AMS time gets there:** a ticket activity with `resolved_by` set is that person's AMS time. It is mirrored as one `WorkLogEntry` (`ticket_activity`, a unique one-to-one). `working_hours/sync.py` is the only code that writes auto entries. It is reached from:
- the ticket serializer, after every save (activities are bulk-written, so no signals fire);
- a `post_save` signal, for single saves such as the admin inline;
- `manage.py sync_ticket_work_logs`, the backfill and repair command.

**Rules**
- **Auto entries are read-only everywhere except the ticket.** The API answers 409, pointing at the ticket; the admin can't edit them; the UI shows a lock.
- **Manual entries are Non-AMS only.** The API refuses `category=ams`. An older hand-logged AMS entry keeps its category when edited.
- **Keeping auto entries correct:**
  - Clearing the resolver removes the entry.
  - Changing the resolver moves the entry to the new resolver.
  - Deleting the activity deletes it (CASCADE, which also applies to bulk deletes).
  - Editing the ticket number refreshes the reference.
- **Time rules:**
  - An auto entry sits on the activity's start date in the **resolver's** own zone.
  - Past midnight it is clipped to 11:59 PM (gap #14); under a minute, it gets no entry.
  - Manual entries need an end time after the start time, can't be on a future date, and a day can't exceed 24 h across all entries.
- **`seed_work_logs` now generates Non-AMS manual entries only** (fixed in this audit). It never touches auto entries.

**Files:**
- Backend: `working_hours/` (`sync.py`, `serializers.py`, `views.py`, `totals.py`).
- Frontend: `app/job-sheets/page.tsx`, `components/job-sheets/` (`day-summary`, `day-entries`), `components/working-hours/log-hours-dialog.tsx`.

### 2.9 Reports (`/reports`)

**What it does:**
- **All Tickets**, for everyone: the tickets table reused in read-only mode (no New/Edit), with **Export CSV** of the current view, meaning every matching row rather than one page.
- **Team Activity**, admin only:
  - From/To pickers plus This week / This month / Last month presets.
  - A sortable table of every active staff member's total, AMS, Non-AMS and entry count, with a totals row.
  - An inline drill-down per person, grouped by date, with links to that day's Job Sheet.
  - CSV exports for the team and for one person.

Staff see only All Tickets, with no tab bar.

**Decisions**
- `GET /api/reports/team-activity/` has a 366-day range limit, and the range defaults to the current month in the viewer's zone. Without `user_id` it returns everyone's totals (one grouped query); with `user_id` it returns that person's totals plus their entries, and works for deactivated users.
- **All totals are exact minutes** from `working_hours/totals.py`, shared with the Working Hours summary. The totals row is exactly the sum of the rows above it.
- **CSVs:**
  - UTF-8 with a BOM, and formula-injection-safe (user-entered text starting with `= + - @` gets a leading `'`).
  - The team CSV has **Hours and Minutes** columns; Minutes is the one that adds up exactly.
  - The ticket CSV writes times in the browser's zone (`tz`), so it matches the screen.

### 2.10 Administration (`/administration`, admin only)

**What it does:** every account, active or not. Admins can search, sort, add, edit, deactivate or reactivate, and reset passwords.
- **Staff never see it:** the nav item is hidden, the URL shows an "Admins only" state, and the API answers 403.

**Decisions**
- **API:** `GET/POST /api/accounts/admin/users/` and `GET/PATCH /api/accounts/admin/users/<id>/`. There's no PUT and no DELETE: people are deactivated, never deleted.
- **Passwords are admin-set, checked by Django's validators** (at least 10 characters, not common, not all numbers, not similar to the name).
  - A **Generate** button makes a strong one in the browser, with a cryptographic RNG, so **the server never returns a password**.
  - A reset is confirmed separately and signs the person out everywhere.
  - There's no forced change on first login yet (gap #9).
- **Usernames** are unique case-insensitively and fixed once created.
- **Self-lockout guard:** an admin can't remove their own admin role or deactivate themselves (400 with a clear message). The UI disables those controls with the reason.
- **Roles:** choosing Admin shows what it grants. The app's admin role is separate from Django's `/admin/` flags (gap #21).

**Files:** `accounts/` (`views.py`, `serializers.py`, `sessions.py`, `throttling.py`), `app/administration/page.tsx`, `components/administration/`.

### 2.11 Audit Log (`/audit-log`, admin only)

**What it does:** a chronological, human-readable record of who did what. It covers sign-ins (successful and failed) and sign-outs; ticket create / edit / close / reopen and activities added or removed; manual hours logged, edited or deleted; lookup changes (all five, plus the ticket form's quick-add); and account changes (created, edited, deactivated, reactivated, role changed, password reset). Admins filter by user, action, date range (last 30 days by default), free text or a target (click one in the table), and export the same view as CSV.
- **Staff never see it:** the nav item is hidden, the URL shows an "Admins only" state, and all three endpoints answer 403.

**Decisions**
- **One writer:** `audit/log.py` `log_action()`, called explicitly at each call site (no signals), so only real user actions are logged and each description is written where the context is. It is best-effort: a failed write is logged to the server log and swallowed, inside a savepoint, so it can never break or roll back the action.
- **Snapshots:** the actor's username, the target's label and the description are frozen at write time, so later renames don't rewrite history. `actor` is `SET_NULL`.
- **Never logged:** passwords (a reset records only that it happened), tokens, and password hashes. Tested explicitly.
- **Deliberately not logged:** sign-ins for unknown usernames (they'd name nobody) and throttled attempts (429, refused before any check); no-op saves; refused deletes (409); auto AMS work-log entries (the ticket activity entry already covers them); activities created with a new ticket (counted in its "created" entry).
- **IP address:** from `client_ip()`, which trusts `X-Forwarded-For` only from `TRUSTED_PROXY_IPS` and only when it's a well-formed IP. The Next.js gateway forwards one validated address on every call (`clientAddress()`); see gap #25 for the proxy requirement.
- **Retention:** nothing is deleted automatically. `python manage.py prune_audit_logs --older-than-days=N [--dry-run]` exists for a written retention policy and isn't scheduled.
- **Dates:** the filter's days are whole days in the admin's profile zone (like Reports); timestamps display, and export, in the browser's zone (`tz` param).

**API:** `GET /api/audit/logs/` (filters `actor`, `action` comma list, `target_type` + `target_id`, `start_date` / `end_date`, `search`, `ordering`; paginated 50/page, max 200), `GET /api/audit/logs/export/` (same filters, CSV, export throttle), `GET /api/audit/logs/actions/` (values, labels, groups).

**Files:** `audit/` (`models.py`, `log.py`, `text.py`, `views.py`, the prune command), `tickets/audit.py`, `lookups/audit.py`, the call sites in `accounts/views.py`, `tickets/serializers.py`, `working_hours/views.py`, `lookups/views.py`; `app/audit-log/page.tsx`, `components/audit/audit-log-page.tsx`.

---

## 3. Cross-cutting systems

### 3.1 Permission / role model

- **Every role-gated endpoint uses a shared class** from `accounts/permissions.py`, with no inline role checks (re-verified in this audit):
  - `IsAdminRole`: admin-only endpoints (the staff list, reports, the audit log).
  - `IsAdminRoleOrSelf`: admins may target anyone, staff only themselves, and naming anyone else is a 403.
  - `IsAdminRoleOrOwner`: object level, so staff may act only on their own entries.
  - `IsAdminRoleOrReadOnly`: reads for everyone, writes for admins (Lookups, site and customer quick-add).

  | Area | Staff | Admin |
  |---|---|---|
  | Tickets | Full list / create / edit | Same |
  | Site / customer quick-add | Refused (403) | Allowed |
  | Lookups | Read only | Read + write |
  | Working hours, Job Sheets | Own data; own manual entries | Anyone's |
  | Reports: All Tickets + export | Allowed | Allowed |
  | Reports: Team Activity + export | Refused (403) | Allowed |
  | User search | Allowed (names/ids only) | Allowed |
  | Administration (list / create / edit users) | Refused (403) | Allowed (can't demote or deactivate themselves) |
  | Audit Log (list, export, actions) | Refused (403) | Allowed |

- **Deactivated users (one rule everywhere, made consistent in this audit):**
  - They're left out of every picker and "everyone" view: the staff list, user search, the Team Activity overview.
  - **Their history stays readable by id:** summary, Job Sheet day, Reports drill-down, and the tickets they appear on.
  - Nothing new can be written for them (404).
  - Before this audit, the working-hours reads returned 404 for them while Reports returned their data.
- **User references use `PROTECT`,** and reference data is `PROTECT` too. Only true children cascade: activity → ticket, and auto entry → activity.
- The frontend mirrors the rules for display only; the API is the authority.

### 3.2 API gateway & cookie-auth architecture

```
Browser ──(same origin, httpOnly cookies)──▶ Next.js server ──(Bearer token)──▶ Django /api/
```

- **Routes:** `/api/auth/{login,refresh,logout}` own the cookies. `/api/[...path]` forwards everything else, relaying the status, the raw body bytes, and only `Content-Type`, `Content-Disposition` and `Retry-After`.
- **Downloads** (CSV exports, PDF attachments) go through `apiDownload()`, which shares the refresh-and-retry, so an expired access token never downloads an error instead of the file.
- **Security headers** on every page from `next.config.ts`: `nosniff`, `X-Frame-Options: DENY`, `strict-origin-when-cross-origin`, a restrictive `Permissions-Policy`, and no `X-Powered-By`. HSTS is sent when `HSTS_MAX_AGE` is set.
- **Gateway guards:**
  - It refuses `auth/token*` paths, so raw tokens can't leak to JS.
  - It rejects dot-segment and encoded-slash paths.
  - It refuses cross-origin non-GET requests, so browse via `localhost`, not `127.0.0.1`.
  - It caps bodies at 12 MB.
  - It times out after 10 s.
- **No CORS on Django,** since browsers never call it directly.
- **The rate limit works per browser IP** only because of this hop (`X-Forwarded-For` from `TRUSTED_PROXY_IPS`).

- **Error bodies never reach the UI raw (defence in depth):**
  - The gateway (`relay()` in `lib/server/session.ts`) replaces any non-JSON error from Django with a generic JSON `{"detail": …}`. Django's DEBUG traceback page, with settings and paths in it, never leaves the Next server.
  - The client (`request()` in `lib/api.ts`) reads an error body only when it's JSON. It uses only a short plain-text `detail`; everything else gets a status-based sentence from `lib/http-errors.ts`. `ApiError.message` is never the raw body.
  - `StatePlaceholder` clamps its text to three lines as a last line of defence. No component uses `dangerouslySetInnerHTML`.
- **Unapplied migrations fail `check --deploy`** (`core/checks.py`, `core.E001`), so a release can't start ahead of its migrations. `runserver` only prints a warning, and a WSGI server says nothing.

### 3.3 Design system

- **Fonts:** Plus Jakarta Sans for UI, Geist Mono for codes.
- **Colours:** CSS variables with light and dark sets, contrast-audited to WCAG AA. Navy `#233d4d`, brand orange `#fe7f2d` with black text on it, and a deeper-orange focus ring.
- **Motion:** one easing curve, `EASE = [0.22, 1, 0.36, 1]`; springs only for hover pops; `prefers-reduced-motion` gets a short fade.
- **Components:** shadcn/ui on `@base-ui/react`, with `lucide-react` icons.

### 3.4 Shared UI patterns

- **Tables** (tickets, lookups, team activity):
  - Sortable headers with `SortIcon` and `aria-sort`.
  - 250 ms debounced search.
  - Previous data stays visible while refetching.
  - `aria-busy` while loading.
  - Distinct "nothing yet" and "no matches" states.
- **Breadcrumbs:** one shared `components/layout/breadcrumb.tsx` above every page title except Home's. Job Sheets and Working Hours didn't have one before.
- **Row actions stay in view:** in the Lookups and Administration tables, the actions column is pinned to the right edge (`sticky right-0`), so Edit, Delete and Deactivate are reachable when a narrow screen scrolls the table sideways. Tickets keep theirs as the first column.
- **Table scroll regions are `relative`,** so screen-reader-only text inside cells is clipped with the table. Before this, it leaked out and made the whole page scroll sideways on tablets.
- **Popovers that hold a small form** (the date/time picker, ticket quick-add) trap focus (`modal="trap-focus"` plus a `PopoverClose` part), so Tab can't fall off the end of the page.
- **Load errors use `LoadErrorPlaceholder` everywhere** (offline vs. the API's message, plus retry). Job Sheets was aligned to this in this audit.
- **Shared cells** live in `components/tickets/cells.tsx`. `Dash` now gives screen readers real "No value" text; an `aria-label` on a plain span isn't reliably read, fixed here.
- **Dialogs:**
  - One dialog serves create and edit, remounted by `key` each time it opens.
  - Server errors are mapped back onto fields.
  - Deletes are confirmed with `AlertDialog`, and success is a Sonner toast.
- **Work-log entry rows:** `CategoryPill` and `FromTicketBadge` (`components/job-sheets/day-entries.tsx`) are shared by the Job Sheet and the Reports drill-down, so a fix to one reaches both. `FromTicketBadge` is now a real button.
- **The generic Lookups page** (`LookupConfig<Row>`): a new reference-data page is one config file.

### 3.5 Time and date rules (re-verified across all four places)

Every entry has a stored calendar `date` plus local start and end times. All four features filter on that stored date, so **they can never disagree about which day an entry belongs to.** The only zone-dependent choice is which day counts as "today":

| Where | Anchor |
|---|---|
| Working Hours periods ("Today", "This week"…) | The **viewer's** profile zone |
| Job Sheets default day, "no future days", Log Hours' default date | The **viewer's** profile zone |
| Reports default range (current month) | The **viewer's** profile zone |
| Auto-sync: which date an activity lands on | The **resolver's** profile zone, when synced |

So an admin in Kuala Lumpur and a staff member in Malé can see a different "today" for the same entries. That's by design and documented in each API. The one real mismatch is the ticket form, which uses the browser's zone, not the profile's (gap #17).

---

## 4. Current state of quality

### 4.1 Tests and checks (run 2026-09-27, final pre-deployment review)

| Check | Result |
|---|---|
| `python manage.py check` | No issues |
| `python manage.py check --deploy` (DEBUG off) | 1 warning, W004 HSTS, which is deliberately opt-in. **No issues** once HSTS is set as documented for go-live. |
| Migrations | 43 migrations apply cleanly to an empty **SQLite** database (42 were also verified on **PostgreSQL 16.2** in the upgrade pass); `makemigrations --check` is clean; no model table missing; `check --deploy` now fails on any unapplied migration (`core.E001`) |
| Fresh-database reachability | On that empty database, every page's data requests (Tickets, Lookups ×5, Working Hours, Job Sheets, Reports ×2, Administration, Audit Log, 25 endpoints) answer 2xx, both empty and with rows in every table |
| Backend suite, SQLite | **292 tests, all pass** |
| Backend suite, PostgreSQL 16.2 | **292 tests, all pass** (via `DATABASE_URL`, final pre-deployment review) |
| Fresh PostgreSQL database | 43 migrations apply; `seed_users`, `seed_tickets_support_data`, `seed_work_logs` and `sync_ticket_work_logs` run clean (the sync is idempotent and rebuilds deleted auto entries); the dev-only seeds refuse to run with DEBUG off; the reachability sweep passes on PostgreSQL as well as SQLite |
| Redis unreachable (measured) | Refused port and unroutable host both: sign-in, exports and admin writes answer 503 JSON in ~2 s, the log names Redis, everything else stays 200; `check --deploy` reports `core.E003` |
| Frontend `typecheck` / `lint` / `format:check` | All clean |
| Production `next build` | Succeeds; all 14 pages prerender |
| Headless walkthroughs | Every page, both roles, light and dark, at 768 / 1024 / 1440 px: no page or content-area horizontal overflow; every keyboard focus stop visibly changes; all dialogs and popovers trap focus, close on Esc and return focus |
| Auth lifecycle through the real frontend + gateway | 19/19 (previous pass) |
| Bad-response sweep (headless) | Every page's API calls were answered with an HTML 500 debug page, an HTML 502 proxy page, JSON of an unexpected shape, and a 200 with an HTML body (48 page loads), plus the Team Activity tab and a failing save. Every one showed a short generic message (≤ 87 chars); none showed raw content |
| Audit Log walkthrough (headless) | A filtered Export CSV download matched the on-screen rows exactly (10/10, same order); a staff sidebar has neither Administration nor Audit Log, both pages show "Admins only", and all audit/admin APIs answer 403 |

**Backend tests by module:**
- `working_hours`: 77 (`tests.py` 51, `test_auto_entries.py` 22, `test_commands.py` 4)
- `tickets`: 58
- `accounts`: 45 (`tests.py` 25, `test_administration.py` 20)
- `lookups`: 30
- `reports`: 24
- `core`: 22 (`tests.py` 7, `test_end_to_end.py` 4, `test_hardening.py` 11)
- `audit`: 36 (`tests.py` 30, `test_flows.py` 6: real sign-in, then each walkthrough flow read back through the audit API and CSV)

**Coverage added in the Audit Log pass:** every wired action's entry (description, actor, target, metadata); what's deliberately not logged; staff 403 on all three endpoints; every filter, ordering and bad-input 400; the CSV (headers, filename, formula guard, filters) and its throttle; a failing log write not breaking the action; the password never reaching any field; the prune command.

**Coverage added in the upgrade pass:**
- **Administration:** the full permission matrix; create, edit, deactivate, reactivate, role change and password reset (including session revocation); username uniqueness; weak passwords; the self-lockout guard; throttling.
- **Downloads and throttles:** authenticated PDF downloads (and that `/media/` serves nothing); the export throttle.
- **Configuration:** the `DATABASE_URL` parser.
- **Query counts:** one constant-count check per list endpoint. A missing `select_related` fails the test.
- **An explicit role-visibility test:** staff can't reach team activity, anyone else's hours or Job Sheet, the staff list, or any Administration endpoint.

**Not covered:** there are still no automated frontend tests and no CI (gap #4). The gateway, the auth route handlers and layout are verified by headless-browser runs only.

### 4.2 Known gaps & deferred items

Severity: **H** = must fix before real use, **M** = should fix soon, **L** = polish. Effort: S / M / L.

Reconciled with the final pre-deployment review:
- **Closed:** #1's code side (Redis now fails closed and clearly, with explicit 2 s timeouts and a deploy check; only verifying against a real Redis in staging remains) and #18 (a deactivated person's Job Sheet now names them, marked "(deactivated)", and hides Log Hours).
- **Fixed, with causes:**
  - **"Last sign-in" in Administration always said "Never".** SimpleJWT only records `last_login` with `UPDATE_LAST_LOGIN`, which was off, so only Django-admin logins set it. It's on now, with a test.
  - **The frontend's `.env.local.example` was never in git.** `frontend/.gitignore`'s `.env*` matched it, so a fresh clone had no example to copy despite the README's instructions. It's now excluded from that rule.

Reconciled with the consolidation audit:
- **Fixed and removed:** #20 (there is now an audit log of admin actions, and of everything else).
- **Fixed, with causes:**
  - **Raw error pages rendered in the UI.** `lib/api.ts` fell back to the raw response body as `ApiError.message`, so a Django DEBUG traceback (settings, paths, part of the `SECRET_KEY`) showed as page text. Now the gateway replaces any non-JSON error, and the client only ever shows a short plain `detail` or a status-based sentence (§3.2).
  - **A migration shipped but not applied (audit table missing, 500 on the Audit Log).** Nothing checked the migration state outside `runserver`'s console warning, and the best-effort audit writes failed quietly meanwhile. `check --deploy` now fails on pending migrations (`core.E001`).
  - **Client IP not validated.** Any `X-Forwarded-For` from the Next server was trusted verbatim, and the gateway forwarded the browser's header as-is. Garbage or a spreadsheet formula could reach the audit log's IP column (the CSV didn't guard it), and a new junk value per request minted a fresh sign-in throttle key. Now both the gateway (`clientAddress()`) and Django (`client_ip()`) accept only a well-formed IP, and the CSV guards the IP column too.
  - **A server blip during token refresh signed people out.** The refresh route treated any non-502 failure (e.g. a Django 500) as "session over" and cleared the cookies, and the client fired "session expired" on any refresh failure, 502 included. Now only a refused refresh token ends a session; anything else is a normal "unavailable" error.
- **Added:** #25, #26, marked _new_.

Reconciled with the upgrade pass:
- **Fixed and removed:** SQLite-only (PostgreSQL is now supported and verified); unauthenticated PDF serving (now an authenticated view); the per-process throttle cache (Redis is configurable); user management only in Django admin (Administration); every nav item shown to staff (Administration is now hidden from them).
- **Added:** #9, #20–#24, marked _new_.

| # | Item | Sev | Effort |
|---|---|---|---|
| 1 | **Redis unverified against a real server** (no Redis was available here). The failure mode is handled and measured (503 in ~2 s, log names Redis, `check --deploy` fails with `core.E003`); verify the happy path in staging. Once `REDIS_URL` is set, Redis is required: if it's down, rate-limited endpoints, sign-in included, fail. | M | S |
| 2 | **Uploaded PDFs on local disk** (`backend/media/`). They need persistent storage and backups in production, or object storage (S3 or similar) if the app runs on several machines. | M | S–M |
| 3 | **HSTS is off until deploy.** Set `SECURE_HSTS_SECONDS` (Django) and `HSTS_MAX_AGE` (Next) once HTTPS is confirmed everywhere. | M (at deploy) | S |
| 4 | **No frontend tests and no CI.** At minimum, run the backend suite and typecheck/lint/format/build in CI. | M | M |
| 5 | **Ticket permissions are flat:** any signed-in user can edit or close any ticket. This was deliberate and is revisitable. | M | S–M |
| 6 | **Refresh-token rotation is off,** by design for multi-tab use. | L | M |
| 7 | **No optimistic concurrency on tickets** (last write wins). | L | M |
| 8 | **No ticket deletion.** Confirm this is intended. | L | S |
| 9 | _new_ **No self-service password change, and no "must change on first login".** An admin sets the password and passes it on; the user can't change it themselves. This needs a change-password endpoint and page (plus an optional forced-change flag). | M | M |
| 10 | **Holidays aren't used by anything:** goals ignore holidays and weekends. | M | M |
| 11 | **Email is unconfigured;** no features send mail. | L | S |
| 12 | **Hardcoded choice lists** (ticket type, channel, activity type) are duplicated between Django and the frontend. | L | S–M |
| 13 | **Overlapping entries are accepted and counted twice** (auto + manual covering the same minutes). Only the 24 h daily cap applies. | M | M |
| 14 | **Auto entries are clipped at 11:59 PM** in the resolver's zone, and a 1-minute activity at 11:59 PM gets no entry. | L | M |
| 15 | **Auto-entry dates are fixed at sync time:** a time-zone change moves existing ones only after `sync_ticket_work_logs`. | L | S |
| 16 | **Auto-entry hours come from the activity's times, not an explicit `duration_minutes` override** (API-only). | L | S |
| 17 | **Browser zone vs. profile zone:** the ticket form uses the browser's zone, while work logs use the profile's. | M | M |
| 18 | **A deactivated user's Job Sheet is reachable only by URL** (they're left out of the picker, like everywhere else). It now names them, marked "(deactivated)". | L | S |
| 19 | **Team Activity covers staff only** (admins' own resolved time isn't in it). By design; confirm. | L | S |
| 21 | _new_ **The app's admin role and Django's `/admin/` access are separate.** Promoting someone in Administration doesn't give them the Django admin site (`is_staff`), and vice versa. This is intended, but worth knowing. | L | S |
| 22 | _new_ **CSV formula guard** prefixes innocent text starting with `-` or `+` with `'` (the standard safe trade-off). | L | S |
| 23 | _new_ **The per-entry `hours` column is rounded to 0.01 h.** Every total in the app uses exact minutes; only outside tools summing the column would drift. | L | S |
| 24 | **The dev server didn't hot-reload the shared gateway module** (`src/lib/server/session.ts`). After server-side frontend changes, restart `npm run dev`. Development only. | L | S |
| 25 | _new_ **Next.js must sit behind a proxy that sets `X-Forwarded-For`.** Next only fills the header when it's absent, so if Next faces the internet directly, a client can claim any well-formed IP. That weakens the per-IP half of the sign-in limit (5 tries per claimed IP) and the audit log's IP column. Behind nginx or a load balancer that appends the header (the normal TLS setup), it's correct. If direct exposure is ever needed, add a per-username ceiling. | M (at deploy) | S |
| 26 | _new_ **Audit log indexes are single-column** (`created_at`, `actor`, `action`, target). They're fine at this team's volume; add composite `(actor, created_at)` / `(action, created_at)` if the table reaches millions of rows. | L | S |

### 4.3 Real vs. mocked / hardcoded

| Area | Status |
|---|---|
| Auth, roles, user search, Administration | Real |
| Audit Log (list, filters, CSV, retention command) | Real |
| AMS Tickets (including PDF download) | Real |
| Lookups (5) | Real |
| Working Hours, Job Sheets, the auto-sync | Real (goals are fixed constants) |
| Reports (both tabs, both CSVs) | Real |
| Ticket type / channel / activity-type lists | Hardcoded and duplicated (gap #12) |
| **Home dashboard** | **Mock** (`src/lib/mock-data.ts`, marked "Sample data") |

---

## 5. What's NOT built yet

- **Home dashboard, real data:** the UI is done, but its data is mock. Reports' endpoints and the exact-minute totals (`working_hours/totals.py`) are the natural source for it.
- **Self-service account settings:** changing one's own password and time zone (gap #9).

---

## 6. How to run it

### Prerequisites
Node.js 20+, Python 3.11+ (the local venv runs 3.14), git.

### Backend (Django, port 8000)
```bash
cd backend
python -m venv venv
# activate: source venv/bin/activate   |  PowerShell: .\venv\Scripts\Activate.ps1
pip install -r requirements.txt
cp .env.example .env        # Windows: copy .env.example .env  (every setting is documented there)
```
In `.env`, set `SECRET_KEY` to a real random value and keep `DEBUG=True` for development (the seeds need it). Then:
```bash
python manage.py migrate
python manage.py seed_users                  # dev users (resets their passwords)
python manage.py seed_tickets_support_data   # countries, sites, customers, work-done codes, holidays (safe to re-run)
python manage.py seed_work_logs              # ~90 days of manual Non-AMS hours per staff user (replaces manual entries)
python manage.py runserver 8000
```
- **PostgreSQL instead of SQLite:** set `DATABASE_URL=postgres://…` in `.env` (see `.env.example`). The commands above then run against it unchanged. The production checklist is in the README.
- **AMS hours are never seeded:** they come from ticket activities with a resolver. Create tickets in the UI.
- **After importing activities,** run `python manage.py sync_ticket_work_logs`. It's safe anywhere and rebuilds auto entries.
- **Health check:** `curl http://localhost:8000/api/ping/`. Django admin is at `/admin/`.

### Frontend (Next.js, port 3000)
```bash
cd frontend
npm install
cp .env.local.example .env.local   # DJANGO_API_URL=http://127.0.0.1:8000/api (server-side only)
npm run dev
```
- **Open `http://localhost:3000`**, not `127.0.0.1`: the gateway refuses cross-origin writes.
- **After changing server-side gateway code** (`src/lib/server/`, `src/app/api/`), **restart `npm run dev`.** In this project it didn't reliably hot-reload that shared server module.

Other scripts: `npm run build`, `lint`, `typecheck`, `format`, `format:check`.

### Dev credentials (from `seed_users`)

All passwords are `password123`.

| Username | Role | Time zone |
|---|---|---|
| `admin` | admin (also a Django superuser) | Asia/Kuala_Lumpur |
| `syed` | staff | Asia/Kuala_Lumpur |
| `naleefa` | staff | Asia/Manila |
| `wahida` | staff | Indian/Maldives |

### Running the checks
```bash
cd backend && python manage.py check && python manage.py test        # 249 tests (add DATABASE_URL=… to run them on PostgreSQL)
cd frontend && npm run typecheck && npm run lint && npm run format:check
```
