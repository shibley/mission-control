import ShopifyApps from "@/components/ShopifyApps";
import { getDashboardData } from "@/lib/source";

export const dynamic = "force-dynamic";

export default async function Page() {
  return <ShopifyApps initial={await getDashboardData()} />;
}
