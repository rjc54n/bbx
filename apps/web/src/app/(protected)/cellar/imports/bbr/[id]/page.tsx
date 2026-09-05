import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOwner } from "@/lib/auth/owner";
import {
  acceptBbrSnapshot,
  setBbrImportEffectiveDate,
  stageBbrDuplicateSnapshot,
} from "../actions";
import {
  diffCurrentSnapshot,
  suggestEffectiveDate,
  type SnapshotPositionRow,
} from "@/lib/cellar/bbrSnapshots";

export const dynamic = "force-dynamic";

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
  effective_date: string | null;
  accepted_role: string | null;
  superseded_at: string | null;
  superseded_by: string | null;
};

type ImportRowResult = {
  source_row_number: number;
  match_status: string;
  validation_errors: unknown;
  validation_warnings: unknown;
};

type EvidenceRow = SnapshotPositionRow & {
  source_row_number: number;
  product_code: string;
  case_size: number;
  bottle_volume_ml: number;
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

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function positionLabel(row: { description: string; vintage: number | null; parent_sku: string; format_code: string }): string {
  return `${row.description} (${row.vintage ?? "NV"}) -- ${row.parent_sku} / ${row.format_code}`;
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
    { data: nominatedData, error: nominatedError },
  ] = await Promise.all([
    supabase
      .from("cellar_imports")
      .select(
        "id, original_filename, content_checksum, byte_size, uploaded_at, parser_version, status, source_row_count, parsed_row_count, matched_row_count, unmatched_row_count, warning_row_count, error_row_count, failure_summary, accepted_at, effective_date, accepted_role, superseded_at, superseded_by",
      )
      .eq("id", id)
      .eq("source_type", "bbr_holdings")
      .maybeSingle(),
    supabase
      .from("bbr_holding_evidence")
      .select(
        "source_row_number, parent_sku, format_code, product_code, description, vintage, quantity_bottles, case_size, bottle_volume_ml, purchase_price_per_case_p, catalogue_matched",
      )
      .eq("import_id", id)
      .order("source_row_number"),
    supabase
      .from("cellar_import_rows")
      .select("source_row_number, match_status, validation_errors, validation_warnings")
      .eq("import_id", id)
      .order("source_row_number"),
    supabase
      .from("cellar_imports")
      .select("id")
      .eq("source_type", "bbr_holdings")
      .eq("status", "accepted")
      .eq("accepted_role", "current")
      .is("superseded_at", null)
      .maybeSingle(),
  ]);

  if (importError || evidenceError || rowError || nominatedError) {
    throw new Error("The BBR import preview could not be loaded.");
  }
  if (!importData) notFound();

  const importRecord = importData as ImportRecord;
  const evidence = (evidenceData ?? []) as EvidenceRow[];
  const rowResults = (rowData ?? []) as ImportRowResult[];
  const nominatedImportId = nominatedData?.id as string | undefined;

  let diff: ReturnType<typeof diffCurrentSnapshot> | null = null;
  if (importRecord.status === "validated") {
    let currentRows: SnapshotPositionRow[] = [];
    if (nominatedImportId && nominatedImportId !== importRecord.id) {
      const { data: currentData, error: currentError } = await supabase
        .from("bbr_holding_evidence")
        .select("parent_sku, format_code, description, vintage, quantity_bottles, purchase_price_per_case_p, catalogue_matched")
        .eq("import_id", nominatedImportId);
      if (currentError) throw new Error("The nominated current snapshot could not be loaded.");
      currentRows = (currentData ?? []) as SnapshotPositionRow[];
    }
    diff = diffCurrentSnapshot(currentRows, evidence);
  }

  const totalBottles = evidence.reduce((total, row) => total + row.quantity_bottles, 0);
  const issues = rowResults.filter(
    (row) => row.match_status !== "matched"
      || messages(row.validation_errors).length > 0
      || messages(row.validation_warnings).length > 0,
  );

  const canAccept = importRecord.status === "validated";
  const suggestedDate = importRecord.effective_date ?? suggestEffectiveDate(importRecord.original_filename) ?? "";

  const pendingImportId = firstParam(query.pendingImportId);
  const pendingFilename = firstParam(query.pendingFilename) ?? "bbr-holdings.csv";
  const dateError = firstParam(query.date_error);
  const acceptError = firstParam(query.accept_error);
  const stageError = firstParam(query.stage_error);

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
          <section className="space-y-3 rounded border border-border bg-background px-4 py-3 text-sm">
            <p>
              This exact file was already uploaded
              {importRecord.effective_date
                ? ` as the ${importRecord.accepted_role ?? "staged"} snapshot for ${importRecord.effective_date}`
                : ""}
              . The existing import is shown below -- opening it is the default action.
            </p>
            {pendingImportId && (
              <div className="space-y-2 border-t border-border pt-3">
                <p className="text-ink-muted">
                  A byte-identical export downloaded on a later date is still valid evidence that the
                  position was held on that date. You may instead record the file you just uploaded as
                  a separate snapshot with its own effective date.
                </p>
                {stageError && (
                  <p role="alert" className="text-accent">{stageError}</p>
                )}
                <form action={stageBbrDuplicateSnapshot.bind(null, importRecord.id, pendingImportId, pendingFilename)}>
                  <button
                    type="submit"
                    className="rounded border border-accent px-3 py-1.5 text-sm font-medium text-accent"
                  >
                    Stage this file as a new snapshot instead
                  </button>
                </form>
              </div>
            )}
          </section>
        )}
        {query.accepted && (
          <p className="rounded border border-green-700/30 bg-green-50 px-4 py-3 text-sm text-green-900">
            This snapshot is now the accepted BBR cellar.
          </p>
        )}
        {acceptError && (
          <p className="rounded border border-accent/30 bg-accent-soft px-4 py-3 text-sm text-accent" role="alert">
            {acceptError}
          </p>
        )}

        <section className="rounded-lg border border-border bg-background p-5">
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
            {importRecord.accepted_role && (
              <p className="mt-1 text-sm text-ink-muted">
                Accepted as the <strong>{importRecord.accepted_role}</strong> snapshot for{" "}
                <strong>{importRecord.effective_date}</strong>
                {importRecord.superseded_at ? " (since superseded)" : ""}.
              </p>
            )}
          </div>
        </section>

        {canAccept && (
          <section className="space-y-4 rounded-lg border border-border bg-background p-5">
            <h2 className="font-semibold">Snapshot date and acceptance</h2>

            {dateError && (
              <p role="alert" className="text-sm text-accent">{dateError}</p>
            )}

            <form action={setBbrImportEffectiveDate.bind(null, importRecord.id)} className="flex flex-wrap items-end gap-3">
              <div>
                <label htmlFor="effective_date" className="block text-sm font-medium">
                  Effective date
                </label>
                <p className="text-xs text-ink-muted">
                  The date this file describes your holdings, not when you found or uploaded it.
                  {suggestedDate && !importRecord.effective_date
                    ? " Suggested from the filename -- confirm or replace it."
                    : ""}
                </p>
                <input
                  id="effective_date"
                  name="effective_date"
                  type="date"
                  required
                  defaultValue={suggestedDate}
                  className="mt-2 rounded border border-border bg-background px-3 py-1.5 text-sm"
                />
              </div>
              <button
                type="submit"
                className="rounded border border-border px-3 py-1.5 text-sm font-medium"
              >
                {importRecord.effective_date ? "Change date" : "Confirm date"}
              </button>
            </form>

            {importRecord.effective_date ? (
              <form action={acceptBbrSnapshot.bind(null, importRecord.id)} className="space-y-3 border-t border-border pt-4">
                <input type="hidden" name="effective_date" value={importRecord.effective_date} />
                <fieldset>
                  <legend className="text-sm font-medium">Snapshot role</legend>
                  <p className="mt-1 text-xs text-ink-muted">
                    Historical acceptance is not available yet. Accepting as current makes every
                    currently held position not present in this file formerly held, with an unknown
                    exit reason -- nothing changes until you accept.
                  </p>
                  <label className="mt-2 flex items-center gap-2 text-sm">
                    <input type="radio" name="role" value="current" required />
                    Current holdings -- this file becomes the complete current truth
                  </label>
                </fieldset>
                <button
                  type="submit"
                  className="rounded bg-accent px-4 py-2 text-sm font-medium text-accent-ink"
                >
                  Accept this snapshot for {importRecord.effective_date}
                </button>
              </form>
            ) : (
              <p className="border-t border-border pt-4 text-sm text-ink-muted">
                Confirm an effective date above before this snapshot can be accepted.
              </p>
            )}
          </section>
        )}

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
          <section className="space-y-4 rounded-lg border border-border bg-background p-5">
            <div>
              <h2 className="font-semibold">Change from the nominated current snapshot</h2>
              <p className="text-sm text-ink-muted">
                Every position that will change is named below, not just counted -- counts alone
                cannot show which position stops being current (spec 4.4).
              </p>
            </div>

            <DiffList
              title={`New current positions (${diff.newCurrent.length})`}
              rows={diff.newCurrent}
            />
            <DiffList
              title={`Becoming former, unknown exit reason (${diff.becomingFormer.length})`}
              rows={diff.becomingFormer}
              empty="No currently held position is missing from this file."
            />
            {diff.quantityChanges.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold">Quantity changes ({diff.quantityChanges.length})</h3>
                <ul className="mt-2 space-y-1 text-sm">
                  {diff.quantityChanges.map((row) => (
                    <li key={`${row.parent_sku}|${row.format_code}`}>
                      {positionLabel(row)}: {row.fromQuantityBottles} → {row.toQuantityBottles} bottles
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {diff.reportedPriceChanges.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold">Reported purchase-price changes ({diff.reportedPriceChanges.length})</h3>
                <ul className="mt-2 space-y-1 text-sm">
                  {diff.reportedPriceChanges.map((row) => (
                    <li key={`${row.parent_sku}|${row.format_code}`}>
                      {positionLabel(row)}: {pounds(row.fromPurchasePricePerCaseP)} → {pounds(row.toPurchasePricePerCaseP)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {diff.undecorated.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold">Rows without catalogue decoration ({diff.undecorated.length})</h3>
                <ul className="mt-2 space-y-1 text-sm text-ink-muted">
                  {diff.undecorated.map((row) => (
                    <li key={`${row.parent_sku}|${row.format_code}`}>{positionLabel(row)}</li>
                  ))}
                </ul>
              </div>
            )}
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
                      <p className="text-xs text-ink-muted">
                        {row.vintage ?? "NV"} · {row.product_code}
                        {!row.catalogue_matched && " · no catalogue match"}
                      </p>
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

function DiffList({
  title,
  rows,
  empty,
}: {
  title: string;
  rows: { parent_sku: string; format_code: string; description: string; vintage: number | null }[];
  empty?: string;
}) {
  if (rows.length === 0) {
    return empty ? <p className="text-sm text-ink-muted">{empty}</p> : null;
  }
  return (
    <div>
      <h3 className="text-sm font-semibold">{title}</h3>
      <ul className="mt-2 space-y-1 text-sm">
        {rows.map((row) => (
          <li key={`${row.parent_sku}|${row.format_code}`}>{positionLabel(row)}</li>
        ))}
      </ul>
    </div>
  );
}
