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

Copy `.env.local.example` to `.env.local` and set `NEXT_PUBLIC_API_URL`
(defaults to `http://localhost:8000/api`).

## Layout

- `src/app/` — routes (Home dashboard, AMS Tickets, placeholder pages), `error.tsx` boundaries
- `src/components/layout/` — sidebar and theme toggle
- `src/components/dashboard/` — Home dashboard sections
- `src/components/tickets/` — AMS Tickets table (TanStack Table v9)
- `src/components/ui/` — shadcn/ui primitives
- `src/lib/` — API client, mock data generators, motion helpers
- `src/config/nav.ts` — sidebar navigation (single source of truth)

Data is currently mocked (`src/lib/mock-data.ts`, `src/lib/mock-tickets.ts`);
each module exposes a single seam to swap for real API calls.
