import { SkeletonCard, SkeletonList, Bar } from "@/components/skeleton";

export default function Loading() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <Bar w="190px" h={34} r={10} />
        <Bar w="120px" h={26} r={8} />
      </div>
      <SkeletonCard>
        <Bar w="42%" h={9} />
        <Bar w="80%" h={14} />
        <Bar w="100%" h={8} r={4} />
      </SkeletonCard>
      <SkeletonList rows={8} />
    </div>
  );
}
