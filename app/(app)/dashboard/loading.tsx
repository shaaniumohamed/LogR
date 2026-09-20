import { SkeletonChart, SkeletonControls, SkeletonGrid, SkeletonHeadline, SkeletonStats } from "@/components/skeleton";

export default function Loading() {
  return (
    <div className="space-y-4">
      <SkeletonControls />
      <SkeletonHeadline />
      <SkeletonStats />
      <SkeletonGrid />
      <SkeletonChart h={120} />
    </div>
  );
}
