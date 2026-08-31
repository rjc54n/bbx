import { permanentRedirect } from "next/navigation";
import { buildMatchesRedirect } from "@/lib/matching/redirectContract";

// Slice 3: the release-offer matching queue moved to the unified /matches
// surface. This route is a permanent (308) redirect that sets
// source=release_offer and remaps the old state names (spec §3.7). The
// match-run pipeline and per-record actions still live in ./actions, imported
// by the shared /matches page and the offer-record detail page.
export const dynamic = "force-dynamic";

export default async function ReleasePricesMatchesRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  permanentRedirect(buildMatchesRedirect("release_offer", await searchParams));
}
