import { getDashboardData } from "@/lib/mock-data";
import { NeedsClosingBox } from "@/components/attention/needs-closing-box";
import { DashboardSections } from "@/components/dashboard/dashboard-sections";
import { MotionRoot } from "@/components/dashboard/motion-root";
import { Badge } from "@/components/ui/badge";

export default function Home() {
  // The sections below "Overview" are still mock data; swap getDashboardData()
  // for real API calls later. "Needs closing" above them is live.
  const data = getDashboardData();

  return (
    <MotionRoot>
      {/* `@container`: columns react to the space next to the sidebar, so
          collapsing/expanding it reflows the grids correctly. */}
      <div className="@container mx-auto flex w-full max-w-7xl flex-col gap-6">
        <header>
          <h1 className="text-2xl font-extrabold tracking-tight">Dashboard</h1>
          <p className="text-label">Work hours and ticket activity at a glance</p>
        </header>

        {/* Live data (GET /api/tickets/attention/), labelled "Live" itself. */}
        <NeedsClosingBox />

        {/* The "Sample data" badge is scoped to this section only, so it can't
            be read as covering the live box above. */}
        <section aria-labelledby="overview-title" className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="overview-title" className="text-title">
              Overview
            </h2>
            <Badge variant="outline">Sample data</Badge>
          </div>
          <DashboardSections data={data} />
        </section>
      </div>
    </MotionRoot>
  );
}
