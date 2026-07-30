import Link from "next/link";
import { requireOwner } from "@/lib/auth/owner";
import { formatDate } from "@/lib/format";
import { restoreHistoricOfferRecord } from "../matches/actions";

export const dynamic = "force-dynamic";

type ExcludedOffer = {
  content_fingerprint: string;
  match_group_key: string | null;
  source_wine: string | null;
  offer_date: string | null;
  excluded_at: string | null;
  in_accepted_evidence: boolean | null;
};

export default async function ExcludedReleaseOfferRecordsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const { supabase } = await requireOwner();
  const { data, error } = await supabase
    .from("release_offer_excluded_record_view")
    .select("content_fingerprint,match_group_key,source_wine,offer_date,excluded_at,in_accepted_evidence")
    .order("excluded_at", { ascending: false });
  if (error) {
    throw new Error(`Excluded release-offer records could not be loaded. ${error.message} (${error.code})`);
  }
  const rows = (data ?? []) as ExcludedOffer[];

  return <div className="flex min-h-0 flex-1 flex-col">
    <header className="border-b border-border bg-accent-soft px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-accent">Release prices</p>
          <h1 className="mt-1 text-2xl font-semibold">Excluded records</h1>
          <p className="mt-1 max-w-3xl text-sm text-ink-muted">
            Offer records you have taken out of the evidence. Each is matched on its own
            content, so a later file repeating the same offer is filtered out rather than
            reintroducing it. Restoring one puts it back into the release-price anchor.
          </p>
        </div>
        <Link href="/release-prices" className="rounded border border-accent px-3 py-2 text-sm font-medium text-accent hover:bg-background">
          All accepted offers
        </Link>
      </div>
    </header>

    <div className="border-b border-border px-4 py-2 text-sm text-ink-muted">
      {rows.length.toLocaleString()} excluded record{rows.length === 1 ? "" : "s"}
    </div>

    {query.restored && <p role="status" className="border-b border-green-700/30 bg-green-50 px-5 py-3 text-sm text-green-900">The record was restored.</p>}
    {query.restore_error && <p role="alert" className="border-b border-red-700/30 bg-background px-5 py-3 text-sm text-red-800">The record was not restored. It remains excluded.</p>}

    <div className="min-h-0 flex-1 overflow-auto">
      <table className="w-full min-w-max border-collapse text-sm">
        <thead className="sticky top-0 z-10 bg-background shadow-[0_1px_0_0_var(--border)]">
          <tr>
            <th scope="col" className="whitespace-nowrap px-3 py-2 text-left font-medium text-ink-muted">Wine</th>
            <th scope="col" className="whitespace-nowrap px-3 py-2 text-left font-medium text-ink-muted">Offer date</th>
            <th scope="col" className="whitespace-nowrap px-3 py-2 text-left font-medium text-ink-muted">In accepted imports</th>
            <th scope="col" className="whitespace-nowrap px-3 py-2 text-left font-medium text-ink-muted">Excluded</th>
            <th scope="col" className="whitespace-nowrap px-3 py-2 text-left font-medium text-ink-muted">Restore</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? <tr>
            <td colSpan={5} className="px-3 py-10 text-center text-ink-muted">
              Nothing excluded. Offer records you exclude appear here.
            </td>
          </tr> : rows.map((row) => (
            <tr key={row.content_fingerprint} className="border-t border-border hover:bg-accent-soft/50">
              <td className="max-w-md px-3 py-2 align-top">
                <p className="font-medium">{row.source_wine ?? row.content_fingerprint.slice(0, 12)}</p>
                {row.match_group_key && <p className="text-xs text-ink-muted">Match group {row.match_group_key}</p>}
              </td>
              <td className="px-3 py-2 align-top tabular-nums">{formatDate(row.offer_date)}</td>
              <td className="px-3 py-2 align-top">
                {/* No accepted import currently carries this content, so the
                    exclusion is only guarding against a future file. */}
                {row.in_accepted_evidence
                  ? "Yes"
                  : <span className="text-ink-muted" title="No accepted import currently contains this record. Restoring it will have no visible effect until a file containing it is imported.">Not in any current import</span>}
              </td>
              <td className="px-3 py-2 align-top tabular-nums">{formatDate(row.excluded_at)}</td>
              <td className="px-3 py-2 align-top">
                <form action={restoreHistoricOfferRecord.bind(null, row.content_fingerprint)}>
                  <button className="rounded border border-accent px-2 py-1 text-xs text-accent">Restore</button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>;
}
