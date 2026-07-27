import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOwner } from "@/lib/auth/owner";
import { acceptReleaseOfferImport, clearReleaseOfferProductResolution, deleteReleaseOfferImport, ignoreReleaseOfferRow, runReleaseOfferMatching, setReleaseOfferProductResolution } from "../actions";

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
  const [{ count: stagedRows }, { count: stagedPrices }, { data: resolutions }, { data: rows }, { data: prices }] = await Promise.all([
    supabase.from("release_offer_source_rows").select("*", { count: "exact", head: true }).eq("import_id", id),
    supabase.from("release_offer_prices").select("*", { count: "exact", head: true }).eq("import_id", id),
    supabase.from("release_offer_product_resolutions").select("source_row_number, status, parent_sku, match_method").eq("import_id", id),
    staging ? Promise.resolve({ data: [] }) : supabase.from("release_offer_source_rows").select("source_row_number, source_wine, source_product_id").eq("import_id", id).order("source_row_number").limit(100),
    staging ? Promise.resolve({ data: [] }) : supabase.from("release_offer_prices").select("source_row_number, fragment_index, raw_price_text, format_code, tax_basis, parse_status").eq("import_id", id).order("source_row_number").order("fragment_index").limit(100),
  ]);
  const resolutionByRow = new Map((resolutions ?? []).map((item) => [item.source_row_number, item]));
  const linked = (resolutions ?? []).filter((item) => item.status === "linked").length;
  const ignored = (resolutions ?? []).filter((item) => item.status === "ignored").length;
  const sourceRows = staging ? (stagedRows ?? 0) : importData.source_row_count;
  const fragments = staging ? (stagedPrices ?? 0) : importData.priced_fragment_count;
  const unresolved = Math.max(0, sourceRows - linked - ignored);
  const canMatch = importData.status === "staged" || importData.status === "accepted";
  return <main className="min-h-0 flex-1 overflow-auto bg-accent-soft"><div className="mx-auto max-w-7xl space-y-5 p-5">
    <nav className="flex gap-4 text-sm"><Link href="/cellar/imports/release-offers" className="text-accent hover:underline">Back to release-offer imports</Link><Link href="/release-prices" className="text-accent hover:underline">Release prices</Link></nav>
    {query.delete_error && <p role="alert" className="rounded border border-accent bg-background p-3 text-sm text-accent">The import could not be deleted. It remains available to retry.</p>}
    {query.match_error && <p role="alert" className="rounded border border-accent bg-background p-3 text-sm text-accent">Matching could not run for this import.</p>}
    <section className="rounded-lg border border-border bg-background p-5"><div className="flex flex-wrap justify-between gap-4"><div><p className="text-xs font-semibold uppercase text-accent">{importData.status}</p><h1 className="mt-1 text-xl font-semibold">{importData.original_filename}</h1><p className="mt-1 text-sm text-ink-muted">Imported {dateTime(importData.imported_at)} · {(importData.byte_size / 1024 / 1024).toFixed(2)} MB · parser {importData.parser_version}</p></div><div className="flex gap-2">{canMatch && <form action={runReleaseOfferMatching.bind(null, id)}><button className="rounded bg-accent px-3 py-2 text-sm font-medium text-accent-ink">{importData.status === "accepted" ? "Re-run matching" : "Run matching"}</button></form>}{importData.status === "staged" && <form action={acceptReleaseOfferImport.bind(null, id)}><button className="rounded border border-border px-3 py-2 text-sm">Accept evidence</button></form>}<form action={deleteReleaseOfferImport.bind(null, id)}><button className="rounded border border-accent px-3 py-2 text-sm text-accent">Delete import</button></form></div></div></section>
    <section className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">{[[staging ? "Rows staged" : "Source rows", sourceRows], [staging ? "Fragments staged" : "Valid price fragments", fragments], ["Linked rows", linked], ["Unresolved rows", unresolved], ["Ignored rows", ignored], ["Invalid rows", importData.error_row_count]].map(([label, value]) => <div key={String(label)} className="rounded-lg border border-border bg-background p-4"><p className="text-xs uppercase text-ink-muted">{label}</p><p className="mt-1 text-lg font-semibold">{String(value)}</p></div>)}</section>
    {!staging && <section className="overflow-hidden rounded-lg border border-border bg-background"><div className="border-b border-border p-4"><h2 className="font-semibold">Source-row links</h2><p className="mt-1 text-xs text-ink-muted">First 100 rows. Direct ID, exact name and vintage, then manual link. Ignored rows are excluded from later matching.</p></div><div className="overflow-x-auto"><table className="w-full min-w-[950px] text-left text-sm"><thead className="bg-accent-soft text-xs uppercase text-ink-muted"><tr><th className="p-3">Row</th><th className="p-3">Wine</th><th className="p-3">Supplied ID</th><th className="p-3">Link</th><th className="p-3">Action</th></tr></thead><tbody className="divide-y divide-border">{rows?.map((row) => { const resolution = resolutionByRow.get(row.source_row_number); return <tr key={row.source_row_number}><td className="p-3">{row.source_row_number}</td><td className="p-3">{row.source_wine}</td><td className="p-3 font-mono text-xs">{row.source_product_id ?? ""}</td><td className="p-3">{resolution?.status === "linked" ? `${resolution.parent_sku} (${resolution.match_method})` : resolution?.status === "ignored" ? "Ignored" : "Unresolved"}</td><td className="p-3"><div className="flex gap-2"><form action={setReleaseOfferProductResolution.bind(null, id, row.source_row_number)}><input name="parent_sku" aria-label={`Parent ID for row ${row.source_row_number}`} className="w-32 rounded border border-border px-2 py-1 font-mono text-xs" placeholder="Parent ID"/><button className="ml-1 rounded border border-border px-2 py-1 text-xs">Link</button></form><form action={ignoreReleaseOfferRow.bind(null, id, row.source_row_number)}><button className="rounded border border-border px-2 py-1 text-xs">Ignore</button></form>{resolution && <form action={clearReleaseOfferProductResolution.bind(null, id, row.source_row_number)}><button className="rounded border border-border px-2 py-1 text-xs">Clear</button></form>}</div></td></tr>; })}</tbody></table></div></section>}
    {!staging && <section className="overflow-hidden rounded-lg border border-border bg-background"><div className="border-b border-border p-4"><h2 className="font-semibold">Price parsing sample</h2><p className="mt-1 text-xs text-ink-muted">Fragments are raw evidence. Accepted, linked and explicit in-bond prices become analytical evidence.</p></div><div className="overflow-x-auto"><table className="w-full min-w-[700px] text-left text-sm"><thead className="bg-accent-soft text-xs uppercase text-ink-muted"><tr><th className="p-3">Row</th><th className="p-3">Source text</th><th className="p-3">Format</th><th className="p-3">Tax basis</th><th className="p-3">Parse</th></tr></thead><tbody className="divide-y divide-border">{prices?.map((price) => <tr key={`${price.source_row_number}-${price.fragment_index}`}><td className="p-3">{price.source_row_number}</td><td className="p-3">{price.raw_price_text}</td><td className="p-3">{price.format_code ?? "Unresolved"}</td><td className="p-3">{price.tax_basis.replaceAll("_", " ")}</td><td className="p-3">{price.parse_status}</td></tr>)}</tbody></table></div></section>}
  </div></main>;
}
