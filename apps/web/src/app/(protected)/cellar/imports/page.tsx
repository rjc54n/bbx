import Link from "next/link";
import { requireOwner } from "@/lib/auth/owner";

export const dynamic = "force-dynamic";

type ImportSummary = {
  accepted_at: string | null;
  original_filename: string;
  source_row_count: number;
  status: string;
  uploaded_at: string;
};

function dateTime(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/London",
  }).format(new Date(value));
}

export default async function ImportsPage() {
  const { supabase } = await requireOwner();
  const { data, error } = await supabase
    .from("cellar_imports")
    .select(
      "accepted_at, original_filename, source_row_count, status, uploaded_at",
    )
    .eq("source_type", "bbr_holdings")
    .order("uploaded_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error("Import status could not be loaded.");
  const latest = data as ImportSummary | null;

  return (
    <main className="min-h-0 flex-1 overflow-auto bg-accent-soft">
      <div className="mx-auto max-w-5xl space-y-5 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-accent">
              Data management
            </p>
            <h1 className="mt-1 text-2xl font-semibold">Import data</h1>
            <p className="mt-1 text-sm text-ink-muted">
              Upload and review source snapshots before they become the current
              cellar record.
            </p>
          </div>
          <Link
            href="/cellar/bbr"
            className="text-sm text-accent underline-offset-2 hover:underline"
          >
            Back to My BBR Cellar
          </Link>
        </div>

        <Link
          href="/cellar/imports/bbr"
          className="block rounded-lg border border-border bg-background p-5 hover:border-accent"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-semibold">BBR holdings</p>
              <p className="mt-1 text-sm text-ink-muted">
                Upload a BBR My Cellar CSV, review its matches and accept it as
                the current BBR-held snapshot.
              </p>
            </div>
            <span className="text-sm font-medium text-accent">
              Manage imports
            </span>
          </div>
          {latest ? (
            <p className="mt-4 text-xs text-ink-muted">
              Latest: {latest.original_filename}, {latest.source_row_count} rows,
              {" "}{latest.status}, uploaded {dateTime(latest.uploaded_at)}
              {latest.accepted_at
                ? ` and accepted ${dateTime(latest.accepted_at)}`
                : ""}
            </p>
          ) : (
            <p className="mt-4 text-xs text-ink-muted">No upload recorded.</p>
          )}
        </Link>
      </div>
    </main>
  );
}
