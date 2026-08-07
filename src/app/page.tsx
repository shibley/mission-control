import Dashboard from "@/components/Dashboard";
import { getDashboardData } from "@/lib/source";

export const dynamic = "force-dynamic";

export default async function Page() {
  return <Dashboard initial={await getDashboardData()} />;
}
