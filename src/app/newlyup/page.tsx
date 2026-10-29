import NewlyUp from "@/components/NewlyUp";
import { getDashboardData } from "@/lib/source";

export const dynamic = "force-dynamic";

export default async function Page() {
  return <NewlyUp initial={await getDashboardData()} />;
}
