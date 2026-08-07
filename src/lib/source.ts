import type { Snapshot } from "./data";
import { blobConfigured, readStoredSnapshot, readStoredPriorities, newer } from "./store";

export type DashboardData = {
  snapshot: Snapshot | null;
  /** When the data was collected on the Mac. null when nothing has been pushed yet. */
  generatedAt: string | null;
  /** "local" = read straight off this machine's filesystem; "blob" = pushed snapshot. */
  source: "local" | "blob";
  /** Set when the source is blob and no snapshot has ever arrived. */
  empty: boolean;
};

const onVercel = () => Boolean(process.env.VERCEL);

/**
 * The dashboard runs in two places with the same code: on the Mac (where the
 * memory files and git repos actually live) and on Vercel (where they don't).
 * On the Mac we keep reading the real files so the local :4321 fallback stays
 * truthful; on Vercel we read whatever the pusher last uploaded.
 */
export async function getDashboardData(): Promise<DashboardData> {
  if (!onVercel()) {
    const { snapshot } = await import("./data");
    const snap = snapshot();
    return { snapshot: snap, generatedAt: snap.at, source: "local", empty: false };
  }

  if (!blobConfigured()) {
    return { snapshot: null, generatedAt: null, source: "blob", empty: true };
  }

  const [stored, priorities] = await Promise.all([readStoredSnapshot(), readStoredPriorities()]);
  if (!stored) return { snapshot: null, generatedAt: null, source: "blob", empty: true };

  // A reorder done in the browser lands in priorities.json immediately but only
  // reaches snapshot.json on the next push, so prefer whichever is newer.
  const winning = newer(stored.snapshot.priorities ?? null, priorities);
  const snapshot = winning ? { ...stored.snapshot, priorities: winning } : stored.snapshot;

  return { snapshot, generatedAt: stored.generatedAt, source: "blob", empty: false };
}
