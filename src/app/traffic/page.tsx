import Traffic from "@/components/Traffic";
import { getTraffic } from "@/lib/traffic";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ site?: string }> }) {
  const { site } = await searchParams;
  const selected = site && /^[a-z0-9-]{1,40}$/.test(site) ? site : "aisotools";
  return <Traffic data={await getTraffic(selected)} selected={selected} />;
}
