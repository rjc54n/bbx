import Link from "next/link";
import { notFound } from "next/navigation";
import { formatDate, formatFormat, formatPence } from "@/lib/format";
import { requireOwner } from "@/lib/auth/owner";
import { wineHref } from "@/lib/nav/origin";

export const dynamic = "force-dynamic";

export default async function HistoricOfferHistoryPage({
  params,
}: {
  params: Promise<{ parentSku: string; formatCode: string }>;
}) {
  const { parentSku, formatCode } = await params;
  if (!/^\d{5,30}$/.test(parentSku) || !/^\d{2}-\d{5}$/.test(formatCode)) notFound();
  const { supabase } = await requireOwner();

  const [catalogue, evidence] = await Promise.all([
    supabase.from("catalogue_view")
      .select("name,case_size,bottle_volume_ml,ask,highest_bid_p")
      .eq("parent_sku", parentSku).eq("format_code", formatCode).maybeSingle(),
    supabase.from("release_offer_evidence_view")
      .select("import_id,source_row_number,release_offer_price_id,offer_date,release_price_p,source_wine,match_method,source_message_id")
      .eq("parent_sku", parentSku).eq("format_code", formatCode).order("offer_date"),
  ]);
  if (catalogue.error || evidence.error) throw new Error("Historic offers could not be loaded.");
  if (!catalogue.data && (evidence.data ?? []).length === 0) notFound();

  const firstOffer = evidence.data?.[0];
  const caseSize = catalogue.data?.case_size ?? Number.parseInt(formatCode.split("-")[0], 10);
  const bottleVolumeMl = catalogue.data?.bottle_volume_ml ?? Number.parseInt(formatCode.split("-")[1], 10);

  return <main className="min-h-0 flex-1 overflow-auto bg-accent-soft">
    <div className="mx-auto max-w-6xl space-y-5 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/release-prices" className="text-sm text-accent underline-offset-2 hover:underline">Back to historic offers</Link>
        <Link href={wineHref(parentSku, `/release-prices/${parentSku}/${formatCode}`)} className="text-sm text-accent underline-offset-2 hover:underline">View wine card ↗</Link>
      </div>
      <header className="rounded-lg border border-border bg-background p-5">
        <p className="text-xs font-semibold uppercase tracking-wider text-accent">Historic offer evidence</p>
        <h1 className="mt-1 text-2xl font-semibold">{catalogue.data?.name ?? firstOffer?.source_wine ?? parentSku}</h1>
        <p className="mt-1 text-sm text-ink-muted">Parent {parentSku} · {formatFormat(caseSize, bottleVolumeMl)}</p>
        <div className="mt-4 flex flex-wrap gap-5 text-sm">
          <span>Current ask <strong>{formatPence(catalogue.data?.ask ?? null)}</strong></span>
          <span>Current bid <strong>{formatPence(catalogue.data?.highest_bid_p ?? null)}</strong></span>
        </div>
        <p className="mt-3 text-xs text-ink-muted">These are source offers. The wine card shows the historic reference selected across all sources.</p>
      </header>
      <section className="rounded-lg border border-border bg-background">
        <div className="border-b border-border px-5 py-3"><h2 className="font-semibold">Accepted offers</h2></div>
        <div className="divide-y divide-border">
          {(evidence.data ?? []).length === 0
            ? <p className="px-5 py-4 text-sm text-ink-muted">No accepted offer resolves to this format.</p>
            : evidence.data?.map((item) => <article key={item.release_offer_price_id} className="grid gap-4 px-5 py-4 md:grid-cols-[1fr_auto]">
              <div>
                <p className="font-medium">{formatPence(item.release_price_p)} on {formatDate(item.offer_date)}</p>
                <p className="mt-1 text-sm text-ink-muted">{item.source_wine} · matched by {(item.match_method ?? "unknown").replaceAll("_", " ")}</p>
                {item.source_message_id && <p className="mt-1 text-xs text-ink-muted">Gmail message {item.source_message_id}</p>}
              </div>
              <Link href={`/release-prices/offers/${item.import_id}/${item.source_row_number}`} className="text-sm text-accent underline-offset-2 hover:underline">Open source record ↗</Link>
            </article>)}
        </div>
      </section>
    </div>
  </main>;
}
