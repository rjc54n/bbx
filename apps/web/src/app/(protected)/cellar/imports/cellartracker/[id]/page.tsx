import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOwner } from "@/lib/auth/owner";
import { acceptCellarTrackerImport, deleteCellarTrackerImport, discardCellarTrackerImportRow, repairCellarTrackerImportRow } from "../actions";

export const dynamic = "force-dynamic";

type EvidenceRow = { source_row_number:number; source_wine:string; vintage:number|null; total_quantity:number; quantity_home:number; quantity_bbr:number; fully_consumed:boolean; purchase_price_per_bottle_p:number|null };
type InvalidRow = { source_row_number:number; validation_errors:unknown; raw_row:Record<string,string> };
type ImportPreview = { record_count:number; link_count:number; price_count:number; price_conflict_count:number; excluded_count:number; new_record_count:number };
const errors = (value:unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
const count = (value:string|undefined) => Number.parseInt(value ?? "0", 10) || 0;

export default async function CellarTrackerImportPage({ params, searchParams }: { params:Promise<{id:string}>; searchParams:Promise<Record<string,string|undefined>> }) {
  const { id } = await params;
  const query = await searchParams;
  const { supabase } = await requireOwner();
  const [{ data: record, error: recordError }, { data: evidence, error: evidenceError }, { data: invalidData, error: invalidError }] = await Promise.all([
    supabase.from("cellar_imports").select("id, original_filename, byte_size, uploaded_at, parser_version, status, source_row_count, parsed_row_count, unmatched_row_count, warning_row_count, error_row_count, accepted_at").eq("id", id).eq("source_type", "cellartracker_inventory").maybeSingle(),
    supabase.from("cellartracker_evidence").select("source_row_number,source_wine,vintage,total_quantity,quantity_home,quantity_bbr,fully_consumed,purchase_price_per_bottle_p").eq("import_id", id).order("source_row_number"),
    supabase.from("cellar_import_rows").select("source_row_number, validation_errors, raw_row").eq("import_id", id).eq("match_status", "invalid").order("source_row_number"),
  ]);
  if (recordError || evidenceError || invalidError) throw new Error("The CellarTracker import preview could not be loaded.");
  if (!record) notFound();
  const rows = (evidence ?? []) as EvidenceRow[];
  const invalidRows = (invalidData ?? []) as InvalidRow[];
  const canAccept = record.status === "validated" && record.error_row_count === 0;
  // What accepting would carry over from decisions already made. Read before
  // accepting so the owner sees it while the choice is still theirs.
  const { data: previewData } = await supabase.rpc("preview_cellartracker_import", { p_import_id: id });
  const preview = previewData as ImportPreview | null;
  const carriesAnything = Boolean(preview && (preview.link_count || preview.price_count || preview.excluded_count));
  const pounds = (pence:number|null) => pence === null ? "Not supplied" : new Intl.NumberFormat("en-GB", { style:"currency", currency:"GBP" }).format(pence / 100);
  return <main className="min-h-0 flex-1 overflow-auto bg-accent-soft"><div className="mx-auto max-w-7xl space-y-5 p-5">
    <nav className="flex flex-wrap gap-4 text-sm"><Link href="/cellar/imports" className="text-accent underline-offset-2 hover:underline">Back to imports</Link><Link href="/cellartracker" className="text-accent underline-offset-2 hover:underline">My CellarTracker</Link></nav>
    {query.duplicate && <p className="rounded border border-border bg-background px-4 py-3 text-sm">This exact file was already uploaded. The existing immutable import is shown below.</p>}
    {query.accepted && <div className="rounded border border-green-700/30 bg-green-50 px-4 py-3 text-sm text-green-900">
      <p>This report is now the accepted CellarTracker snapshot.</p>
      <p className="mt-1">Carried over from your previous decisions: <strong>{count(query.links)}</strong> product link{count(query.links) === 1 ? "" : "s"}, <strong>{count(query.prices)}</strong> price correction{count(query.prices) === 1 ? "" : "s"} and <strong>{count(query.excluded)}</strong> excluded record{count(query.excluded) === 1 ? "" : "s"}.</p>
      {count(query.conflicts) > 0 && <p className="mt-1">
        <strong>{count(query.conflicts)}</strong> price correction{count(query.conflicts) === 1 ? " was" : "s were"} held back because CellarTracker now reports a different value. The new source value was kept. Review those records and re-correct them if the source is still wrong.
      </p>}
    </div>}
    {query.accept_error && <p role="alert" className="rounded border border-accent/30 bg-accent-soft px-4 py-3 text-sm text-accent">This import cannot be accepted because it has invalid rows. Review the import counts and upload a corrected full report.</p>}
    {query.discarded && <p className="rounded border border-green-700/30 bg-green-50 px-4 py-3 text-sm text-green-900">The invalid source row was discarded. You can accept the snapshot once no invalid rows remain.</p>}
    {query.discard_error && <p role="alert" className="rounded border border-accent/30 bg-accent-soft px-4 py-3 text-sm text-accent">The selected invalid row could not be discarded.</p>}
    {query.repaired && <p className="rounded border border-green-700/30 bg-green-50 px-4 py-3 text-sm text-green-900">The source price was repaired.</p>}
    {query.repair_error && <p role="alert" className="rounded border border-accent/30 bg-accent-soft px-4 py-3 text-sm text-accent">The source price could not be repaired. Enter a non-negative GBP amount with up to two decimal places.</p>}
    {query.delete_error && <p role="alert" className="rounded border border-accent/30 bg-accent-soft px-4 py-3 text-sm text-accent">The import could not be deleted. Its source object and evidence were left available.</p>}
    <section className="rounded-lg border border-border bg-background p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-wide text-accent">{record.status}</p><h1 className="mt-1 text-xl font-semibold">{record.original_filename}</h1><p className="mt-1 text-sm text-ink-muted">{record.source_row_count} rows · {(record.byte_size / 1024).toFixed(1)} KB · parser {record.parser_version}</p></div>{canAccept && <form action={acceptCellarTrackerImport.bind(null, id)}><button className="rounded bg-accent px-4 py-2 text-sm font-medium text-accent-ink">Accept this snapshot</button></form>}</div>{record.error_row_count > 0 && <p className="mt-4 text-sm text-accent">{record.error_row_count} invalid {record.error_row_count === 1 ? "row prevents" : "rows prevent"} acceptance.</p>}</section>
    <section className="grid gap-3 sm:grid-cols-4">{[["Source rows",record.source_row_count],["Valid",record.parsed_row_count],["Warnings",record.warning_row_count],["Invalid",record.error_row_count]].map(([label,value])=><div key={String(label)} className="rounded-lg border border-border bg-background p-4"><p className="text-xs uppercase tracking-wide text-ink-muted">{label}</p><p className="mt-1 text-lg font-semibold tabular-nums">{value}</p></div>)}</section>

    {/* A CellarTracker file is a full snapshot, so accepting one replaces the
        active dataset. This is the panel that says what accepting will keep,
        rather than letting the upload quietly undo the owner's work. */}
    {canAccept && preview && <section aria-labelledby="carried-decisions" className="rounded-lg border border-accent/30 bg-background p-5">
      <h2 id="carried-decisions" className="font-semibold">What accepting this file will keep</h2>
      <p className="mt-1 max-w-3xl text-sm text-ink-muted">
        {carriesAnything
          ? "This file replaces the active snapshot. Your product links, price corrections and exclusions are re-applied to it automatically, and each one stays reversible afterwards."
          : "This file replaces the active snapshot. There are no earlier decisions to carry over, so it will be accepted exactly as supplied."}
      </p>
      <dl className="mt-4 grid gap-3 sm:grid-cols-4">
        <div className="rounded border border-border p-3">
          <dt className="text-xs uppercase tracking-wide text-ink-muted">Links re-applied</dt>
          <dd className="mt-1 text-lg font-semibold tabular-nums">{preview.link_count}</dd>
        </div>
        <div className="rounded border border-border p-3">
          <dt className="text-xs uppercase tracking-wide text-ink-muted">Price corrections</dt>
          <dd className="mt-1 text-lg font-semibold tabular-nums">{preview.price_count}</dd>
        </div>
        <div className="rounded border border-border p-3">
          <dt className="text-xs uppercase tracking-wide text-ink-muted">Kept excluded</dt>
          <dd className="mt-1 text-lg font-semibold tabular-nums">{preview.excluded_count}</dd>
        </div>
        <div className="rounded border border-border p-3">
          <dt className="text-xs uppercase tracking-wide text-ink-muted">New to you</dt>
          <dd className="mt-1 text-lg font-semibold tabular-nums">{preview.new_record_count}</dd>
        </div>
      </dl>
      {preview.price_conflict_count > 0 && <p className="mt-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
        CellarTracker now reports a different price on {preview.price_conflict_count} record{preview.price_conflict_count === 1 ? "" : "s"} you had corrected. The new source value will be kept rather than overwritten, because it may be the upstream fix.
      </p>}
    </section>}
    {invalidRows.length > 0 && <section className="rounded-lg border border-accent/30 bg-background"><div className="border-b border-border px-5 py-3"><h2 className="font-semibold">Invalid source rows</h2><p className="mt-1 text-sm text-ink-muted">Correct any validation-driving source field, including a zero price, then save the row.</p></div><div className="divide-y divide-border">{invalidRows.map((row)=><div key={row.source_row_number} className="space-y-3 px-5 py-4"><p className="text-sm">Row {row.source_row_number}: {errors(row.validation_errors).join(" ")}</p><form action={repairCellarTrackerImportRow.bind(null,id,row.source_row_number)} className="grid gap-2 sm:grid-cols-4"><input type="hidden" name="raw_row" value={JSON.stringify(row.raw_row)}/>{["Wine","Vintage","Size","Currency","Price","TotalQuantity","Quantity","Pending"].map(field=><label key={field} className="grid gap-1 text-xs text-ink-muted">{field}<input name={field} defaultValue={row.raw_row[field]??""} className="rounded border border-border px-2 py-1 text-sm text-ink"/></label>)}<div className="flex items-end gap-2"><button className="rounded border border-accent px-3 py-1.5 text-sm text-accent hover:bg-accent-soft">Save row</button></div></form><details className="text-xs text-ink-muted"><summary className="cursor-pointer">Show original source row</summary><dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">{Object.entries(row.raw_row).map(([key,value])=><><dt key={`${key}-label`}>{key}</dt><dd key={`${key}-value`} className="text-ink">{value||"-"}</dd></>)}</dl></details><form action={discardCellarTrackerImportRow.bind(null,id,row.source_row_number)}><button className="rounded border border-accent px-3 py-1.5 text-sm text-accent hover:bg-accent-soft">Discard row</button></form></div>)}</div></section>}
    {record.status !== "accepted" && <section className="rounded-lg border border-accent/30 bg-background p-5"><h2 className="font-semibold">Delete this import</h2><p className="mt-1 text-sm text-ink-muted">Delete the private source file and every staged record in this unaccepted import.</p><form className="mt-3" action={deleteCellarTrackerImport.bind(null,id)}><button className="rounded border border-accent px-3 py-2 text-sm text-accent hover:bg-accent-soft">Delete import</button></form></section>}
    <section className="overflow-auto rounded-lg border border-border bg-background"><h2 className="border-b border-border px-5 py-3 font-semibold">Staged records</h2><table className="w-full min-w-[700px] text-sm"><thead className="text-left text-xs uppercase tracking-wide text-ink-muted"><tr><th className="p-3">Wine</th><th className="p-3">Vintage</th><th className="p-3">Home</th><th className="p-3">BBR</th><th className="p-3">Paid per bottle</th></tr></thead><tbody>{rows.map((row)=><tr key={row.source_row_number} className="border-t border-border"><td className="p-3">{row.source_wine}{row.fully_consumed && <span className="ml-2 text-xs text-ink-muted">Consumed</span>}</td><td className="p-3">{row.vintage ?? "-"}</td><td className="p-3">{row.quantity_home}</td><td className="p-3">{row.quantity_bbr}</td><td className="p-3">{pounds(row.purchase_price_per_bottle_p)}</td></tr>)}</tbody></table></section>
  </div></main>;
}
