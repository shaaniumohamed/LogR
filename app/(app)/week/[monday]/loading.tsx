import { SkeletonBars, SkeletonCard, SkeletonHeadline, SkeletonStats, Bar } from "@/components/skeleton";

export default function Loading() {
  return (
    <div className="space-y-4">
      <SkeletonCard>
        <div className="flex items-center justify-between">
          <Bar w="36px" h={32} r={8} />
          <Bar w="55%" h={16} />
          <Bar w="36px" h={32} r={8} />
        </div>
      </SkeletonCard>
      <SkeletonHeadline />
      <SkeletonStats />
      <SkeletonBars rows={5} />
      <SkeletonCard>
        <Bar w="30%" h={9} />
        <Bar w="100%" h={120} r={10} />
      </SkeletonCard>
    </div>
  );
}
