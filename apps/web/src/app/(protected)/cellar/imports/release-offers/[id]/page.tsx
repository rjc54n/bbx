import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOwner } from "@/lib/auth/owner";
import {
  acceptReleaseOfferImport,
  resolveReleaseOfferRow,
} from "../actions";

export const dynamic = "force-dynamic";

type Candidate = { parent_sku?: string; name?: string; vintage?: number; similarity?: number };

function dateTime(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/London",
  }).format(new Date(value));
}

function candidates(value: unknown): Candidate[] {
  return Array.isArray(value) ? value.filter((item): item is Candidate => Boolean(item) && typeof item === "object") : [];
}

export default async function ReleaseOfferImportDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const { supabase } = await requireOwner();
  const [
    { data: importData, error: importError },
    { data: unresolvedData, error: unresolvedError },
    { data: priceData, error: priceError },
  ] = await Promise.all([
    supabase
      .from("release_offer_imports")
      .select("id, source_type, original_filename, content_checksum, byte_size, imported_at, parser_version, status, source_row_count, priced_fragment_count, matched_row_count, unmatched_row_count, warning_row_count, error_row_count, failure_summary, accepted_at")
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("release_offer_source_rows")
      .select("source_row_number, offer_date, source_wine, source_price_text, match_candidates, validation_errors, validation_warnings")
      .eq("import_id", id)
      .neq("match_status", "matched")
      .order("source_row_number")
      .limit(100),
    supabase
      .from("release_offer_prices")
      .select("source_row_number, fragment_index, raw_price_text, amount_p, format_code, tax_basis, parse_status, publication_status, validation_warnings")
      .eq("import_id", id)
      .order("source_row_number")
      .order("fragment_index")
      .limit(100),
  ]);
  if (importError || unresolvedError || priceError) {
    throw new Error("The release-offer import preview could not be loaded.");
  }
  if (!importData) notFound();

  return (
    <main className="min-h-0 flex-1 overflow-auto bg-accent-soft">
      <div className="mx-auto max-w-7xl space-y-5 p-5">
        <nav className="flex flex-wrap gap-4 text-sm">
          <Link href="/cellar/imports/release-offers" className="text-accent underline-offset-2 hover:underline">Back to release-offer imports</Link>
          <Link href="/release-prices" className="text-accent underline-offset-2 hover:underline">Release prices</Link>
        </nav>

        {query.duplicate && <p className="rounded border border-border bg-background px-4 py-3 text-sm">This exact file was already imported. The existing evidence is shown.</p>}
        {query.resumed && <p className="rounded border border-border bg-background px-4 py-3 text-sm">The interrupted staging import was resumed and finalised.</p>}
        {query.accepted && <p className="rounded border border-green-700/30 bg-green-50 px-4 py-3 text-sm text-green-900">The import is accepted. Eligible exact evidence now supplies release-price anchors.</p>}
        {query.accept_error && <p role="alert" className="rounded border border-accent/30 bg-background px-4 py-3 text-sm text-accent">The import could not be accepted.</p>}
        {query.resolve_error && <p role="alert" className="rounded border border-accent/30 bg-background px-4 py-3 text-sm text-accent">That Parent ID could not resolve the selected source row.</p>}

        <section className="rounded-lg border border-border bg-background p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-accent">{importData.status}</p>
              <h1 className="mt-1 text-xl font-semibold">{importData.original_filename}</h1>
              <p className="mt-1 text-sm text-ink-muted">
                Imported {dateTime(importData.imported_at)} · {importData.byte_size === null
                  ? "Gmail evidence batch"
                  : `${(importData.byte_size / 1024 / 1024).toFixed(2)} MB`} · parser {importData.parser_version}
              </p>
              <p className="mt-1 font-mono text-xs text-ink-muted">SHA-256 {importData.content_checksum}</p>
            </div>
            {importData.status === "validated" && (
              <form action={acceptReleaseOfferImport.bind(null, importData.id)}>
                <button type="submit" className="rounded bg-accent px-4 py-2 text-sm font-medium text-accent-ink">Accept evidence</button>
              </form>
            )}
          </div>
        </section>

        <section className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {[
            ["Source rows", importData.source_row_count],
            ["Price fragments", importData.priced_fragment_count],
            ["Matched rows", importData.matched_row_count],
            ["Unresolved rows", importData.unmatched_row_count],
            ["Invalid rows", importData.error_row_count],
            ["Accepted", importData.accepted_at ? dateTime(importData.accepted_at) : "No"],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border border-border bg-background p-4">
              <p className="text-xs uppercase tracking-wide text-ink-muted">{label}</p>
              <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
            </div>
          ))}
        </section>

        {unresolvedData?.length ? (
          <section className="rounded-lg border border-border bg-background">
            <div className="border-b border-border px-5 py-3">
              <h2 className="font-semibold">Unresolved source rows</h2>
              <p className="mt-1 text-xs text-ink-muted">Showing the first 100. Candidate names are suggestions, not automatic matches.</p>
            </div>
            <div className="divide-y divide-border">
              {unresolvedData.map((row) => (
                <div key={row.source_row_number} className="grid gap-3 px-5 py-4 lg:grid-cols-[1fr_24rem]">
                  <div>
                    <p className="font-medium">Row {row.source_row_number}: {row.source_wine}</p>
                    <p className="mt-1 text-xs text-ink-muted">{row.offer_date} · {row.source_price_text}</p>
                    {candidates(row.match_candidates).length > 0 && (
                      <p className="mt-2 text-xs text-ink-muted">
                        Suggestions: {candidates(row.match_candidates).map((candidate) => `${candidate.parent_sku} ${candidate.name ?? ""}${candidate.vintage ? ` (${candidate.vintage})` : ""}`).join("; ")}
                      </p>
                    )}
                  </div>
                  <form action={resolveReleaseOfferRow.bind(null, id, row.source_row_number)} className="flex items-end gap-2">
                    <label className="grid flex-1 gap-1 text-xs text-ink-muted">
                      Exact Parent ID
                      <input name="parent_sku" required pattern="[0-9]{5,30}" className="rounded border border-border px-3 py-2 text-sm text-ink" />
                    </label>
                    <button type="submit" className="rounded border border-accent px-3 py-2 text-sm font-medium text-accent">Resolve</button>
                  </form>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <section className="overflow-hidden rounded-lg border border-border bg-background">
          <div className="border-b border-border px-5 py-3">
            <h2 className="font-semibold">Price parsing sample</h2>
            <p className="mt-1 text-xs text-ink-muted">First 100 fragments. Publication requires accepted evidence, an exact product and format, and an explicit in-bond price.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px] text-left text-sm">
              <thead className="bg-accent-soft text-xs uppercase text-ink-muted">
                <tr><th className="px-4 py-2">Row</th><th className="px-4 py-2">Source text</th><th className="px-4 py-2">Format</th><th className="px-4 py-2">Tax basis</th><th className="px-4 py-2">Parse</th><th className="px-4 py-2">Publication</th></tr>
              </thead>
              <tbody className="divide-y divide-border">
                {priceData?.map((price) => (
                  <tr key={`${price.source_row_number}-${price.fragment_index}`}>
                    <td className="px-4 py-2 tabular-nums">{price.source_row_number}</td>
                    <td className="max-w-xl px-4 py-2">{price.raw_price_text}</td>
                    <td className="px-4 py-2 font-mono text-xs">{price.format_code ?? "Unresolved"}</td>
                    <td className="px-4 py-2">{price.tax_basis.replaceAll("_", " ")}</td>
                    <td className="px-4 py-2">{price.parse_status}</td>
                    <td className="px-4 py-2">{price.publication_status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}
