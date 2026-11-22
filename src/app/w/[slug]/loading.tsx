import { Skeleton } from "@/components/ui/skeleton";

export default function LoadingWorkspacePage() {
  return (
    <div role="status" aria-label="Loading workspace" className="space-y-5">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-48 w-full rounded-[28px]" />
    </div>
  );
}
