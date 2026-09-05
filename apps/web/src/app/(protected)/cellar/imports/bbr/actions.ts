"use server";

import { createHash, randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getOwnerContext } from "@/lib/auth/owner";
import { createSignedUploadTarget, type UploadTarget } from "@/lib/imports/uploadTarget";
import {
  BBR_MAX_FILE_BYTES,
  BBR_PARSER_VERSION,
  BbrFileError,
  matchBbrRows,
  parseBbrCsv,
  type CatalogueFormat,
} from "@/lib/cellar/bbrParser";

type OwnerContext = NonNullable<Awaited<ReturnType<typeof getOwnerContext>>>;

function safeFilename(filename: string): string {
  const basename = filename.split(/[\\/]/).at(-1) ?? "bbr-holdings.csv";
  const cleaned = basename
    .replace(/\p{Cc}/gu, "")
    .trim()
    .slice(0, 255);
  return cleaned || "bbr-holdings.csv";
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

async function fetchCatalogueFormats(
  supabase: OwnerContext["supabase"],
  parentIds: string[],
): Promise<CatalogueFormat[]> {
  const formats: CatalogueFormat[] = [];
  for (const parentIdChunk of chunks(parentIds, 100)) {
    const { data, error } = await supabase
      .from("catalogue_view")
      .select("parent_sku, format_code, case_size, bottle_volume_ml")
      .in("parent_sku", parentIdChunk);
    if (error) throw new Error("The BBX catalogue could not be checked.");
    formats.push(...(data as CatalogueFormat[]));
  }
  return formats;
}

/**
 * Downloads a staged CSV from Storage, parses and matches it, and calls
 * stage_bbr_import. Shared by a fresh upload (processBbrUpload) and the D9
 * duplicate choice (stageBbrDuplicateSnapshot), which stages the same bytes a
 * second time under a new import id rather than re-uploading them.
 */
async function stageBbrFile(
  context: OwnerContext,
  input: { importId: string; objectPath: string; originalFilename: string; allowDuplicate: boolean },
): Promise<{ error: string } | { redirectTo: string }> {
  const { data: fileBlob, error: downloadError } = await context.supabase.storage
    .from("cellar-imports")
    .download(input.objectPath);
  if (downloadError || !fileBlob) {
    return { error: "The uploaded file could not be read from storage." };
  }

  // The bytes are already in the private bucket by the time any of the checks
  // below can run, so a rejection has to take them back out again. An object
  // left behind has no import row to reach it from and no owner-facing way to
  // remove it. The duplicate path is the one deliberate exception.
  const discardUpload = () =>
    context.supabase.storage.from("cellar-imports").remove([input.objectPath]);

  const bytes = new Uint8Array(await fileBlob.arrayBuffer());
  if (bytes.byteLength === 0) {
    await discardUpload();
    return { error: "Choose a non-empty BBR CSV file." };
  }
  if (bytes.byteLength > BBR_MAX_FILE_BYTES) {
    await discardUpload();
    return { error: "The file exceeds the 4 MB import limit." };
  }

  let csvText: string;
  try {
    csvText = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    await discardUpload();
    return { error: "The BBR file is not valid UTF-8 text." };
  }

  const checksum = createHash("sha256").update(bytes).digest("hex");

  let parsedRows;
  try {
    parsedRows = parseBbrCsv(csvText);
  } catch (error) {
    await discardUpload();
    if (error instanceof BbrFileError) return { error: error.message };
    return { error: "The BBR CSV could not be parsed." };
  }
  if (parsedRows.droppedTrailingRowCount > 0) {
    // Not yet surfaced to the owner in the UI -- see the parseBbrCsv doc comment.
    console.warn(
      `BBR import ${input.importId}: dropped ${parsedRows.droppedTrailingRowCount} trailing row(s) with a mismatched column count.`,
    );
  }

  const parentIds = [...new Set(
    parsedRows
      .map((row) => row.parent_sku)
      .filter((value): value is string => value !== null),
  )];

  let catalogueFormats: CatalogueFormat[];
  try {
    catalogueFormats = await fetchCatalogueFormats(context.supabase, parentIds);
  } catch {
    return { error: "The BBX catalogue could not be checked before import." };
  }
  const matchedRows = matchBbrRows(parsedRows, catalogueFormats);

  const { data: staged, error: stageError } = await context.supabase.rpc(
    "stage_bbr_import",
    {
      p_import_id: input.importId,
      p_content_checksum: checksum,
      p_original_filename: safeFilename(input.originalFilename),
      p_byte_size: bytes.byteLength,
      p_storage_object_path: input.objectPath,
      p_parser_version: BBR_PARSER_VERSION,
      p_rows: matchedRows,
      p_allow_duplicate: input.allowDuplicate,
    },
  );

  if (stageError) {
    await discardUpload();
    return { error: "The parsed import could not be recorded atomically." };
  }

  const result = staged as { import_id?: string; duplicate?: boolean } | null;
  const resultId = result?.import_id;
  if (!resultId) {
    await discardUpload();
    return { error: "The import backend returned an incomplete result." };
  }

  if (result.duplicate) {
    // D9: file identity is advisory. Opening the existing import stays the
    // default action -- do not remove the newly uploaded object, so the owner
    // can instead stage it as a separate snapshot without re-uploading.
    const params = new URLSearchParams({
      duplicate: "1",
      pendingImportId: input.importId,
      pendingFilename: input.originalFilename,
    });
    return { redirectTo: `/cellar/imports/bbr/${resultId}?${params.toString()}` };
  }

  revalidatePath("/cellar/imports/bbr");
  revalidatePath("/cellar/imports");
  return { redirectTo: `/cellar/imports/bbr/${resultId}` };
}

export async function createBbrUploadTarget(
  fileName: string,
  fileSize: number,
): Promise<UploadTarget | { error: string }> {
  const context = await getOwnerContext();
  if (!context) return { error: "Your owner session has expired. Sign in again." };
  if (!Number.isFinite(fileSize) || fileSize <= 0) {
    return { error: "Choose a non-empty BBR CSV file." };
  }
  if (fileSize > BBR_MAX_FILE_BYTES) {
    return { error: "The file exceeds the 4 MB import limit." };
  }
  if (!fileName.toLowerCase().endsWith(".csv")) {
    return { error: "Choose a CSV file exported from BBR My Cellar." };
  }

  const importId = randomUUID();
  const result = await createSignedUploadTarget(context.supabase, context.userId, importId, "source.csv");
  if ("error" in result) return result;
  return result.target;
}

export async function processBbrUpload(input: {
  importId: string;
  objectPath: string;
  originalFilename: string;
}): Promise<{ error: string } | { redirectTo: string }> {
  const context = await getOwnerContext();
  if (!context) return { error: "Your owner session has expired. Sign in again." };

  const expectedPrefix = `${context.userId}/${input.importId}/`;
  if (!input.objectPath.startsWith(expectedPrefix)) {
    return { error: "The uploaded file reference is invalid." };
  }

  const result = await stageBbrFile(context, {
    importId: input.importId,
    objectPath: input.objectPath,
    originalFilename: input.originalFilename,
    allowDuplicate: false,
  });

  if ("error" in result) {
    await context.supabase.storage.from("cellar-imports").remove([input.objectPath]);
  }

  return result;
}

/**
 * The D9 duplicate choice: stage the bytes already sitting in Storage under
 * `pendingImportId` as a separate snapshot, rather than reopening the
 * existing import that the checksum matched. `pendingFilename` is carried
 * through the redirect because no import row -- and so no stored filename --
 * exists for `pendingImportId` until this succeeds.
 */
export async function stageBbrDuplicateSnapshot(
  existingImportId: string,
  pendingImportId: string,
  pendingFilename: string,
): Promise<never> {
  const context = await getOwnerContext();
  if (!context) redirect("/login");

  const { data: alreadyStaged } = await context.supabase
    .from("cellar_imports")
    .select("id")
    .eq("id", pendingImportId)
    .maybeSingle();
  if (alreadyStaged?.id) {
    redirect(`/cellar/imports/bbr/${pendingImportId}`);
  }

  const objectPath = `${context.userId}/${pendingImportId}/source.csv`;
  const result = await stageBbrFile(context, {
    importId: pendingImportId,
    objectPath,
    originalFilename: pendingFilename,
    allowDuplicate: true,
  });

  if ("error" in result) {
    const params = new URLSearchParams({
      duplicate: "1",
      pendingImportId,
      pendingFilename,
      stage_error: result.error,
    });
    redirect(`/cellar/imports/bbr/${existingImportId}?${params.toString()}`);
  }

  redirect(result.redirectTo);
}

function describeDateError(error: { code?: string; message: string }): string {
  if (error.code === "42501") return "You are not signed in as the cellar owner.";
  if (error.code === "P0002") return "That import could not be found.";
  if (error.message.startsWith("an effective date is required")) {
    return "Enter an effective date.";
  }
  if (error.message.includes("already accepted as the snapshot for")) {
    return `${error.message}. An accepted snapshot's date changes only through the audited amendment path.`;
  }
  return "The effective date could not be saved.";
}

/**
 * Records the owner's proposed effective date ahead of acceptance (spec 4.1,
 * BBRH-01). Pre-acceptance only -- set_bbr_import_effective_date refuses an
 * accepted import, since its date is then an owner assertion of record,
 * amendable only through the audited path Slice 10 adds.
 */
export async function setBbrImportEffectiveDate(
  importId: string,
  formData: FormData,
): Promise<never> {
  const context = await getOwnerContext();
  if (!context) redirect("/login");

  const effectiveDate = String(formData.get("effective_date") ?? "").trim();
  if (!effectiveDate) {
    redirect(
      `/cellar/imports/bbr/${importId}?date_error=${encodeURIComponent("Enter an effective date.")}`,
    );
  }

  const { error } = await context.supabase.rpc("set_bbr_import_effective_date", {
    p_import_id: importId,
    p_effective_date: effectiveDate,
  });

  if (error) {
    redirect(
      `/cellar/imports/bbr/${importId}?date_error=${encodeURIComponent(describeDateError(error))}`,
    );
  }

  revalidatePath(`/cellar/imports/bbr/${importId}`);
  redirect(`/cellar/imports/bbr/${importId}`);
}

function describeAcceptanceError(error: { code?: string; message: string }): string {
  if (error.code === "42501") return "You are not signed in as the cellar owner.";
  if (error.code === "P0002") return "That import could not be found.";

  const message = error.message;

  if (message.startsWith("a role of current or historical must be stated")) {
    return "Choose the snapshot's role before accepting it -- there is deliberately no default, so an old recovered file cannot replace current holdings by accident.";
  }
  if (message.startsWith("an effective date is required to accept a snapshot")) {
    return "Confirm an effective date for this snapshot before accepting it.";
  }
  if (message.startsWith("only a validated import without row errors can be accepted")) {
    return "This import has row errors and cannot be accepted. Review the rows requiring attention below.";
  }
  if (message.startsWith("this import holds ownership evidence for")) {
    return "This file was staged before evidence coverage changed; upload it again.";
  }
  if (message.startsWith("an accepted snapshot already describes")) {
    return `${message}. Correct this import's date, or amend the snapshot that already holds it.`;
  }
  if (message.startsWith("a current snapshot cannot pre-date")) {
    return `${message}. Correct the date, accept this file as historical, or supply a later current declaration.`;
  }
  if (message.startsWith("a historical snapshot cannot post-date")) {
    return `${message}. Correct its date, nominate it as current, or first accept a later current declaration.`;
  }
  if (message.startsWith("this import is already accepted as the")) {
    return `${message}. Amend the stored declaration rather than accepting it again with different values.`;
  }
  return "The import could not be accepted.";
}

/**
 * The final acceptance action. The role is restated here with nothing
 * pre-selected (spec 4.2), and the already-confirmed effective date is
 * resupplied rather than assumed, so accept_bbr_snapshot re-checks the full
 * chronology against the exact declaration the owner is making right now.
 *
 * Capability parity (D6): only role "current" is offered by the UI this
 * slice. "historical" arrives in Slice 8; the RPC accepts it today, but no
 * control here selects it.
 */
export async function acceptBbrSnapshot(
  importId: string,
  formData: FormData,
): Promise<never> {
  const context = await getOwnerContext();
  if (!context) redirect("/login");

  const effectiveDate = String(formData.get("effective_date") ?? "").trim();
  if (!effectiveDate) {
    redirect(
      `/cellar/imports/bbr/${importId}?accept_error=${encodeURIComponent(
        "Confirm an effective date for this snapshot before accepting it.",
      )}`,
    );
  }

  const roleValue = formData.get("role");
  const role = typeof roleValue === "string" ? roleValue : "";
  if (!role) {
    redirect(
      `/cellar/imports/bbr/${importId}?accept_error=${encodeURIComponent(
        "Choose the snapshot's role before accepting it -- there is deliberately no default, so an old recovered file cannot replace current holdings by accident.",
      )}`,
    );
  }
  // Capability parity: the database accepts "historical" already, but the
  // preview that makes a historical acceptance meaningful arrives with the
  // history projections. Until then the boundary is enforced here, not only by
  // which radio the page renders.
  if (role !== "current") {
    redirect(
      `/cellar/imports/bbr/${importId}?accept_error=${encodeURIComponent(
        "Only a current-holdings acceptance is available yet. Dated historical snapshots arrive with the position history.",
      )}`,
    );
  }

  const { error } = await context.supabase.rpc("accept_bbr_snapshot", {
    p_import_id: importId,
    p_effective_date: effectiveDate,
    p_role: role,
  });

  if (error) {
    redirect(
      `/cellar/imports/bbr/${importId}?accept_error=${encodeURIComponent(describeAcceptanceError(error))}`,
    );
  }

  revalidatePath("/cellar/imports/bbr");
  revalidatePath("/cellar/imports");
  revalidatePath("/cellar/bbr");
  revalidatePath(`/cellar/imports/bbr/${importId}`);
  redirect(`/cellar/imports/bbr/${importId}?accepted=1`);
}
