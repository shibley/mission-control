import Research from "@/components/Research";
import { getDashboardData } from "@/lib/source";

export const dynamic = "force-dynamic";

export default async function Page() {
  return <Research initial={await getDashboardData()} />;
}
