import Link from "next/link";
import { requireOwner } from "@/lib/auth/owner";
import { formatDate } from "@/lib/format";
import { restoreCellarTrackerRecord } from "../[importId]/[sourceRowNumber]/actions";

export const dynamic = "force-dynamic";

type ExcludedRecord = {
  match_group_key: string;
  source_wine: string;
  vintage: number | null;
  excluded_at: string | null;
  parent_sku: string | null;
  in_current_snapshot: boolean | null;
};

export default async function ExcludedCellarTrackerRecordsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const { supabase } = await requireOwner();
  const { data, error } = await supabase
    .from("cellartracker_excluded_record_view")
    .select("match_group_key,source_wine,vintage,excluded_at,parent_sku,in_current_snapshot")
    .order("excluded_at", { ascending: false });
  if (error) {
    throw new Error(`Excluded CellarTracker records could not be loaded. ${error.message} (${error.code})`);
  }
  const rows = (data ?? []) as ExcludedRecord[];

  return <div className="flex min-h-0 flex-1 flex-col">
    <header className="border-b border-border bg-accent-soft px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-accent">My CellarTracker</p>
          <h1 className="mt-1 text-2xl font-semibold">Excluded records</h1>
          <p className="mt-1 max-w-3xl text-sm text-ink-muted">
            Records you have taken out of the CellarTracker snapshot. Each stays out of
            every snapshot you accept from now on, so re-uploading the report will not
            bring it back. Restoring one puts it straight back on the current snapshot.
          </p>
        </div>
        <Link href="/cellartracker" className="rounded border border-accent px-3 py-2 text-sm font-medium text-accent hover:bg-background">
          All CellarTracker records
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
            <th scope="col" className="whitespace-nowrap px-3 py-2 text-left font-medium text-ink-muted">Vintage</th>
            <th scope="col" className="whitespace-nowrap px-3 py-2 text-left font-medium text-ink-muted">In current file</th>
            <th scope="col" className="whitespace-nowrap px-3 py-2 text-left font-medium text-ink-muted">Excluded</th>
            <th scope="col" className="whitespace-nowrap px-3 py-2 text-left font-medium text-ink-muted">Restore</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? <tr>
            <td colSpan={5} className="px-3 py-10 text-center text-ink-muted">
              Nothing excluded. Records you exclude from the CellarTracker snapshot appear here.
            </td>
          </tr> : rows.map((row) => (
            <tr key={`${row.match_group_key}|${row.source_wine}`} className="border-t border-border hover:bg-accent-soft/50">
              <td className="max-w-md px-3 py-2 align-top">
                <p className="font-medium">{row.source_wine}</p>
                {row.parent_sku && <p className="text-xs text-ink-muted">Was linked to Parent {row.parent_sku}</p>}
              </td>
              <td className="px-3 py-2 align-top tabular-nums">{row.vintage ?? "–"}</td>
              <td className="px-3 py-2 align-top">
                {/* A dormant exclusion: CellarTracker has stopped reporting the
                    record, so the decision is only holding the door shut. */}
                {row.in_current_snapshot
                  ? "Yes"
                  : <span className="text-ink-muted" title="CellarTracker no longer reports this record. Restoring it will have no visible effect until a file containing it is imported.">No longer in the file</span>}
              </td>
              <td className="px-3 py-2 align-top tabular-nums">{formatDate(row.excluded_at)}</td>
              <td className="px-3 py-2 align-top">
                <form action={restoreCellarTrackerRecord.bind(null, row.match_group_key, row.source_wine)}>
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
