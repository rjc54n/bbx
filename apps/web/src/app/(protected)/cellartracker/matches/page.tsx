import { permanentRedirect } from "next/navigation";
import { buildMatchesRedirect } from "@/lib/matching/redirectContract";

// Slice 3: the CellarTracker matching queue moved to the unified /matches
// surface. This route is a permanent (308) redirect that sets
// source=cellartracker and remaps the old state names (spec §3.7). The
// match-run pipeline still lives in ./actions / ./MatchRunControl, imported by
// the shared /matches page.
export const dynamic = "force-dynamic";

export default async function CellarTrackerMatchesRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  permanentRedirect(buildMatchesRedirect("cellartracker", await searchParams));
}
