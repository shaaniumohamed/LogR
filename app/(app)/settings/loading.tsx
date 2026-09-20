import { SkeletonCard, Bar } from "@/components/skeleton";

export default function Loading() {
  return (
    <div className="space-y-4">
      <SkeletonCard>
        {[0, 1, 2].map((i) => (
          <div key={i} className="space-y-1.5 py-1">
            <Bar w="42%" h={13} />
            <Bar w="70%" h={10} />
          </div>
        ))}
      </SkeletonCard>
      <SkeletonCard>
        <Bar w="32%" h={9} />
        <Bar w="100%" h={44} r={8} />
      </SkeletonCard>
    </div>
  );
}
