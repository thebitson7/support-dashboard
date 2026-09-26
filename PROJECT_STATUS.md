# Project Status — Support Dashboard

_Snapshot as of 2026-09-26, after the pre-production audit. Covers every commit through `c392914` plus the uncommitted Job Sheets, Reports and audit work in the working tree. Checked against the code, the full Django suite, `check --deploy`, `tsc`, `eslint` and `prettier`, and end-to-end runs through the real frontend and gateway._

---

## 1. Overview

The Support Dashboard is an internal tool for a support team. It covers:
- **AMS support tickets,** from receipt, through activities, to verified closure.
- **Logged work:** AMS time captured automatically from ticket activities, and Non-AMS time logged by hand, shown per day (Job Sheets) and per period against goals (Working Hours).
- **Reporting** across tickets and the team's logged work, with CSV exports.
- **The reference data** tickets depend on.

**Stack**
- **Frontend:** Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4, shadcn/ui on Base UI, TanStack Table v9, Recharts, Framer Motion, Sonner toasts.
- **Backend:** Django 6.1, Django REST Framework, SQLite (dev; see gap #1).
- **Auth:** SimpleJWT. The tokens live in httpOnly cookies owned by the Next.js server, which forwards calls to Django with a Bearer header. The browser never talks to Django directly.

**Current state:** every data-backed feature is real:
- **AMS Tickets:** list, create, edit, close/reopen.
- **Lookups:** five CRUD pages.
- **Working Hours:** period summaries.
- **Job Sheets:** one person's day, auto AMS plus manual Non-AMS.
- **Reports:** All Tickets and Team Activity, both with CSV export.

The **Home dashboard** still runs on mock data. **Administration** is the only placeholder left. The backend suite has 218 tests, all passing. Typecheck, lint and formatting are clean, and the migration history applies cleanly to an empty database. It's ready for the data wipe and production prep, subject to the high-severity gaps in §4.2.

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
- **Every nav item is visible to every role** (gap #12).

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
- **Rate limiting:** 5 attempts per 5 minutes per (username + client IP), returning 429 with `Retry-After`. `X-Forwarded-For` is trusted only from `TRUSTED_PROXY_IPS`.
- **Deactivation takes effect immediately:** sign-in, existing access tokens and refresh all stop working.
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
- The PDF attachment is checked by its magic bytes and limited to 10 MB.
- **Any signed-in user may list, create and edit any ticket** (gap #5). There is no ticket delete (gap #8).
- **Site and customer quick-add is admin-only,** matching Lookups. Staff get search plus an "ask an admin" hint.
- **Date-times in the form use the browser's zone** (gap #19).

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
  - Past midnight it is clipped to 11:59 PM (gap #16); under a minute, it gets no entry.
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

---

## 3. Cross-cutting systems

### 3.1 Permission / role model

- **Every role-gated endpoint uses a shared class** from `accounts/permissions.py`, with no inline role checks (re-verified in this audit):
  - `IsAdminRole`: admin-only endpoints (the staff list, reports).
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
- **Gateway guards:**
  - It refuses `auth/token*` paths, so raw tokens can't leak to JS.
  - It rejects dot-segment and encoded-slash paths.
  - It refuses cross-origin non-GET requests, so browse via `localhost`, not `127.0.0.1`.
  - It caps bodies at 12 MB.
  - It times out after 10 s.
- **No CORS on Django,** since browsers never call it directly.
- **The rate limit works per browser IP** only because of this hop (`X-Forwarded-For` from `TRUSTED_PROXY_IPS`).

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

So an admin in Kuala Lumpur and a staff member in Malé can see a different "today" for the same entries. That's by design and documented in each API. The one real mismatch is the ticket form, which uses the browser's zone, not the profile's (gap #19).

---

## 4. Current state of quality

### 4.1 Tests and checks (run 2026-09-26, after the audit)

| Check | Result |
|---|---|
| `python manage.py check` | No issues |
| `python manage.py check --deploy` (DEBUG off) | 1 warning: W004 HSTS, deliberately opt-in at deploy time (gap #14) |
| Migrations from scratch | 41 migrations apply cleanly to an empty DB; `working_hours` rolls back to zero and forward again; `makemigrations --check` is clean |
| Backend `python manage.py test` | **218 tests, all pass** |
| Frontend `npm run typecheck` / `lint` / `format:check` | All clean; no `any`, double casts or non-null assertions left |
| Auth lifecycle through the real frontend + gateway | 19/19 checks (headless Chrome) |

**Backend tests by module:**
- `working_hours`: 77 (`tests.py` 51, `test_auto_entries.py` 22, `test_commands.py` 4)
- `tickets`: 58
- `lookups`: 30
- `reports`: 24
- `accounts`: 23
- `core`: 6 (`tests.py` 2, `test_end_to_end.py` 4)

**What they cover:**
- Auth: tokens, blacklist, inactive users, rate limiting and IP spoofing.
- Every permission path.
- Ticket validation, totals, verification, multipart PDFs, and the list's filter/sort/search/paging.
- Lookups' permissions, 409s and normalisation.
- Working-hours entries: validation, the midnight rule, and the 24 h cap.
- The auto-sync: create, update, resolver change, clear, delete, zones, clipping, and the backfill.
- Reports: aggregation, ranges, deactivation, and both CSVs (escaping, BOM, formula guard, minutes).
- The seed commands and the dev-only guard.
- **Cross-layer end-to-end tests** (`core/test_end_to_end.py`): one ticket activity agrees across the ticket total, the Job Sheet, the Working Hours summary and Reports; manual entries are Non-AMS everywhere; deactivation; both CSVs against the database.

**Not covered:** there are no automated frontend tests and no CI (gap #4). The gateway, the auth route handlers and layout are verified manually and in headless-browser runs only.

### 4.2 Known gaps & deferred items

Severity: **H** = must fix before real use, **M** = should fix soon, **L** = polish. Effort: S / M / L. The previous list was reconciled with this audit:
- **Fixed and removed:** the old #9 (no way to edit older entries; Job Sheets now covers any day), #14 (README drift) and #15 (`.env.example` incomplete).
- **Added:** #14–#23, marked _new_ below.

| # | Item | Sev | Effort |
|---|---|---|---|
| 1 | **SQLite.** Move to PostgreSQL before real use. The ticket row lock and the duration aggregation are already written to work there. | H | M |
| 2 | **Uploaded PDFs are served without auth, in DEBUG only** (`config/urls.py`). Production needs an authenticated download view, and none exists; there's also no download link in the UI. | H | M |
| 3 | **The login throttle uses a per-process `LocMemCache`.** It needs a shared cache (Redis) once there is more than one API process. | M (H at scale) | S |
| 4 | **No frontend tests and no CI.** At minimum, run the backend suite and typecheck/lint/format in CI; then add gateway/auth route tests. | M | M |
| 5 | **Ticket permissions are flat:** any signed-in user can edit or close any ticket. This was deliberate and is revisitable. | M | S–M |
| 6 | **Refresh-token rotation is off,** by design for multi-tab use. | L | M |
| 7 | **No optimistic concurrency on tickets:** concurrent edits are last-write-wins, with no warning. | L | M |
| 8 | **No ticket deletion** (API or UI). Confirm this is intended. | L | S |
| 9 | **User management exists only in Django admin:** roles, time zones, activation, passwords. This becomes Administration (§5). | M | M |
| 10 | **Holidays aren't used by anything:** goals ignore holidays and weekends. | M | M |
| 11 | **The sidebar shows every page to every role,** including Administration to staff. | L | S |
| 12 | **Email is unconfigured** (console in dev); no features send mail yet. | L | S |
| 13 | **Hardcoded choice lists:** ticket type, channel and activity type are duplicated in `tickets/models.py` and `form-model.ts`. | L | S–M |
| 14 | _new_ **HSTS is off until deploy.** Set `SECURE_HSTS_SECONDS` once HTTPS is confirmed everywhere; it's hard to undo. | M (at deploy) | S |
| 15 | _new_ **Overlapping entries are accepted and counted twice:** for example, an auto entry and a manual entry covering the same minutes. Only the 24 h daily cap applies. | M | M |
| 16 | _new_ **Auto entries are clipped at 11:59 PM:** an activity running past midnight in the resolver's zone loses the time after it on their work log (the ticket total keeps it), and a 1-minute activity at 11:59 PM gets no entry at all. This follows from "one entry per activity, entries never cross midnight". | L | M |
| 17 | _new_ **Auto-entry dates are fixed at sync time:** changing someone's profile time zone only moves their existing auto entries after `sync_ticket_work_logs` is run. | L | S |
| 18 | _new_ **Auto-entry hours come from the activity's times, not `duration_minutes`.** If an activity's duration was overridden explicitly (the API allows it; the UI doesn't), its work-log time and the ticket total can differ. | L | S |
| 19 | _new_ **Browser zone vs. profile zone.** The ticket form enters times in the browser's zone, while work logs and summaries use the profile zone. For a user whose browser and profile zones differ, an activity entered as 9:00 appears at a different local time on their Job Sheet. | M | M |
| 20 | _new_ **A deactivated user's Job Sheet can only be reached by URL:** pickers leave them out, the header can't name them, and "Log Hours" shows but the save is refused (404). Their history is readable (§3.1). | L | S |
| 21 | _new_ **Team Activity covers staff only.** An admin's own resolved-ticket time isn't in the overview. This is by design; confirm. | L | S |
| 22 | _new_ **The CSV formula guard also prefixes innocent text starting with `-` or `+`** (e.g. a note "-5 °C drift") with `'`. This is the standard safe trade-off. | L | S |
| 23 | _new_ **The per-entry `hours` column is still rounded to 0.01 h.** It's only shown per entry now, since every total is exact minutes, but anything outside the app that sums it will drift. | L | S |

### 4.3 Real vs. mocked / hardcoded

| Area | Status |
|---|---|
| Auth, roles, user search | Real |
| AMS Tickets | Real |
| Lookups (5) | Real |
| Working Hours, Job Sheets, the auto-sync | Real (goals are fixed constants) |
| Reports (both tabs, both CSVs) | Real |
| Ticket type / channel / activity-type lists | Hardcoded and duplicated (gap #13) |
| **Home dashboard** | **Mock** (`src/lib/mock-data.ts`, marked "Sample data") |
| Administration | Placeholder |

---

## 5. What's NOT built yet

- **Administration** (`/administration`, still "coming soon"): in-app user management (create/deactivate, role, time zone, password reset), replacing Django admin (gap #9). It should be admin-only in both the API and the nav (gap #11).
- **Home dashboard, real data:** the UI is done, but its data is mock. Reports' endpoints and the exact-minute totals are the natural source for it.

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
cd backend && python manage.py check && python manage.py test        # 218 tests
cd frontend && npm run typecheck && npm run lint && npm run format:check
```
