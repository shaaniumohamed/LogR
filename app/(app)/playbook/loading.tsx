import { SkeletonCard, SkeletonControls, SkeletonStats, Bar } from "@/components/skeleton";

export default function Loading() {
  return (
    <div className="space-y-4">
      <SkeletonControls />
      {[0, 1].map((i) => (
        <SkeletonCard key={i}>
          <Bar w="38%" h={11} />
          <Bar w="90%" h={14} />
          <Bar w="100%" h={40} r={8} />
          <SkeletonStats />
        </SkeletonCard>
      ))}
    </div>
  );
}
