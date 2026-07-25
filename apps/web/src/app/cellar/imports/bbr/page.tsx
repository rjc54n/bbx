import Link from "next/link";
import { requireOwner } from "@/lib/auth/owner";
import { BbrUploadForm } from "./BbrUploadForm";
import { CellarHeader } from "./CellarHeader";

export const dynamic = "force-dynamic";

type ImportSummary = {
  id: string;
  original_filename: string;
  uploaded_at: string;
  status: string;
  source_row_count: number;
  matched_row_count: number;
  unmatched_row_count: number;
  error_row_count: number;
  accepted_at: string | null;
};

function dateTime(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/London",
  }).format(new Date(value));
}

export default async function BbrImportsPage() {
  const { supabase } = await requireOwner();
  const [{ data, error }, { count, error: holdingsError }] = await Promise.all([
    supabase
      .from("cellar_imports")
      .select(
        "id, original_filename, uploaded_at, status, source_row_count, matched_row_count, unmatched_row_count, error_row_count, accepted_at",
      )
      .eq("source_type", "bbr_holdings")
      .order("uploaded_at", { ascending: false })
      .limit(20),
    supabase
      .from("current_bbr_holdings")
      .select("*", { count: "exact", head: true }),
  ]);

  if (error || holdingsError) {
    throw new Error("The BBR import history could not be loaded.");
  }
  const imports = (data ?? []) as ImportSummary[];

  return (
    <main className="min-h-0 flex-1 overflow-auto bg-accent-soft">
      <CellarHeader />
      <div className="mx-auto max-w-6xl space-y-6 p-5">
        <section className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-border bg-background p-4">
            <p className="text-xs uppercase tracking-wide text-ink-muted">Accepted wine-format rows</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{(count ?? 0).toLocaleString()}</p>
          </div>
          <div className="rounded-lg border border-border bg-background p-4 sm:col-span-2">
            <p className="text-sm text-ink-muted">
              BBR is the current source for wine held in bond. Uploads are immutable snapshots and require explicit acceptance.
            </p>
          </div>
        </section>

        <BbrUploadForm />

        <section className="rounded-lg border border-border bg-background">
          <div className="border-b border-border px-5 py-3">
            <h2 className="font-semibold">Import history</h2>
          </div>
          {imports.length === 0 ? (
            <p className="px-5 py-8 text-sm text-ink-muted">No BBR holdings file has been uploaded.</p>
          ) : (
            <div className="divide-y divide-border">
              {imports.map((item) => (
                <Link
                  key={item.id}
                  href={`/cellar/imports/bbr/${item.id}`}
                  className="grid gap-2 px-5 py-3 hover:bg-accent-soft sm:grid-cols-[minmax(0,1fr)_9rem_8rem]"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{item.original_filename}</p>
                    <p className="text-xs text-ink-muted">
                      {item.source_row_count} rows, {item.matched_row_count} matched, {item.unmatched_row_count} unmatched
                      {item.error_row_count > 0 ? `, ${item.error_row_count} invalid` : ""}
                    </p>
                  </div>
                  <p className="text-sm text-ink-muted sm:text-right">{dateTime(item.uploaded_at)}</p>
                  <p className="text-sm font-medium capitalize text-accent sm:text-right">{item.status}</p>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
