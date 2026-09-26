# Support Dashboard — frontend

Next.js (App Router) + TypeScript + Tailwind CSS v4 + shadcn/ui. See the root
`README.md` for the full project overview.

## Scripts

| Command                | What it does                           |
| ---------------------- | -------------------------------------- |
| `npm run dev`          | Start the dev server on port 3000      |
| `npm run build`        | Production build                       |
| `npm run lint`         | ESLint                                 |
| `npm run typecheck`    | `tsc --noEmit`                         |
| `npm run format`       | Format `src/` and config with Prettier |
| `npm run format:check` | Verify formatting (used in CI)         |

## Environment

Copy `.env.local.example` to `.env.local` and set `DJANGO_API_URL` (defaults to
`http://127.0.0.1:8000/api`). It is server-side only: the browser only ever calls
this app's own `/api/*` routes, which forward to Django with the session cookie
turned into a Bearer token (see `src/lib/server/session.ts`).

## Layout

- `src/app/` — routes (Home dashboard, AMS Tickets, Lookups, login, placeholder pages), `error.tsx` boundaries
- `src/app/api/` — auth route handlers (login/refresh/logout) and the gateway to Django
- `src/proxy.ts` — server-side route guard (signed-out visitors go to `/login`)
- `src/components/layout/` — sidebar and theme toggle
- `src/components/dashboard/` — Home dashboard sections
- `src/components/tickets/` — AMS Tickets table (TanStack Table v9) and the New/Edit Ticket dialog
- `src/components/lookups/` — the shared table + dialog behind the five Lookups pages
- `src/components/common/` — shared form pieces (search combobox, date-time picker, fields)
- `src/components/ui/` — shadcn/ui primitives
- `src/components/job-sheets/`, `src/components/reports/`, `src/components/working-hours/` — Job Sheets, Reports and Working Hours pieces
- `src/lib/` — API client (incl. CSV downloads), auth context, date helpers, motion helpers, Home mock data
- `src/config/nav.ts` — sidebar navigation (single source of truth)

Everything is live API data except the Home dashboard, which still renders
mock data from `src/lib/mock-data.ts`;
each module exposes a single seam to swap for real API calls.
