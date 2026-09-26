# Project Status — Support Dashboard

_Snapshot as of 2026-09-26. Covers commits `bb33334` → `ddac754` plus the uncommitted Lookups/audit work in the working tree. Checked against the code, `manage.py test`, `tsc`, `eslint` and `prettier`._

---

## 1. Overview

The Support Dashboard is an internal tool for a support team. It tracks AMS support tickets (from receipt, through activities, to verified closure), shows each person's logged working hours against goals, and manages the reference data tickets depend on (sites, customers, countries, work-done codes, holidays).

**Stack**
- **Frontend:** Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4, shadcn/ui on Base UI, TanStack Table v9, Recharts, Framer Motion, Sonner toasts.
- **Backend:** Django 6.1, Django REST Framework, SQLite (dev).
- **Auth:** SimpleJWT. The tokens live in httpOnly cookies owned by the Next.js server, which forwards calls to Django with a Bearer header. The browser never talks to Django directly.

**Current state:** the core infrastructure is done: auth, role model, API gateway, design system, and the shared table/dialog patterns. Three data-backed features are fully real: **User Working Hours** (summary plus in-app logging), **AMS Tickets** (list, create, edit, close/reopen) and **Lookups** (five CRUD pages). The **Home dashboard** is fully built as UI but still runs on **mock data**. **Reports, Job Sheets and Administration** are "coming soon" placeholders. The backend suite (156 tests) passes, and typecheck and lint are clean. The project is ready for the next feature phase.

---

## 2. Feature-by-feature breakdown

### 2.1 Project scaffold & conventions

**What it is:** a two-part repo. `backend/` is a Django API and `frontend/` is a Next.js app.

**Decisions worth remembering**
- **Backend: one Django app per domain area.** The apps are `core` (ping health check, shared `DevOnlyCommand`), `accounts`, `working_hours`, `tickets` and `lookups`. Each app has its own `urls.py`, mounted under `/api/<area>/` in `config/urls.py`. There are two exceptions:
  - Auth is mounted at `/api/auth/`.
  - User search is mounted at `/api/accounts/users/`.
- **Reference-data models live in the `tickets` app, not `lookups`.** Country, Site, Customer, WorkDoneCode and Holiday are defined in `tickets/models.py`, because tickets reference them. The `lookups` app holds only the management API (serializers and viewsets).
- **Settings come from env vars** via `backend/.env`:
  - `SECRET_KEY` is required, and startup fails loudly without it.
  - `DEBUG` is off unless set.
  - HTTPS hardening switches on automatically when `DEBUG` is off.
- **Private by default:** the DRF default permission is `IsAuthenticated`. Only `/api/ping/` and the token endpoints opt out.
- **Seed commands refuse to run with `DEBUG` off.** They inherit `core/management.py → DevOnlyCommand` because they reset passwords or replace data.
- **Frontend: all API calls go through `src/lib/api.ts`** (`apiGet`/`apiPost`/`apiDelete`/`apiFetch`), with `useApiGet` in `src/hooks/use-api.ts` for components. No component calls `fetch()` directly.
- **Tooling:** Prettier, ESLint, and a `typecheck` script. There is no CI configuration in the repo.

### 2.2 Sidebar & theming

**What it does:** a dark navy sidebar holds every section of the app. It can collapse to an icon rail, and it remembers that choice. The Lookups group expands to show its six pages. The bottom of the sidebar shows who is signed in (initials avatar, name, role badge) with a sign-out menu. A theme toggle flips between light and dark. The app starts by following the operating system's theme (next-themes `defaultTheme="system"`).

**Decisions**
- `src/config/nav.ts` is the **single source of truth** for navigation.
- The collapsed state persists in `localStorage` (`sidebar-collapsed`). It is applied without animation on load.
- **Every nav item is visible to every role**, including Administration. The sidebar does no role-based hiding yet.

**Files:** `components/layout/sidebar.tsx`, `components/layout/theme-toggle.tsx`, `components/theme-provider.tsx` (next-themes, class strategy).

### 2.3 Home dashboard

