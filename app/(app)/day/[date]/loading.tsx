import { SkeletonCard, SkeletonChart, SkeletonHeadline, SkeletonList, SkeletonStats, Bar } from "@/components/skeleton";

export default function Loading() {
  return (
    <div className="space-y-4">
      <SkeletonCard>
        <div className="flex items-center justify-between">
          <Bar w="36px" h={32} r={8} />
          <Bar w="50%" h={16} />
          <Bar w="36px" h={32} r={8} />
        </div>
      </SkeletonCard>
      <SkeletonHeadline />
      <SkeletonStats />
      <SkeletonChart h={132} />
      <SkeletonList rows={6} />
    </div>
  );
}
