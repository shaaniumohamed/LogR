import { SkeletonCard, Bar } from "@/components/skeleton";

export default function Loading() {
  return (
    <div className="space-y-5">
      <Bar w="100%" h={42} r={12} />
      <div className="space-y-2">
        <Bar w="46%" h={20} />
        <Bar w="92%" h={12} />
      </div>
      <SkeletonCard>
        <Bar w="30%" h={9} />
        <Bar w="100%" h={60} r={10} />
      </SkeletonCard>
    </div>
  );
}
