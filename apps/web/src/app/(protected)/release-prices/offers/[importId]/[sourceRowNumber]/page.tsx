import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOwner } from "@/lib/auth/owner";
import { formatDate, formatFormat, formatPence } from "@/lib/format";
import { CatalogueCandidateSearch } from "@/components/releaseOffers/CatalogueCandidateSearch";
import { DeleteHistoricOfferRecordForm } from "@/components/releaseOffers/DeleteHistoricOfferRecordForm";
import {
  confirmManualHistoricOfferMatch,
  restoreHistoricOfferGroup,
  suppressHistoricOfferGroup,
  unlinkHistoricOfferGroup,
} from "@/app/(protected)/release-prices/matches/actions";

export const dynamic = "force-dynamic";

type SourceRow = {
  import_id: string;
  source_row_number: number;
  offer_date: string;
  source_wine: string;
  source_vintage: number | null;
  source_match_key: string;
  match_group_key: string;
  source_price_text: string;
  source_product_id: string | null;
  source_product_url: string | null;
  source_message_id: string | null;
  description: string | null;
  tasting_notes: string | null;
  raw_row: unknown;
  validation_errors: unknown;
  validation_warnings: unknown;
};

type PriceFragment = {
  id: number;
  fragment_index: number;
  raw_price_text: string;
  amount_p: number | null;
  case_size: number | null;
  bottle_volume_ml: number | null;
  format_code: string | null;
  tax_basis: string;
  parse_status: string;
  validation_warnings: unknown;
};

type Resolution = {
  status: "linked" | "ignored";
  parent_sku: string | null;
  match_method: string | null;
};

type CatalogueRow = {
  parent_sku: string | null;
  name: string | null;
  vintage: number | null;
  producer: string | null;
  country: string | null;
  region: string | null;
  subregion: string | null;
  colour: string | null;
  product_url: string | null;
  format_code: string | null;
  case_size: number | null;
  bottle_volume_ml: number | null;
  ask: number | null;
  highest_bid_p: number | null;
  market_price_p: number | null;
  is_listed: boolean | null;
};

function methodLabel(value: string | null) {
  const labels: Record<string, string> = {
    supplied_id: "Supplied Parent ID",
    local_exact: "Local exact match",
    algolia_exact: "Algolia exact match",
    algolia_confirmed: "Algolia confirmed",
    manual: "Manual Parent ID",
  };
  return value ? labels[value] ?? value : "Unlinked";
}

function json(value: unknown) {
  return JSON.stringify(value, null, 2);
}