**What it does:** an at-a-glance page with these sections:
- KPI cards
- Period cards (Today / Yesterday / week / month hours vs. goal, split into AMS and Non-AMS)
- Weekly-hours chart
- Ticket-status donut
- Recent activity feed
- Top sites
- A small mascot

It has a choreographed entrance animation and a loading skeleton.

**Important:** everything on this page is **mock data**. The header shows a visible "Sample data" badge. `src/app/page.tsx` calls `getDashboardData()` from `src/lib/mock-data.ts`, which is the single seam to swap for real API calls. The dates are hardcoded to late September 2026.

**Decisions:** grids use CSS container queries (`@container`), so they reflow when the sidebar collapses. Empty-data edge cases are guarded (zero goal, empty charts).

**Files:** `components/dashboard/*` (about 15 small components), `types/dashboard.ts`, `lib/motion.ts`.

### 2.4 Authentication (login, JWT, cookies, roles)

**What it does:** users sign in with a username and password. A signed-out visitor to any page is sent to `/login`, and after signing in they return to the page they asked for. Sign-out ends the session on the server too. Repeated wrong guesses are rate limited.

**Decisions**
- **Cookie-held JWTs.** `sd_access` and `sd_refresh` are httpOnly, `SameSite=Lax`, and `Secure` in production. Each cookie expires with its token.
- **Token lifetimes:** access tokens last 5 minutes and refresh tokens 1 day.
  - **Refresh rotation is deliberately off.** Several tabs refreshing at once would otherwise log each other out.
  - Logout **blacklists** the refresh token.
