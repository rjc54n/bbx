import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOwner } from "@/lib/auth/owner";
import { acceptBbrImport } from "../actions";

export const dynamic = "force-dynamic";

// Slice 1 of the BBR holdings history plan: acceptance is paused before
// Slice 2's migration adds effective-date and current/historical role to
// acceptance, so no release ships a button the database will refuse.
// Revert this one line once that migration is live.
const BBR_ACCEPTANCE_FROZEN = true;

type ImportRecord = {
  id: string;
  original_filename: string;
  content_checksum: string;
  byte_size: number;
  uploaded_at: string;
  parser_version: string;
  status: string;
  source_row_count: number;
  parsed_row_count: number;
  matched_row_count: number;
  unmatched_row_count: number;
  warning_row_count: number;
  error_row_count: number;
  failure_summary: string | null;
  accepted_at: string | null;
};

type ImportRowResult = {
  source_row_number: number;
  match_status: string;
  validation_errors: unknown;
  validation_warnings: unknown;
};

type EvidenceRow = {
  source_row_number: number;
  parent_sku: string;
  format_code: string;
  product_code: string;
  description: string;
  vintage: number | null;
  quantity_bottles: number;
  case_size: number;
  bottle_volume_ml: number;
  purchase_price_per_case_p: number | null;
};

type CurrentHolding = {
  parent_sku: string;
  format_code: string;
  quantity_bottles: number;
};

function dateTime(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/London",
  }).format(new Date(value));
}

function pounds(pence: number | null): string {
  if (pence === null) return "Not supplied";
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: pence % 100 === 0 ? 0 : 2,
  }).format(pence / 100);
}

