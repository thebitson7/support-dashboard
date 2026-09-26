# Support Dashboard

Support Ticket & Work Stats Dashboard — internal redesign.

## Tech stack

- **Frontend**: Next.js (App Router) + TypeScript + Tailwind CSS + shadcn/ui, `recharts`, `@tanstack/react-table`
- **Backend**: Django + Django REST Framework, `djangorestframework-simplejwt`

## Project structure

```
support-dashboard/
├── backend/     # Django + DRF API
└── frontend/    # Next.js app
```

## Prerequisites

- Node.js 20+
- Python 3.11+
- git

## Backend setup (Django)

```bash
cd backend
python -m venv venv
```

Activate the virtual environment:

- **macOS/Linux**: `source venv/bin/activate`
- **Windows (PowerShell)**: `.\venv\Scripts\Activate.ps1`
- **Windows (cmd.exe)**: `venv\Scripts\activate.bat`

Install dependencies:

```bash
pip install -r requirements.txt
```

Create your local environment file:

```bash
cp .env.example .env   # Windows: copy .env.example .env
```

Fill in `SECRET_KEY` in `.env` with a real random value (e.g. `python -c "from django.core.management.utils import get_random_secret_key; print(get_random_secret_key())"`), leave `DEBUG=True` for local dev.

Run migrations and start the dev server:

```bash
python manage.py migrate
python manage.py seed_users                  # local dev users (password123)
python manage.py seed_tickets_support_data   # countries, sites, customers, work-done codes, holidays
python manage.py seed_work_logs              # ~90 days of manual (Non-AMS) hours per staff user
python manage.py runserver 8000
```

The API is now available at `http://localhost:8000/api/`. Verify with:

```bash
curl http://localhost:8000/api/ping/
# {"status": "ok", "message": "pong"}
```

## Frontend setup (Next.js)

```bash
cd frontend
npm install
```

Create your local environment file:

```bash
cp .env.local.example .env.local   # Windows: copy .env.local.example .env.local
```

Start the dev server:

```bash
npm run dev
```

The app is now available at `http://localhost:3000`.

## Running both together

With the backend running on port 8000 and the frontend on port 3000, open `http://localhost:3000` and sign in (e.g. `admin` / `password123` after `seed_users`). Use `localhost`, not `127.0.0.1`: the API gateway refuses cross-origin writes, and Next reports its origin as `localhost`.

The seed commands are for local development only and refuse to run with `DEBUG` off. AMS hours are never seeded: they come only from ticket activities that have a resolver. To (re)build those work-log entries from existing activities, e.g. after a data import, run `python manage.py sync_ticket_work_logs` (safe in any environment).

## Backend app structure convention

The Django project follows one app per domain area:

- `core` — cross-cutting pieces: the `/api/ping/` health check, CSV export helpers, the dev-only command guard.
- `accounts` — users, roles, authentication (custom `User` model, JWT token endpoints, shared permission classes).
- `tickets` — AMS tickets and their activities, plus the reference data they use (countries, sites, customers, work-done codes, holidays).
- `lookups` — the management API for that reference data.
- `working_hours` — work-log entries (manual Non-AMS, and AMS mirrored from ticket activities), period summaries, Job Sheet data.
- `reports` — read-only, report-shaped views (team activity) over the other apps' data.

Each app owns its own `urls.py`, included from `config/urls.py` under `/api/<app-name>/` (accounts' auth endpoints are the one exception, mounted at `/api/auth/` since `POST /api/auth/token/` reads better than `/api/accounts/token/`). Models, serializers, and views for a domain area live inside that app — avoid putting unrelated logic in `core`.

## Frontend API client convention

All API calls go through `src/lib/api.ts` (`apiGet`, `apiPost`, or the underlying `apiFetch<T>`) rather than calling `fetch()` directly in components. It calls this app's own `/api/*` routes (never Django directly), parses JSON, refreshes an expired session once (single-flight) and throws a typed `ApiError` (with `status`, `message`, and `retryAfterSeconds` on 429) on non-2xx responses.

**Auth:** the JWTs live in httpOnly cookies set by the Next.js route handlers in `src/app/api/auth/{login,refresh,logout}`; `src/app/api/[...path]` forwards everything else to Django (`DJANGO_API_URL`, server-side only) with the access cookie as a Bearer header. `src/proxy.ts` redirects signed-out visitors to `/login` before any page renders. Logout blacklists the refresh token; sign-in is rate limited per username + IP (`LOGIN_THROTTLE_RATE`, default `5/5m`).
