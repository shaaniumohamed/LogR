import { SkeletonControls, SkeletonGrid, SkeletonList, SkeletonStats } from "@/components/skeleton";

export default function Loading() {
  return (
    <div className="space-y-4">
      <SkeletonControls />
      <SkeletonGrid />
      <SkeletonStats />
      <SkeletonList rows={6} />
    </div>
  );
}
