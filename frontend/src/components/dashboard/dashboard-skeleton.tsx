import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "cn";

// Placeholder shapes that mirror each real card (same grid, same padding, same
// minimum heights), so the swap to real content doesn't shift the layout.

const shell = "[--card-spacing:--spacing(5)] shadow-elev-1 px-(--card-spacing)";
const pulse = "motion-reduce:animate-none";

function Bar({ className }: { className?: string }) {
  return <Skeleton className={cn(pulse, "rounded-full", className)} />;
}

function KpiSkeleton() {
  return (
    <Card className={cn(shell, "h-[172px] justify-between")}>
      <div className="flex items-center gap-3">
        <Skeleton className={cn(pulse, "size-11 rounded-full")} />
        <Bar className="h-3.5 w-28" />
      </div>
      <div className="grid gap-3">
        <Bar className="h-9 w-24 rounded-lg" />
        <Bar className="h-5 w-32" />
      </div>
    </Card>
  );
}

function PeriodSkeleton() {
  return (
    <Card className={cn(shell, "h-[208px]")}>
      <div className="flex items-center gap-3">
        <Skeleton className={cn(pulse, "size-11 rounded-full")} />
        <div className="grid gap-2">
          <Bar className="h-4 w-28" />
          <Bar className="h-3 w-20" />
        </div>
      </div>
      <Bar className="h-9 w-48 rounded-lg" />
      <Bar className="h-4 w-56" />
      <div className="mt-auto flex items-center gap-3">
        <Bar className="h-2.5 flex-1" />
        <Bar className="h-4 w-9" />
      </div>
    </Card>
  );
}

/** The six period cards' grid; also used on its own by User Working Hours. */
export function PeriodCardsSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 @xl:grid-cols-2 @4xl:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <PeriodSkeleton key={i} />
      ))}
    </div>
  );
}

function ChartSkeleton({ className }: { className?: string }) {
  return (
    <Card className={cn(shell, "min-h-[380px] gap-4", className)}>
      <div className="flex items-center gap-2">
        <Skeleton className={cn(pulse, "size-7 rounded-lg")} />
        <Bar className="h-4 w-32" />
      </div>
      <Skeleton className={cn(pulse, "min-h-56 flex-1 rounded-xl")} />
    </Card>
  );
}

function ListSkeleton({ rows, className }: { rows: number; className?: string }) {
  return (
    <Card className={cn(shell, "min-h-[420px] gap-5", className)}>
      <div className="flex items-center gap-2">
        <Skeleton className={cn(pulse, "size-7 rounded-lg")} />
        <Bar className="h-4 w-32" />
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className={cn(pulse, "size-8 shrink-0 rounded-full")} />
          <div className="grid flex-1 gap-2">
            <Bar className="h-3.5 w-3/4" />
            <Bar className="h-3 w-1/3" />
          </div>
        </div>
      ))}
    </Card>
  );
}

export function DashboardSkeleton() {
  return (
    <div
      className="flex flex-col gap-6"
      role="status"
      aria-busy="true"
      aria-label="Loading dashboard"
    >
      <div className="grid grid-cols-1 gap-4 @xl:grid-cols-2 @4xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <KpiSkeleton key={i} />
        ))}
      </div>
      <PeriodCardsSkeleton />
      <div className="grid grid-cols-1 gap-4 @4xl:grid-cols-5">
        <ChartSkeleton className="@4xl:col-span-3 @4xl:min-h-[438px]" />
        <ListSkeleton rows={3} className="@4xl:col-span-2 @4xl:min-h-[438px]" />
      </div>
      <div className="grid grid-cols-1 gap-4 @4xl:grid-cols-5">
        <ListSkeleton rows={6} className="@4xl:col-span-3 @4xl:min-h-[523px]" />
        <ListSkeleton rows={6} className="@4xl:col-span-2 @4xl:min-h-[523px]" />
      </div>
    </div>
  );
}
