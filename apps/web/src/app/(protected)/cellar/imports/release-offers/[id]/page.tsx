import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOwner } from "@/lib/auth/owner";
import { formatFormat } from "@/lib/format";
import { acceptReleaseOfferImport, deleteReleaseOfferImport } from "../actions";

export const dynamic = "force-dynamic";

function dateTime(value: string) {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/London" }).format(new Date(value));
}

export default async function ReleaseOfferImportDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const query = await searchParams;
  const { supabase } = await requireOwner();
  const { data: importData } = await supabase.from("release_offer_imports")
    .select("id, original_filename, content_checksum, byte_size, imported_at, parser_version, status, source_row_count, priced_fragment_count, error_row_count, accepted_at")
    .eq("id", id).maybeSingle();
  if (!importData) notFound();
  const staging = importData.status === "staging";
  const [{ count: stagedRows }, { count: stagedPrices }, { data: resolutions }, { count: validPriceCount }, { count: unresolvedPriceCount }, { data: prices }, { data: sourceRowNames }] = await Promise.all([
    supabase.from("release_offer_source_rows").select("*", { count: "exact", head: true }).eq("import_id", id),
    supabase.from("release_offer_prices").select("*", { count: "exact", head: true }).eq("import_id", id),
    supabase.from("release_offer_product_resolutions").select("source_row_number, status, parent_sku, match_method").eq("import_id", id),
    supabase.from("release_offer_prices").select("*", { count: "exact", head: true }).eq("import_id", id).eq("parse_status", "valid"),
    supabase.from("release_offer_prices").select("*", { count: "exact", head: true }).eq("import_id", id).eq("parse_status", "unresolved"),
    staging ? Promise.resolve({ data: [] }) : supabase.from("release_offer_prices").select("source_row_number, fragment_index, raw_price_text, format_code, case_size, bottle_volume_ml, tax_basis, parse_status").eq("import_id", id).order("source_row_number").order("fragment_index").limit(100),
    staging ? Promise.resolve({ data: [] }) : supabase.from("release_offer_source_rows").select("source_row_number, source_wine").eq("import_id", id).order("source_row_number").limit(100),
  ]);
  const linked = (resolutions ?? []).filter((item) => item.status === "linked").length;
  const ignored = (resolutions ?? []).filter((item) => item.status === "ignored").length;
  const sourceRows = staging ? (stagedRows ?? 0) : importData.source_row_count;
  const fragments = staging ? (stagedPrices ?? 0) : importData.priced_fragment_count;
  const unresolved = Math.max(0, sourceRows - linked - ignored);
  const priceIssues = unresolvedPriceCount ?? 0;
  const parsedPrices = validPriceCount ?? 0;
  const readyToAccept = importData.status === "staged" && importData.error_row_count === 0 && priceIssues === 0;
  const sourceWineByRow = new Map((sourceRowNames ?? []).map((row) => [row.source_row_number, row.source_wine]));
  type PriceRow = NonNullable<typeof prices>[number];
  const priceGroups = new Map<number, PriceRow[]>();
  for (const price of prices ?? []) {
    const group = priceGroups.get(price.source_row_number) ?? [];
    group.push(price);
    priceGroups.set(price.source_row_number, group);
  }
  const shownPriceCount = prices?.length ?? 0;
  return <main className="min-h-0 flex-1 overflow-auto bg-accent-soft"><div className="mx-auto max-w-7xl space-y-5 p-5">
    <nav className="flex gap-4 text-sm"><Link href="/cellar/imports/release-offers" className="text-accent hover:underline">Back to release-offer imports</Link><Link href="/release-prices" className="text-accent hover:underline">Release prices</Link></nav>
    {query.delete_error && <p role="alert" className="rounded border border-accent bg-background p-3 text-sm text-accent">The import could not be deleted. It remains available to retry.</p>}
    <section className="rounded-lg border border-border bg-background p-5"><div className="flex flex-wrap justify-between gap-4"><div><p className="text-xs font-semibold uppercase text-accent">{importData.status}</p><h1 className="mt-1 text-xl font-semibold">{importData.original_filename}</h1><p className="mt-1 text-sm text-ink-muted">Imported {dateTime(importData.imported_at)} · {(importData.byte_size / 1024 / 1024).toFixed(2)} MB · parser {importData.parser_version}</p></div><div className="flex gap-2">{importData.status === "staged" && <form action={acceptReleaseOfferImport.bind(null, id)}><button className="rounded border border-border px-3 py-2 text-sm">Accept evidence</button></form>}<form action={deleteReleaseOfferImport.bind(null, id)}><button className="rounded border border-accent px-3 py-2 text-sm text-accent">Delete import</button></form></div></div></section>
    {!staging && <section className={`rounded-lg border bg-background p-4 ${readyToAccept ? "border-border" : "border-accent"}`}><h2 className="font-semibold">{readyToAccept ? "Ready to accept" : importData.status === "accepted" ? "Import accepted" : "Review before accepting"}</h2><p className="mt-1 text-sm text-ink-muted">{sourceRows} wine rows produced {fragments} prices. {priceIssues === 0 ? "All price text parsed successfully." : `${priceIssues} price ${priceIssues === 1 ? "needs" : "need"} review.`} Catalogue linking is separate and can continue after acceptance.</p></section>}
    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[[staging ? "Rows staged" : "Wine rows", sourceRows], [staging ? "Prices staged" : "Extracted prices", fragments], ["Parsed prices", parsedPrices], ["Price parsing issues", priceIssues], ["Catalogue linked", linked], ["Catalogue unmatched", unresolved], ["Ignored wines", ignored], ["Invalid wine rows", importData.error_row_count]].map(([label, value]) => <div key={String(label)} className="rounded-lg border border-border bg-background p-4"><p className="text-xs uppercase text-ink-muted">{label}</p><p className="mt-1 text-lg font-semibold">{String(value)}</p></div>)}</section>
    {!staging && <section className="rounded-lg border border-border bg-background p-4"><h2 className="font-semibold">Catalogue links</h2><p className="mt-1 text-sm text-ink-muted">Accepted offer records are available in Release prices without a catalogue link. Matching and link maintenance will be managed across the complete accepted dataset, not from individual imports.</p></section>}
    {!staging && <details open={priceIssues > 0} className="overflow-hidden rounded-lg border border-border bg-background"><summary className="cursor-pointer p-4 font-semibold">Parsed prices ({fragments})</summary><div className="border-t border-border p-4"><p className="text-sm text-ink-muted">Multiple formats from one wine are grouped together. {shownPriceCount < fragments ? `Showing the first ${shownPriceCount} prices.` : "All extracted prices are shown."}</p></div><div className="overflow-x-auto"><table className="w-full min-w-[850px] text-left text-sm"><thead className="border-y border-border bg-accent-soft text-xs uppercase tracking-wide text-ink-muted"><tr><th className="w-1/4 px-3 py-2">Wine</th><th className="w-2/5 px-3 py-2">Original price text</th><th className="px-3 py-2">Interpreted format</th><th className="px-3 py-2">Result</th></tr></thead><tbody className="divide-y divide-border">{[...priceGroups.entries()].map(([sourceRowNumber, group]) => group.map((price, index) => <tr key={`${price.source_row_number}-${price.fragment_index}`} className={price.parse_status === "valid" && price.tax_basis === "in_bond" ? undefined : "bg-accent-soft"}>{index === 0 && <td rowSpan={group.length} className="px-3 py-3 align-top"><p className="font-medium">{sourceWineByRow.get(sourceRowNumber) ?? "Wine name unavailable"}</p><p className="mt-1 text-xs text-ink-muted">CSV row {sourceRowNumber}</p></td>}<td className="px-3 py-3 align-top">{price.raw_price_text}</td><td className="px-3 py-3 align-top"><p>{formatFormat(price.case_size, price.bottle_volume_ml)}</p>{price.format_code === null && <p className="text-xs text-accent">Format unresolved</p>}</td><td className="px-3 py-3 align-top">{price.parse_status === "valid" && price.tax_basis === "in_bond" ? "Parsed successfully" : price.parse_status !== "valid" ? "Needs review" : <><p>Parsed</p><p className="text-xs text-accent">Tax basis: {price.tax_basis.replaceAll("_", " ")}</p></>}</td></tr>))}</tbody></table></div></details>}
  </div></main>;
}