- **Two guard layers:**
  - `src/proxy.ts` (Next's Proxy, formerly "middleware") is the primary guard. It optimistically checks the refresh cookie's expiry before any page renders.
  - The client-side `AppShell` guard is the second layer.
  - Django still verifies every token on every call.
- **Rate limiting:** `LoginRateThrottle` allows 5 attempts per 5 minutes, keyed on **username + client IP** (hashed), with the username case-insensitive. It returns 429 with `Retry-After`. `X-Forwarded-For` is trusted only from `TRUSTED_PROXY_IPS`.
- **Deactivation takes effect immediately.** Inactive users can't sign in, their existing access tokens stop working, and refresh fails.
- **Role model:** `User.role` is `staff` or `admin`. It is deliberately separate from Django's `is_staff`/`is_superuser`, which only govern `/admin/`. See §3.1.
- **Every user has a `timezone`** (an IANA name, validated). The default is `Asia/Kuala_Lumpur`.
- **The frontend's API client handles expiry.** It refreshes an expired session once (single-flight) and retries the request. It throws a typed `ApiError` with `status`, `message` and `retryAfterSeconds`.

**Files:**
- Backend: `accounts/` (`models.py`, `permissions.py`, `throttling.py`, `views.py`).
- Frontend: `app/login/page.tsx`, `app/api/auth/{login,refresh,logout}/route.ts`, `lib/server/session.ts`, `lib/auth.tsx`, `lib/safe-redirect.ts`, `proxy.ts`, `components/auth/app-shell.tsx`.

### 2.5 User Working Hours (Lookups → User Working Hours)

**What it does:** shows logged hours for six periods: Today, Yesterday, Current Week, Last Week, Current Month and Previous Month. Each period shows the AMS/Non-AMS split, a goal, and percent complete. Staff see only their own hours. Admins pick any active staff member from a list.

**Decisions**
- **Periods are cut in the viewer's time zone, not the target user's.** An admin in Kuala Lumpur looking at a Manila staff member sees "today" as Kuala Lumpur's today. The response includes the zone used, and the page says so.
- **Weeks run Monday–Sunday.**
- **Goals are fixed constants:** 8 h per day, 40 h per week, 176 h per month (`working_hours/periods.py`). Percent complete can exceed 100.
- All six periods are computed in **one aggregate query**.
- **Permissions:**
  - Staff are 403'd if they name another user.
  - Admins must supply `user_id`, and a malformed id returns 400, not 500.
  - Deactivated users return 404, even for admins.
  - The staff list is admin-only and excludes admins and inactive users.
- `WorkLogEntry.user` uses `on_delete=PROTECT`. People who have logged hours can only be deactivated, never deleted.
- **Logging hours in the app:** a **Log Hours** button in the page header opens a small dialog: date (defaults to today), AMS/Non-AMS, hours (quarter-hour steps) and an optional note. A **Today's entries** card lists the day's entries with edit and delete.
  - Staff log only for themselves. Admins log for the staff member they've selected, and the dialog names that person.
  - The API is `/api/working-hours/entries/` (+ `<id>/`). "Whose entry" is `?user_id=` with exactly the summary's rules, never a body field. Someone else's entry is a 403.
  - Validation: hours must be above 0 and at most 24 per entry, and a day's entries can't total more than 24 h. A future date (in the viewer's zone) is refused. An omitted date means the viewer's today.
  - Saving refreshes the period cards and the list together. A test proves logged entries appear in the summary totals.

**Files:**
- Backend: `working_hours/` (`models.py`, `periods.py`, `views.py`).
- Frontend: `app/lookups/user-working-hours/page.tsx`, `components/working-hours/user-picker.tsx`, `lib/working-hours.ts`.

### 2.6 AMS Tickets (list + create/edit)

**What it does:**
- **The list** is an 11-column table of all tickets. It is paginated, sortable and searchable on the server. Advanced filters cover status, site and received-date range.
- **"New Ticket" and each row's Edit action** open a three-tab dialog:
  - **Ticket:** details, the PDF attachment, and assignment/forwarding.
  - **Activities:** time-stamped work entries, each with a work-done code.
  - **Ticket Verification:** the closing fields.
- **Filling in verification closes a ticket, and clearing it reopens the ticket.**

**Decisions**
- **Status is derived, not stored.** A ticket is "closed" exactly when `cms_closed_on` is set.
- **Verification is all-or-nothing.** The five fields must be all empty (open) or all filled (closed). A partial set is rejected field by field. Clearing all five reopens the ticket.
- **The server computes the total duration once activities exist.** With one or more activities, `total_duration_hours` is the sum of their durations, and any client-sent total is ignored. With zero activities, the manually entered total stands.
  - Each activity's duration is computed from start/end unless one is given explicitly.
- **Activities are replaced as a set.** On edit, the list sent becomes the full set of activities. On PATCH, omitting the key leaves activities untouched.
- **Create/update runs in one transaction,** so an invalid activity rolls back the whole ticket. Updates take a row lock: concurrent edits are last-write-wins, with no duplicated activities.
- **`created_by` is always the authenticated user** and can never change.
- **Forwarding:** "forwarded" requires a recipient. Un-forwarding clears it.
- **Deactivated users can't be newly assigned** to any user field.
- **PDF attachment:**
  - Optional, up to 10 MB.
  - Checked by the `%PDF-` magic bytes as well as the extension.
  - Sent as multipart, where `activities` travels as JSON.
  - A replaced or removed file is deleted after the transaction commits.
  - The edit form shows only the file's name. There is no download link.
- **Any signed-in user may list, create and edit any ticket.** This is a deliberate, revisitable decision, commented in `tickets/views.py`. There is **no delete endpoint** for tickets.
- **Site and customer typeahead and quick-add:**
  - The typeahead shows active sites only.
  - Admins can quick-add a site (name + OCN) or a customer (name) with the "+" button, without leaving the form. **Quick-add is admin-only**, the same rule as the Lookups pages. Staff get search only, plus an "Ask an admin to add a new site/customer" hint while the field is empty.
- **The list response includes an unfiltered `total`,** so the UI can tell "no tickets yet" from "no matches."
- **Date-times:**
  - The form stores `YYYY-MM-DDTHH:mm` in the **browser's** zone (`lib/local-datetime.ts`) and sends ISO/UTC.
  - The date-time picker is custom-built (`components/common/date-time-picker.tsx`).
- **Server errors map back onto fields.** Tabs with errors show an indicator.
- **No tickets are seeded.** The table starts empty on a fresh database.

**Files:**
- Backend: `tickets/` (`models.py`, `serializers.py`, `views.py`, `admin.py`).
- Frontend: `components/tickets/` (`tickets-page`, table/config/toolbar/pagination, `ticket-form/*` with a React-free `form-model.ts`), `lib/tickets-api.ts`, `components/common/search-combobox.tsx`.

### 2.7 Lookups (Sites, Customers, Countries, Work Done Codes, Holidays)

**What it does:** five reference-data pages, each with search, sortable columns, and add/edit/delete dialogs.
- Everyone can view them.
- Only admins see the Add, Edit and Delete controls. The API enforces the same rule.

**Decisions**
- **Deletion is blocked while a record is in use.** Deleting a record that other data references returns **409** with a plain-language count, for example "This site is used by 3 tickets and can't be deleted. Deactivate it instead." It never returns a 500.
  - Sites and Work Done Codes suggest deactivating instead.
  - Countries suggest reassigning or deleting the dependants first.
- **Deactivation instead of deletion:**
  - Inactive **sites** disappear from the ticket form's typeahead but stay on the Sites page and on existing tickets.
  - Inactive **work-done codes** can't be picked for new activities but still label existing ones.
- **Normalisation and uniqueness:**
  - Country codes must be two letters, stored in uppercase.
  - OCNs and work-done codes are uppercased.
  - Uniqueness is checked case-insensitively *after* normalising: country name and code, site (name + OCN) pairs, work-done code, and holiday (name + date + country).
  - The model's `save()` also normalises countries, so the admin and shell can't bypass it.
- **Holidays:**
  - A holiday with no country is **global** (company-wide).
  - `is_recurring_annually = True` means only the month and day matter, and the stored year is ignored. Holidays that move each year (Eid, Lunar New Year) are entered once per year.
  - The default sort is calendar order (month, day).
- **Holidays are stored but not yet used anywhere.** They don't affect working-hours goals or any other calculation.
- The API is `/api/lookups/{countries,sites,work-done-codes,holidays}/`: unpaginated, with `?search=` and `?ordering=`, and no PUT (PATCH only).
- **Customers** have a name only (unique, case-insensitive) and no active flag. So a customer with tickets can't be deleted (409, "Move those tickets to another customer first").

**Files:**
- Backend: `lookups/` (one `LookupViewSet` base class plus five subclasses; serializers).
- Frontend: `app/lookups/{sites,countries,work-done-codes,holidays}/page.tsx`, where each page is just a config object, and `components/lookups/` (the generic page + dialog, see §3.4).

---

## 3. Cross-cutting systems

### 3.1 Permission / role model

- **Two application roles:** `staff` (the default) and `admin`, stored in `User.role`. Django's `is_staff`/`is_superuser` flags are unrelated and only open `/admin/`.
- **The backend enforces permissions,** via three shared DRF permission classes in `accounts/permissions.py`:
  - `IsAdminRole`: admin-only endpoints, e.g. the working-hours staff list.
  - `IsAdminRoleOrSelf`: admins may target any user, while staff may target only themselves. Naming anyone else returns 403 rather than silently showing the user their own data.
  - `IsAdminRoleOrReadOnly`: reads for everyone signed in, writes for admins. Used by all Lookups endpoints.
- **What each area allows:**

  | Area | Staff | Admin |
  |---|---|---|
  | Tickets | Full list / create / edit | Same |
  | Site / customer quick-add (from the ticket form) | Refused (403) | Allowed |
  | Lookups (Sites, Customers, Countries, Work Done Codes, Holidays) | Read only | Read + write |
  | Logging / editing hours | Own entries only | Any active user's |
  | Working hours | Own data only | Any active staff member |
  | User search (`/api/accounts/users/`) | Allowed | Allowed |

  User search returns names and ids only (no role or zone), so it can't be used to list the admins.
- **The frontend mirrors the rules for display only.** It hides the Lookups management controls and switches the working-hours view by `user.role`. The API remains the authority.
- **User references across the project use `PROTECT`.** People are deactivated, never deleted, once they own history.

### 3.2 API gateway & cookie-auth architecture

```
Browser ──(same origin, httpOnly cookies)──▶ Next.js server ──(Bearer token)──▶ Django /api/
```

- `/api/auth/login | refresh | logout` are dedicated route handlers. They call Django's token endpoints and set or clear the cookies. The browser only ever receives the user object, never the raw tokens.
- `/api/[...path]` is a generic gateway. It forwards method, body (as raw bytes, so multipart survives) and content type, turns the access cookie into a Bearer header, and relays only the status, body and `Retry-After`. Its guards:
  - It refuses Django's `auth/token*` paths, so tokens can't leak to JS.
  - It rejects dot-segment and encoded-slash paths.
  - It refuses cross-origin non-GET requests (a CSRF defence on top of `SameSite=Lax`).
  - It caps bodies at 12 MB.
  - It times out after 10 s and maps an unreachable API to 502.
- **Django has no CORS configuration,** because browsers never call it directly. `DJANGO_API_URL` is server-side only.
- **Login rate limiting depends on this hop.** It works per browser IP because the gateway forwards `X-Forwarded-For` and Django trusts that header only from `TRUSTED_PROXY_IPS`.

### 3.3 Design system

- **Fonts:** Plus Jakarta Sans (UI, weights 400–800) and Geist Mono (codes and OCNs), loaded via `next/font`.
- **Colours** are CSS variables in `app/globals.css`, with light and dark sets:
  - Navy `#233d4d` for foreground and sidebar, on a light grey `#eaecf0` background.
  - The brand accent is orange `#fe7f2d`, with **black** text on orange for contrast.
  - The focus ring is a deeper orange `#c4540f`.
  - Dedicated tokens cover open/closed status, chart colours (success, info, violet) and the form-control border.
  - Colour pairs were contrast-audited to WCAG AA in the code-review pass.
- **Motion:**
  - `lib/motion.ts` defines one shared easing curve, `EASE = [0.22, 1, 0.36, 1]`, used everywhere.
  - Springs (`SPRING_POP`) are reserved for small hover "pops."
  - The dashboard has an entrance-choreography clock whose delays collapse to 0 for content that scrolls in late.
  - `prefers-reduced-motion` gets a short fade with no travel.
- **Component base:** shadcn/ui components built on `@base-ui/react`, in `components/ui/`. Icons come from `lucide-react`.

### 3.4 Shared UI patterns

- **Tables** (tickets and lookups share the same look):
  - Clickable sortable headers use the shared `SortIcon`.
  - Search is debounced by 250 ms.
  - Previous data stays visible while refetching (`keepPreviousData`), and the table scroll region is marked `aria-busy` while loading.
  - Empty and error states distinguish "nothing yet" from "no matches for X" (with Clear search), and load errors offer Retry (`components/common/state-placeholder.tsx`).
  - Shared cell renderers live in `components/tickets/cells.tsx`: `TextCell`, `FlagCell`, `Dash`.
- **Dialogs:**
  - One dialog handles both create and edit. It is remounted with a fresh `key` each time it opens, so no stale state carries over.
  - Server field errors are mapped back onto their inputs.
  - Delete uses an `AlertDialog` confirmation, which shows a 409 "in use" message inline.
  - Success is announced with Sonner toasts.
  - Form fields share `components/common/form-field.tsx`.
- **The generic Lookups component:**
  - `components/lookups/lookup-page.tsx` + `lookup-form-dialog.tsx` are driven by a typed `LookupConfig<Row>` (`types.ts`). A config lists the title, endpoint, columns (with `sortKey`, which may be multi-key such as `"month,day"`), form fields (`text` / `select` / `switch` / `date`, with hints, uppercase and mono options, and validate-while-typing), row label, dimming rule, and `deactivateField`.
  - A new reference-data page is a single config file.
  - Shared bits such as `COUNTRY_OPTIONS`, `CountryCell` and `ActiveBadge` live in `components/lookups/shared.tsx`.
- **Search comboboxes** (`components/common/search-combobox.tsx`) are used for every "Search users/sites/customers…" field.

---

## 4. Current state of quality

### 4.1 Tests and checks (run 2026-09-26)

| Check | Result |
|---|---|
| Backend `python manage.py test` | **156 tests, all pass** (~140 s) |
| `makemigrations --check` | No pending model changes |
| Frontend `npm run typecheck` | Clean |
| Frontend `npm run lint` | Clean |
| Frontend `npm run format:check` | Clean (after running `npm run format` on 2 files) |

**Backend tests by app:**
- `tickets`: 58
- `working_hours`: 43
- `lookups`: 30
- `accounts`: 23
- `core`: 2

**What the tests cover:**
- Auth: tokens, refresh, blacklist, inactive users, the rate limit including forwarded-IP spoofing, timezone validation, user search.
- Working hours: every permission path for the summary and entry endpoints, entry validation (hours bounds, 24 h daily cap, future dates), logged hours showing up in the summary, period boundaries (including January → December), and time-zone boundaries for viewer vs. target.
- Tickets:
  - Create and update validation.
  - Nested activities and duration/total rules.
  - Verification all-or-nothing and close → reopen → close.
  - Forwarding rules.
  - Multipart PDF upload, replace and remove.
  - List pagination, sorting, filters and search.
  - 400-not-500 on malformed input.
  - Concurrent-edit last-write-wins.
  - Site/customer quick-add: staff refused (403), admin allowed.
- Lookups (including Customers): permission matrix, search/order, protected-delete 409s, normalisation and uniqueness, typeahead visibility of inactive records.

**What the tests don't cover:**
- **The frontend has no tests at all:** no unit, component or E2E tests, and no test runner is installed.
- The Next.js gateway, auth route handlers and `proxy.ts` are untested. They're verified only manually and through TypeScript.
- Seed commands are untested.
- There is no CI, so none of the checks above run automatically.

### 4.2 Known gaps & deferred items

> **Note on provenance:** the running "deferred items" lists from the earlier auth-hardening and audit conversations aren't preserved anywhere in the repo or in project memory. The list below was **rebuilt from the code as it stands** (comments, settings, missing endpoints and pages). Please cross-check it against your own notes from those sessions and add anything missing.

Severity: **H** = must fix before real use, **M** = should fix soon, **L** = polish. Effort: S / M / L.

| # | Item | Sev | Effort |
|---|---|---|---|
| 1 | **SQLite database.** Swap to PostgreSQL before real use. The ticket row lock is already written for it and is a no-op on SQLite. | H | M |
| 2 | **Uploaded PDFs are served without auth, in DEBUG only** (`config/urls.py`). Production needs an authenticated download view, and none exists. There is also no download link in the UI. | H | M |
| 3 | **Login throttle uses per-process `LocMemCache`.** It needs a shared cache (Redis/Memcached) once there is more than one API process. | M (H at scale) | S |
| 4 | **No frontend tests and no CI.** At minimum, run typecheck/lint/format/backend tests in CI, then add tests for the gateway and auth route handlers. | M | M |
| 5 | **Ticket permissions are flat.** Any signed-in user can edit any ticket, including closing it. This was a deliberate decision, flagged as revisitable. | M | S–M |
| 6 | **Refresh-token rotation is off,** by design for multi-tab use. Revisit if the security posture demands it (would need a race-tolerant scheme). | L | M |
| 7 | **No optimistic concurrency on tickets.** Concurrent edits are last-write-wins, with no "someone else changed this" warning. | L | M |
| 8 | **No ticket deletion** (neither API nor UI). This may be intended; confirm. | L | S |
| 9 | **No history view for working-hours entries.** Only today's entries can be edited in the app. Older entries need Django admin, or changing the date in an entry before it leaves today's list. | L–M | M |
| 10 | **Holidays aren't used by anything yet.** Goals are fixed at 8/40/176 h and ignore holidays and weekends. | M | M |
| 11 | **User management exists only in Django admin:** role, timezone, activation, passwords. There is no self-service time-zone change either. | M | M (→ Administration) |
| 12 | **The sidebar shows Administration (and every page) to staff.** There is no role-based nav hiding. | L | S |
| 13 | **Email is unconfigured.** It uses the console backend in dev and needs SMTP settings in production. No features send mail yet. | L | S |
| 14 | **Docs drift:** the root README still says the home page shows a live "Connected" ping badge (it doesn't). Its app-structure section describes tickets as a "future" app and omits `working_hours`/`lookups`. The frontend README still lists the deleted `mock-tickets.ts` as a data source. | L | S |
| 15 | **`.env.example` lists only `SECRET_KEY`, `DEBUG` and `ALLOWED_HOSTS`.** The other supported variables aren't documented there: `LOGIN_THROTTLE_RATE`, `TRUSTED_PROXY_IPS`, `SECURE_SSL_REDIRECT`, `SECURE_HSTS_SECONDS`, `EMAIL_BACKEND`. | L | S |

### 4.3 Real vs. mocked / hardcoded

| Area | Status |
|---|---|
| Auth, roles, user search | Real |
| User Working Hours | Real: summary and logging. Goals are hardcoded constants. |
| AMS Tickets list / create / edit / close | Real |
| Sites, Customers, Countries, Work Done Codes, Holidays | Real (DB-backed, full CRUD) |
| **Ticket Type, Incoming Channel, Activity Type choice lists** | **Hardcoded,** not database-driven. They're defined twice: as Django `TextChoices` in `tickets/models.py` and mirrored by hand in `components/tickets/ticket-form/form-model.ts`. The two lists must be kept in sync manually. |
| **Home dashboard** (all sections) | **Mock:** `src/lib/mock-data.ts`, with a "Sample data" badge |
| Reports, Job Sheets, Administration | Placeholder "coming soon" cards |

---

## 5. What's NOT built yet

Each of these routes renders only a "— coming soon" card. **The code contains no spec for them,** so the one-line expectations below are inferred from the product context and **should be confirmed** before work starts.

- **Reports** (`/reports`): reporting over real ticket and work-log data, e.g. ticket volumes and durations by site, period or person, and hours vs. goals. This is also the natural source for replacing the Home dashboard's mock data.
- **Job Sheets** (`/job-sheets`): a record of work done per job or visit. It would likely build on ticket activities (on-site visits, work-done codes, durations) and might later tie activity time to logged hours.
- **Administration** (`/administration`): in-app management of users (create/deactivate, role, time zone, password reset), replacing the current reliance on Django admin (gap #11). It should be admin-only in both the API and the nav.

---

## 6. How to run it

### Prerequisites
- Node.js 20+
- Python 3.11+ (the local venv currently runs 3.14)
- git

### Backend (Django, port 8000)
```bash
cd backend
python -m venv venv
# activate: source venv/bin/activate   |  PowerShell: .\venv\Scripts\Activate.ps1
pip install -r requirements.txt
cp .env.example .env        # Windows: copy .env.example .env
```

Edit `.env`:
- Set `SECRET_KEY` to a real random value. You can generate one with:
  ```bash
  python -c "from django.core.management.utils import get_random_secret_key; print(get_random_secret_key())"
  ```
- Keep `DEBUG=True`. The seed commands refuse to run without it.

Then:
```bash
python manage.py migrate
python manage.py seed_users                  # dev users (resets their passwords)
python manage.py seed_work_logs              # ~90 days of hours for staff users (replaces existing entries; --days N, --seed N)
python manage.py seed_tickets_support_data   # countries, sites, customers, work-done codes, holidays (safe to re-run)
python manage.py runserver 8000
```
Check it with `curl http://localhost:8000/api/ping/`, which should return `{"status": "ok", "message": "pong"}`. Django admin is at `http://localhost:8000/admin/`.

No tickets are seeded. Create them through the UI.

### Frontend (Next.js, port 3000)
```bash
cd frontend
npm install
cp .env.local.example .env.local   # sets DJANGO_API_URL=http://127.0.0.1:8000/api (server-side only)
npm run dev
```
Open `http://localhost:3000`. You'll be redirected to `/login`.

Other scripts: `npm run build`, `lint`, `typecheck`, `format`, `format:check`.

### Dev credentials (from `seed_users`)

All passwords are `password123`.

| Username | Role | Time zone | Notes |
|---|---|---|---|
| `admin` | admin | Asia/Kuala_Lumpur (default) | Also a Django superuser (`/admin/`) |
| `syed` | staff | Asia/Kuala_Lumpur | |
| `naleefa` | staff | Asia/Manila | |
| `wahida` | staff | Indian/Maldives | |

The staff time zones differ on purpose, so period boundaries can be seen to differ.

### Running tests
```bash
cd backend && python manage.py test          # 156 tests
cd frontend && npm run typecheck && npm run lint && npm run format:check
```
