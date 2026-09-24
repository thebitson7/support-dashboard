import { getDashboardData } from "@/lib/mock-data";
import { DashboardSections } from "@/components/dashboard/dashboard-sections";
import { MotionRoot } from "@/components/dashboard/motion-root";
import { Badge } from "@/components/ui/badge";

export default function Home() {
  // Mock data today; swap getDashboardData() for real API calls later.
  const data = getDashboardData();

  return (
    <MotionRoot>
      {/* `@container`: columns react to the space next to the sidebar, so
          collapsing/expanding it reflows the grids correctly. */}
      <div className="@container mx-auto flex w-full max-w-7xl flex-col gap-6">
        <header className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight">Dashboard</h1>
            <p className="text-label">Work hours and ticket activity at a glance</p>
          </div>
          <Badge variant="outline">Sample data</Badge>
        </header>

        <DashboardSections data={data} />
      </div>
    </MotionRoot>
  );
}
