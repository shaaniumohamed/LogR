import { SkeletonBars, SkeletonControls, SkeletonHeadline } from "@/components/skeleton";

export default function Loading() {
  return (
    <div className="space-y-4">
      <SkeletonControls />
      <SkeletonHeadline />
      <SkeletonBars rows={4} />
      <SkeletonBars rows={6} />
      <SkeletonBars rows={5} />
    </div>
  );
}
