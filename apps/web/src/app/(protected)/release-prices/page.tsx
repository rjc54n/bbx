import { Suspense } from "react";
import { ReleasePriceBrowser } from "@/components/releaseOffers/ReleasePriceBrowser";
import { requireOwner } from "@/lib/auth/owner";
import type { ReleasePriceRow } from "@/lib/releaseOffers/browser";

export const dynamic = "force-dynamic";

export default async function ReleasePricesPage() {
  const { supabase } = await requireOwner();
  const rows: ReleasePriceRow[] = [];
  const pageSize = 1_000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("release_price_market_view")
      .select("*")
      .order("name", { ascending: true })
      .order("parent_sku", { ascending: true })
      .order("format_code", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error("Release-price comparisons could not be loaded.");
    const page = (data ?? []) as ReleasePriceRow[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return <Suspense fallback={<p className="p-5 text-sm text-ink-muted">Loading release prices…</p>}>
    <ReleasePriceBrowser rows={rows} />
  </Suspense>;
}
