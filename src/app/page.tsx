import Dashboard from "@/components/Dashboard";
import { snapshot } from "@/lib/data";

export const dynamic = "force-dynamic";

export default function Page() {
  return <Dashboard initial={snapshot()} />;
}
