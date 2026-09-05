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

function safeFilename(filename: string): string {
  const basename = filename.split(/[\\/]/).at(-1) ?? "bbr-holdings.csv";
  const cleaned = basename
    .replace(/[\u0000-\u001F\u007F]/g, "")
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
  supabase: NonNullable<Awaited<ReturnType<typeof getOwnerContext>>>["supabase"],
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

  const { data: fileBlob, error: downloadError } = await context.supabase.storage
    .from("cellar-imports")
    .download(input.objectPath);
  if (downloadError || !fileBlob) {
    return { error: "The uploaded file could not be read from storage." };
  }

  const bytes = new Uint8Array(await fileBlob.arrayBuffer());
  if (bytes.byteLength === 0) {
    await context.supabase.storage.from("cellar-imports").remove([input.objectPath]);
    return { error: "Choose a non-empty BBR CSV file." };
  }
  if (bytes.byteLength > BBR_MAX_FILE_BYTES) {
    await context.supabase.storage.from("cellar-imports").remove([input.objectPath]);
    return { error: "The file exceeds the 4 MB import limit." };
  }

  let csvText: string;
  try {
    csvText = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    await context.supabase.storage.from("cellar-imports").remove([input.objectPath]);
    return { error: "The BBR file is not valid UTF-8 text." };
  }

  const checksum = createHash("sha256").update(bytes).digest("hex");
  const { data: existing, error: duplicateError } = await context.supabase
    .from("cellar_imports")
    .select("id")
    .eq("source_type", "bbr_holdings")
    .eq("content_checksum", checksum)
    .eq("parser_version", BBR_PARSER_VERSION)
    .maybeSingle();
  if (duplicateError) {
    await context.supabase.storage.from("cellar-imports").remove([input.objectPath]);
    return { error: "The cellar import backend is not ready or could not be reached." };
  }
  if (existing?.id) {
    await context.supabase.storage.from("cellar-imports").remove([input.objectPath]);
    return { redirectTo: `/cellar/imports/bbr/${existing.id}?duplicate=1` };
  }

  let parsedRows;
  try {
    parsedRows = parseBbrCsv(csvText);
  } catch (error) {
    await context.supabase.storage.from("cellar-imports").remove([input.objectPath]);
    if (error instanceof BbrFileError) return { error: error.message };
    return { error: "The BBR CSV could not be parsed." };
  }
  if (parsedRows.droppedTrailingRowCount > 0) {
    // Not yet surfaced to the owner in the UI — see the parseBbrCsv doc comment.
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
    await context.supabase.storage.from("cellar-imports").remove([input.objectPath]);
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
    },
  );

  if (stageError) {
    await context.supabase.storage.from("cellar-imports").remove([input.objectPath]);
    return { error: "The parsed import could not be recorded atomically." };
  }

  const result = staged as { import_id?: string; duplicate?: boolean } | null;
  const resultId = result?.import_id;
  if (!resultId) {
    await context.supabase.storage.from("cellar-imports").remove([input.objectPath]);
    return { error: "The import backend returned an incomplete result." };
  }
  if (result.duplicate) {
    await context.supabase.storage.from("cellar-imports").remove([input.objectPath]);
  }

  revalidatePath("/cellar/imports/bbr");
  revalidatePath("/cellar/imports");
  return { redirectTo: `/cellar/imports/bbr/${resultId}${result.duplicate ? "?duplicate=1" : ""}` };
}

export async function acceptBbrImport(importId: string): Promise<never> {
  const context = await getOwnerContext();
  if (!context) redirect("/login");

  const { error } = await context.supabase.rpc("accept_bbr_import", {
    p_import_id: importId,
  });
  if (error) {
    redirect(`/cellar/imports/bbr/${importId}?accept_error=1`);
  }

  revalidatePath("/cellar/imports/bbr");
  revalidatePath("/cellar/imports");
  revalidatePath("/cellar/bbr");
  revalidatePath(`/cellar/imports/bbr/${importId}`);
  redirect(`/cellar/imports/bbr/${importId}?accepted=1`);
}
