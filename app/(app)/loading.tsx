import { SkeletonControls, SkeletonHeadline, SkeletonStats, SkeletonChart } from "@/components/skeleton";

/** The fallback for any screen without a shape of its own. */
export default function Loading() {
  return (
    <div className="space-y-4">
      <SkeletonControls />
      <SkeletonHeadline />
      <SkeletonStats />
      <SkeletonChart />
    </div>
  );
}
