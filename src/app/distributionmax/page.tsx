import DistributionMax from "@/components/DistributionMax";
import { getDashboardData } from "@/lib/source";

export const dynamic = "force-dynamic";

export default async function Page() {
  return <DistributionMax initial={await getDashboardData()} />;
}