export default async function ReleaseOfferDetailPage({
  params,
}: {
  params: Promise<{ importId: string; sourceRowNumber: string }>;
}) {
  const { importId, sourceRowNumber } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(importId) || !/^\d+$/.test(sourceRowNumber)) notFound();
  const rowNumber = Number(sourceRowNumber);
  const { supabase } = await requireOwner();

  const [{ data: sourceData, error: sourceError }, { data: importData, error: importError }, { data: priceData, error: priceError }, { data: resolutionData, error: resolutionError }] = await Promise.all([
    supabase.from("release_offer_source_rows").select("import_id, source_row_number, offer_date, source_wine, source_vintage, source_match_key, match_group_key, source_price_text, source_product_id, source_product_url, source_message_id, description, tasting_notes, raw_row, validation_errors, validation_warnings").eq("import_id", importId).eq("source_row_number", rowNumber).maybeSingle(),
    supabase.from("release_offer_imports").select("status, original_filename, accepted_at").eq("id", importId).maybeSingle(),
    supabase.from("release_offer_prices").select("id, fragment_index, raw_price_text, amount_p, case_size, bottle_volume_ml, format_code, tax_basis, parse_status, validation_warnings").eq("import_id", importId).eq("source_row_number", rowNumber).order("fragment_index"),
    supabase.from("release_offer_product_resolutions").select("status, parent_sku, match_method").eq("import_id", importId).eq("source_row_number", rowNumber).maybeSingle(),
  ]);
  if (sourceError || importError || priceError || resolutionError) throw new Error("Historic offer record could not be loaded.");
  if (!sourceData || importData?.status !== "accepted") notFound();

  const source = sourceData as SourceRow;
  const prices = (priceData ?? []) as PriceFragment[];
  const resolution = resolutionData as Resolution | null;
  const { data: catalogueData, error: catalogueError } = resolution?.parent_sku
    ? await supabase.from("catalogue_view").select("parent_sku, name, vintage, producer, country, region, subregion, colour, product_url, format_code, case_size, bottle_volume_ml, ask, highest_bid_p, market_price_p, is_listed").eq("parent_sku", resolution.parent_sku).order("format_code")
    : { data: [], error: null };
  if (catalogueError) throw new Error("Current catalogue data could not be loaded.");
  const catalogue = (catalogueData ?? []) as CatalogueRow[];
  const returnPath = `/release-prices/offers/${importId}/${rowNumber}`;
  const unresolved = !resolution;

  return <main className="min-h-0 flex-1 overflow-auto bg-accent-soft">
    <div className="mx-auto max-w-6xl space-y-5 p-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div><p className="text-xs font-semibold uppercase tracking-wider text-accent">Release offer record</p><h1 className="mt-1 text-2xl font-semibold">{source.source_wine}</h1><p className="mt-1 text-sm text-ink-muted">Offer date {formatDate(source.offer_date)} · source row {source.source_row_number}</p></div>
        <Link href="/release-prices" className="rounded border border-accent px-3 py-2 text-sm text-accent">All accepted offers</Link>
      </header>

      <section aria-labelledby="offer-evidence" className="rounded-lg border border-border bg-background p-5">
        <h2 id="offer-evidence" className="text-lg font-semibold">Imported offer evidence</h2>
        <dl className="mt-4 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          <div><dt className="text-xs uppercase text-ink-muted">Wine and vintage</dt><dd>{source.source_wine} · {source.source_vintage ?? "Vintage unavailable"}</dd></div>
          <div><dt className="text-xs uppercase text-ink-muted">Imported from</dt><dd>{importData.original_filename} · accepted {formatDate(importData.accepted_at)}</dd></div>
          <div className="sm:col-span-2"><dt className="text-xs uppercase text-ink-muted">Original price text</dt><dd className="whitespace-pre-wrap">{source.source_price_text}</dd></div>
          {source.source_product_id && <div><dt className="text-xs uppercase text-ink-muted">Supplied Parent ID</dt><dd>{source.source_product_id}</dd></div>}
          {source.source_product_url && <div><dt className="text-xs uppercase text-ink-muted">Source product page</dt><dd><a className="text-accent underline-offset-2 hover:underline" href={source.source_product_url}>Open source page</a></dd></div>}
          {source.source_message_id && <div><dt className="text-xs uppercase text-ink-muted">Source message ID</dt><dd className="break-all">{source.source_message_id}</dd></div>}
          {source.description && <div className="sm:col-span-2"><dt className="text-xs uppercase text-ink-muted">Description</dt><dd className="whitespace-pre-wrap">{source.description}</dd></div>}
          {source.tasting_notes && <div className="sm:col-span-2"><dt className="text-xs uppercase text-ink-muted">Tasting notes</dt><dd className="whitespace-pre-wrap">{source.tasting_notes}</dd></div>}
        </dl>
      </section>

      <section aria-labelledby="price-fragments" className="rounded-lg border border-border bg-background p-5">
        <h2 id="price-fragments" className="text-lg font-semibold">Parsed price fragments</h2>
        <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[700px] text-left text-sm"><thead className="text-xs uppercase text-ink-muted"><tr><th className="p-2">Fragment</th><th className="p-2">Price</th><th className="p-2">Format</th><th className="p-2">Basis</th><th className="p-2">Parse</th></tr></thead><tbody>{prices.map((price) => <tr key={price.id} className="border-t border-border"><td className="p-2">{price.raw_price_text}</td><td className="p-2">{formatPence(price.amount_p)}</td><td className="p-2">{formatFormat(price.case_size, price.bottle_volume_ml)}{price.format_code ? ` (${price.format_code})` : ""}</td><td className="p-2">{price.tax_basis.replaceAll("_", " ")}</td><td className="p-2">{price.parse_status}</td></tr>)}</tbody></table></div>
      </section>

      <section aria-labelledby="product-link" className="rounded-lg border border-border bg-background p-5">
        <h2 id="product-link" className="text-lg font-semibold">Product link</h2>
        <p className="mt-1 text-sm text-ink-muted">A decision on this wine and vintage applies to every unresolved record in the same group.</p>
        <p className="mt-3 text-sm"><span className="text-ink-muted">Current status: </span>{resolution?.status === "linked" ? `Linked to Parent ${resolution.parent_sku} by ${methodLabel(resolution.match_method)}` : resolution?.status === "ignored" ? "Rejected and suppressed" : "Unlinked"}</p>
        {unresolved && <div className="mt-4 flex flex-wrap gap-3"><form action={confirmManualHistoricOfferMatch.bind(null, source.match_group_key, returnPath)} className="flex gap-2"><label className="sr-only" htmlFor="parent-sku">Parent ID</label><input id="parent-sku" name="parent_sku" inputMode="numeric" pattern="[0-9]{5,30}" placeholder="Parent ID" className="w-40 rounded border border-border px-2 py-1.5 text-sm" required /><button className="rounded border border-accent px-3 py-1.5 text-sm text-accent">Link manually</button></form><form action={suppressHistoricOfferGroup.bind(null, source.match_group_key, returnPath)}><button className="rounded border border-border px-3 py-1.5 text-sm">Reject and suppress group</button></form></div>}
        {resolution?.status === "linked" && <form action={unlinkHistoricOfferGroup.bind(null, source.match_group_key, returnPath)} className="mt-4"><button className="rounded border border-accent px-3 py-1.5 text-sm text-accent">Unlink group and retry later</button></form>}
        {resolution?.status === "ignored" && <form action={restoreHistoricOfferGroup.bind(null, source.match_group_key, returnPath)} className="mt-4"><button className="rounded border border-border px-3 py-1.5 text-sm">Restore group to unmatched</button></form>}
        {unresolved && <CatalogueCandidateSearch matchGroupKey={source.match_group_key} sourceWine={source.source_wine} sourceVintage={source.source_vintage} returnPath={returnPath} />}
      </section>

      <section aria-labelledby="delete-record" className="rounded-lg border border-red-700/30 bg-background p-5">
        <h2 id="delete-record" className="text-lg font-semibold">Delete record</h2>
        <p className="mt-1 text-sm text-ink-muted">This removes only this accepted offer record and its parsed price fragments. Other records in the same match group are retained.</p>
        <div className="mt-4"><DeleteHistoricOfferRecordForm importId={importId} sourceRowNumber={rowNumber} /></div>
      </section>

      {resolution?.parent_sku && <section aria-labelledby="catalogue-card" className="rounded-lg border border-border bg-background p-5"><h2 id="catalogue-card" className="text-lg font-semibold">Current BBX catalogue card</h2>{catalogue.length === 0 ? <p className="mt-3 text-sm text-ink-muted">This Parent ID is saved, but it is not currently in the BBX-eligible catalogue.</p> : <div className="mt-4 space-y-4">{catalogue.map((product) => <article key={product.format_code} className="rounded border border-border p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold">{product.name}</h3><p className="mt-1 text-sm text-ink-muted">Parent {product.parent_sku} · {product.vintage ?? "Vintage unavailable"} · {product.producer ?? "Producer unavailable"}</p></div>{product.product_url && <a className="text-sm text-accent underline-offset-2 hover:underline" href={product.product_url}>Open BBR product</a>}</div><dl className="mt-4 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-3"><div><dt className="text-xs uppercase text-ink-muted">Region</dt><dd>{[product.country, product.region, product.subregion].filter(Boolean).join(" · ") || "Unavailable"}</dd></div><div><dt className="text-xs uppercase text-ink-muted">Format</dt><dd>{formatFormat(product.case_size, product.bottle_volume_ml)}</dd></div><div><dt className="text-xs uppercase text-ink-muted">Listing status</dt><dd>{product.is_listed ? "Listed" : "Unlisted"}</dd></div><div><dt className="text-xs uppercase text-ink-muted">Lowest ask</dt><dd>{formatPence(product.ask)}</dd></div><div><dt className="text-xs uppercase text-ink-muted">Highest bid</dt><dd>{formatPence(product.highest_bid_p)}</dd></div><div><dt className="text-xs uppercase text-ink-muted">Market price</dt><dd>{formatPence(product.market_price_p)}</dd></div></dl></article>)}</div>}</section>}

      <details className="rounded-lg border border-border bg-background p-5"><summary className="cursor-pointer font-semibold">Imported JSON and validation data</summary><div className="mt-4 grid gap-4 lg:grid-cols-3"><section><h2 className="text-sm font-medium">Raw row</h2><pre className="mt-2 overflow-auto rounded bg-accent-soft p-3 text-xs">{json(source.raw_row)}</pre></section><section><h2 className="text-sm font-medium">Validation warnings</h2><pre className="mt-2 overflow-auto rounded bg-accent-soft p-3 text-xs">{json(source.validation_warnings)}</pre></section><section><h2 className="text-sm font-medium">Validation errors</h2><pre className="mt-2 overflow-auto rounded bg-accent-soft p-3 text-xs">{json(source.validation_errors)}</pre></section></div></details>
    </div>
  </main>;
}
