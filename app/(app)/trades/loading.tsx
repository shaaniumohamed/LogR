import { SkeletonControls, SkeletonList, SkeletonStats, Bar } from "@/components/skeleton";

export default function Loading() {
  return (
    <div className="space-y-4">
      <SkeletonControls />
      <Bar w="100%" h={46} r={12} />
      <SkeletonStats cols={3} />
      <SkeletonList rows={10} />
    </div>
  );
}
