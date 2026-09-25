# Support Dashboard

Support Ticket & Work Stats Dashboard — internal redesign.

## Tech stack

- **Frontend**: Next.js (App Router) + TypeScript + Tailwind CSS + shadcn/ui, `recharts`, `@tanstack/react-table`
- **Backend**: Django + Django REST Framework, `django-cors-headers`, `djangorestframework-simplejwt`

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

With the backend running on port 8000 and the frontend on port 3000, open `http://localhost:3000` — the home page performs a live connectivity check against the backend's `/api/ping/` endpoint and shows a "Connected" badge with the backend's response once it succeeds.

## Backend app structure convention

The Django project follows one app per domain area:

- `core` — cross-cutting endpoints not tied to a specific domain (e.g. the `/api/ping/` health check).
- `accounts` — users, authentication (custom `User` model, JWT token endpoints).
- Future domain areas (e.g. tickets) get their own app the same way.

Each app owns its own `urls.py`, included from `config/urls.py` under `/api/<app-name>/` (accounts' auth endpoints are the one exception, mounted at `/api/auth/` since `POST /api/auth/token/` reads better than `/api/accounts/token/`). Models, serializers, and views for a domain area live inside that app — avoid putting unrelated logic in `core`.

## Frontend API client convention

All API calls go through `src/lib/api.ts` (`apiGet`, `apiPost`, or the underlying `apiFetch<T>`) rather than calling `fetch()` directly in components. It calls this app's own `/api/*` routes (never Django directly), parses JSON, refreshes an expired session once (single-flight) and throws a typed `ApiError` (with `status`, `message`, and `retryAfterSeconds` on 429) on non-2xx responses.

**Auth:** the JWTs live in httpOnly cookies set by the Next.js route handlers in `src/app/api/auth/{login,refresh,logout}`; `src/app/api/[...path]` forwards everything else to Django (`DJANGO_API_URL`, server-side only) with the access cookie as a Bearer header. `src/proxy.ts` redirects signed-out visitors to `/login` before any page renders. Logout blacklists the refresh token; sign-in is rate limited per username + IP (`LOGIN_THROTTLE_RATE`, default `5/5m`).
