import { SkeletonCard, SkeletonChart, SkeletonStats, Bar } from "@/components/skeleton";

export default function Loading() {
  return (
    <div className="space-y-4">
      <Bar w="40%" h={12} />
      <SkeletonCard>
        <div className="flex items-start justify-between gap-3">
          <Bar w="42%" h={16} />
          <Bar w="24%" h={22} />
        </div>
        <SkeletonStats />
      </SkeletonCard>
      <SkeletonChart h={320} />
      <SkeletonCard>
        <Bar w="40%" h={9} />
        <Bar w="100%" h={90} r={10} />
      </SkeletonCard>
    </div>
  );
}