function messages(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function holdingKey(row: { parent_sku: string; format_code: string }): string {
  return `${row.parent_sku}|${row.format_code}`;
}

export default async function BbrImportPage({
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
    { data: evidenceData, error: evidenceError },
    { data: rowData, error: rowError },
  ] = await Promise.all([
    supabase
      .from("cellar_imports")
      .select(
        "id, original_filename, content_checksum, byte_size, uploaded_at, parser_version, status, source_row_count, parsed_row_count, matched_row_count, unmatched_row_count, warning_row_count, error_row_count, failure_summary, accepted_at",
      )
      .eq("id", id)
      .eq("source_type", "bbr_holdings")
      .maybeSingle(),
    supabase
      .from("bbr_holding_evidence")
      .select(
        "source_row_number, parent_sku, format_code, product_code, description, vintage, quantity_bottles, case_size, bottle_volume_ml, purchase_price_per_case_p",
      )
      .eq("import_id", id)
      .order("source_row_number"),
    supabase
      .from("cellar_import_rows")
      .select("source_row_number, match_status, validation_errors, validation_warnings")
      .eq("import_id", id)
      .order("source_row_number"),
  ]);

  if (importError || evidenceError || rowError) {
    throw new Error("The BBR import preview could not be loaded.");
  }
  if (!importData) notFound();

  const importRecord = importData as ImportRecord;
  const evidence = (evidenceData ?? []) as EvidenceRow[];
  const rowResults = (rowData ?? []) as ImportRowResult[];

  let diff: { additions: number; removals: number; changes: number } | null = null;
  if (importRecord.status === "validated") {
    const { data: currentData, error: currentError } = await supabase
      .from("current_bbr_holdings")
      .select("parent_sku, format_code, quantity_bottles");
    if (currentError) throw new Error("The accepted BBR baseline could not be loaded.");

    const current = (currentData ?? []) as CurrentHolding[];
    const currentMap = new Map(current.map((row) => [holdingKey(row), row.quantity_bottles]));
    const proposedMap = new Map(evidence.map((row) => [holdingKey(row), row.quantity_bottles]));
    diff = {
      additions: [...proposedMap.keys()].filter((key) => !currentMap.has(key)).length,
      removals: [...currentMap.keys()].filter((key) => !proposedMap.has(key)).length,
      changes: [...proposedMap.entries()].filter(
        ([key, quantity]) => currentMap.has(key) && currentMap.get(key) !== quantity,
      ).length,
    };
  }

  const totalBottles = evidence.reduce((total, row) => total + row.quantity_bottles, 0);
  const issues = rowResults.filter(
    (row) => row.match_status !== "matched"
      || messages(row.validation_errors).length > 0
      || messages(row.validation_warnings).length > 0,
  );

  return (
    <main className="min-h-0 flex-1 overflow-auto bg-accent-soft">
      <div className="mx-auto max-w-7xl space-y-5 p-5">
        <nav className="flex flex-wrap gap-4 text-sm">
          <Link href="/cellar/imports/bbr" className="text-accent underline-offset-2 hover:underline">
            Back to BBR imports
          </Link>
          <Link href="/cellar/bbr" className="text-accent underline-offset-2 hover:underline">
            My BBR Cellar
          </Link>
        </nav>

        {query.duplicate && (
          <p className="rounded border border-border bg-background px-4 py-3 text-sm">
            This exact file was already uploaded. The existing immutable import is shown below.
          </p>
        )}
        {query.accepted && (
          <p className="rounded border border-green-700/30 bg-green-50 px-4 py-3 text-sm text-green-900">
            This snapshot is now the accepted BBR cellar.
          </p>
        )}
        {query.accept_error && (
          <p className="rounded border border-accent/30 bg-accent-soft px-4 py-3 text-sm text-accent" role="alert">
            The import could not be accepted. It may contain errors or no longer be in a validated state.
          </p>
        )}

        <section className="rounded-lg border border-border bg-background p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-accent">
                {importRecord.status}
              </p>
              <h2 className="mt-1 text-xl font-semibold">{importRecord.original_filename}</h2>
              <p className="mt-1 text-sm text-ink-muted">
                Uploaded {dateTime(importRecord.uploaded_at)} · {(importRecord.byte_size / 1024).toFixed(1)} KB · parser {importRecord.parser_version}
              </p>
              <p className="mt-1 font-mono text-xs text-ink-muted">
                SHA-256 {importRecord.content_checksum}
              </p>
            </div>
            {importRecord.status === "validated" && (
              BBR_ACCEPTANCE_FROZEN ? (
                <div className="max-w-xs text-right">
                  <button
                    type="button"
                    disabled
                    className="rounded bg-accent px-4 py-2 text-sm font-medium text-accent-ink disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Accept this snapshot
                  </button>
                  <p className="mt-2 text-xs text-ink-muted">
                    Acceptance is paused while snapshot dating is added.
                    Soon you&apos;ll set an effective date and mark each
                    snapshot as the current holding or a historical one
                    before accepting.
                  </p>
                </div>
              ) : (
                <form action={acceptBbrImport.bind(null, importRecord.id)}>
                  <button
                    type="submit"
                    className="rounded bg-accent px-4 py-2 text-sm font-medium text-accent-ink"
                  >
                    Accept this snapshot
                  </button>
                </form>
              )
            )}
          </div>
        </section>

        <section className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {[
            ["Source rows", importRecord.source_row_count],
            ["Matched", importRecord.matched_row_count],
            ["Unmatched", importRecord.unmatched_row_count],
            ["Invalid", importRecord.error_row_count],
            ["Bottles", totalBottles],
            ["Accepted", importRecord.accepted_at ? dateTime(importRecord.accepted_at) : "No"],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border border-border bg-background p-4">
              <p className="text-xs uppercase tracking-wide text-ink-muted">{label}</p>
              <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
            </div>
          ))}
        </section>

        {diff && (
          <section className="rounded-lg border border-border bg-background p-5">
            <h2 className="font-semibold">Change from the accepted BBR cellar</h2>
            <div className="mt-3 flex flex-wrap gap-5 text-sm">
              <span><strong className="tabular-nums">{diff.additions}</strong> additions</span>
              <span><strong className="tabular-nums">{diff.removals}</strong> removals</span>
              <span><strong className="tabular-nums">{diff.changes}</strong> quantity changes</span>
            </div>
          </section>
        )}

        {issues.length > 0 && (
          <section className="rounded-lg border border-accent/30 bg-background">
            <div className="border-b border-border px-5 py-3">
              <h2 className="font-semibold">Rows requiring attention</h2>
            </div>
            <div className="divide-y divide-border">
              {issues.map((row) => (
                <div key={row.source_row_number} className="px-5 py-3 text-sm">
                  <p className="font-medium">
                    Source row {row.source_row_number}: {row.match_status}
                  </p>
                  {[...messages(row.validation_errors), ...messages(row.validation_warnings)].map((message) => (
                    <p key={message} className="mt-1 text-ink-muted">{message}</p>
                  ))}
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="overflow-hidden rounded-lg border border-border bg-background">
          <div className="border-b border-border px-5 py-3">
            <h2 className="font-semibold">Matched BBR holdings</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-ink-muted">
                <tr>
                  <th className="px-4 py-2">Wine</th>
                  <th className="px-4 py-2">Parent ID</th>
                  <th className="px-4 py-2">Format</th>
                  <th className="px-4 py-2 text-right">Bottles</th>
                  <th className="px-4 py-2 text-right">Purchase case</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {evidence.map((row) => (
                  <tr key={`${row.parent_sku}|${row.format_code}`}>
                    <td className="px-4 py-2">
                      <p className="font-medium">{row.description}</p>
                      <p className="text-xs text-ink-muted">{row.vintage ?? "NV"} · {row.product_code}</p>
                    </td>
                    <td className="px-4 py-2 font-mono text-xs">{row.parent_sku}</td>
                    <td className="px-4 py-2">{row.case_size} × {row.bottle_volume_ml} ml</td>
                    <td className="px-4 py-2 text-right tabular-nums">{row.quantity_bottles}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{pounds(row.purchase_price_per_case_p)}</td>
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
