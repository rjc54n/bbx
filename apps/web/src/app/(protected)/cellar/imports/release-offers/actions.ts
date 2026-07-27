"use server";

import { createHash, randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getOwnerContext } from "@/lib/auth/owner";
import { createSignedUploadTarget, type UploadTarget } from "@/lib/imports/uploadTarget";
import {
  parseReleaseOfferCsv,
  RELEASE_OFFER_MAX_FILE_BYTES,
  RELEASE_OFFER_PARSER_VERSION,
  ReleaseOfferFileError,
  type ParsedReleaseOfferRow,
} from "@/lib/releaseOffers/parser";

function safeFilename(filename: string): string {
  const basename = filename.split(/[\\/]/).at(-1) ?? "release-offers.csv";
  const cleaned = basename
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .trim()
    .slice(0, 255);
  return cleaned || "release-offers.csv";
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

async function stageBatches(
  supabase: NonNullable<Awaited<ReturnType<typeof getOwnerContext>>>["supabase"],
  importId: string,
  rows: ParsedReleaseOfferRow[],
): Promise<string | null> {
  const batches = chunks(rows, 50);
  for (const batch of batches) {
    const { error } = await supabase.rpc("stage_release_offer_batch", {
      p_import_id: importId,
      p_rows: batch,
    });
    if (error) {
      const firstRow = batch[0]?.source_row_number;
      const lastRow = batch.at(-1)?.source_row_number;
      return `Rows ${firstRow} to ${lastRow} could not be recorded. Nothing has been lost — upload the same file again to resume from the remaining rows.`;
    }
  }
  return null;
}

async function markStaged(
  supabase: NonNullable<Awaited<ReturnType<typeof getOwnerContext>>>["supabase"],
  importId: string,
  rows: ParsedReleaseOfferRow[],
): Promise<string | null> {
  const priceCount = rows.reduce((total, row) => total + row.prices.length, 0);
  const { error } = await supabase.rpc("mark_release_offer_import_staged", {
    p_import_id: importId,
    p_expected_source_rows: rows.length,
    p_expected_price_fragments: priceCount,
  });
  return error ? "The staged release-offer data could not be verified." : null;
}

export async function createReleaseOfferUploadTarget(
  fileName: string,
  fileSize: number,
): Promise<UploadTarget | { error: string }> {
  const context = await getOwnerContext();
  if (!context) return { error: "Your owner session has expired. Sign in again." };
  if (!Number.isFinite(fileSize) || fileSize <= 0) {
    return { error: "Choose a non-empty historic release-offer CSV file." };
  }
  if (fileSize > RELEASE_OFFER_MAX_FILE_BYTES) {
    return { error: "The file exceeds the 10 MB import limit." };
  }
  if (!fileName.toLowerCase().endsWith(".csv")) {
    return { error: "Choose the expected historic release-offer CSV file." };
  }

  const importId = randomUUID();
  const result = await createSignedUploadTarget(
    context.supabase,
    context.userId,
    importId,
    "release-offers.csv",
  );
  if ("error" in result) return result;
  return result.target;
}

export async function processReleaseOfferUpload(input: {
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
    return { error: "Choose a non-empty historic release-offer CSV file." };
  }
  if (bytes.byteLength > RELEASE_OFFER_MAX_FILE_BYTES) {
    await context.supabase.storage.from("cellar-imports").remove([input.objectPath]);
    return { error: "The file exceeds the 10 MB import limit." };
  }

  let csvText: string;
  try {
    csvText = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    await context.supabase.storage.from("cellar-imports").remove([input.objectPath]);
    return { error: "The release-offer file is not valid UTF-8 text." };
  }

  let rows: ParsedReleaseOfferRow[];
  try {
    rows = parseReleaseOfferCsv(csvText);
  } catch (error) {
    await context.supabase.storage.from("cellar-imports").remove([input.objectPath]);
    if (error instanceof ReleaseOfferFileError) return { error: error.message };
    return { error: "The release-offer CSV could not be parsed." };
  }

  const checksum = createHash("sha256").update(bytes).digest("hex");
  const { data: existing, error: existingError } = await context.supabase
    .from("release_offer_imports")
    .select("id, status")
    .eq("content_checksum", checksum)
    .eq("parser_version", RELEASE_OFFER_PARSER_VERSION)
    .maybeSingle();
  if (existingError) {
    await context.supabase.storage.from("cellar-imports").remove([input.objectPath]);
    return { error: "The release-price backend is not ready or could not be reached." };
  }

  if (existing?.id && existing.status !== "staging") {
    await context.supabase.storage.from("cellar-imports").remove([input.objectPath]);
    return { redirectTo: `/cellar/imports/release-offers/${existing.id}?duplicate=1` };
  }
  if (existing?.id) {
    await context.supabase.storage.from("cellar-imports").remove([input.objectPath]);
    const resumeError = await stageBatches(context.supabase, existing.id, rows);
    if (resumeError) return { error: resumeError };
    const stagedError = await markStaged(context.supabase, existing.id, rows);
    if (stagedError) return { error: stagedError };
    return { redirectTo: `/cellar/imports/release-offers/${existing.id}?resumed=1` };
  }

  const { data: begun, error: beginError } = await context.supabase.rpc(
    "begin_release_offer_import",
    {
      p_import_id: input.importId,
      p_content_checksum: checksum,
      p_original_filename: safeFilename(input.originalFilename),
      p_byte_size: bytes.byteLength,
      p_storage_object_path: input.objectPath,
      p_parser_version: RELEASE_OFFER_PARSER_VERSION,
    },
  );
  if (beginError) {
    await context.supabase.storage.from("cellar-imports").remove([input.objectPath]);
    return { error: "The release-offer import could not be started." };
  }

  const result = begun as { import_id?: string; duplicate?: boolean } | null;
  const resultId = result?.import_id;
  if (!resultId) {
    await context.supabase.storage.from("cellar-imports").remove([input.objectPath]);
    return { error: "The import backend returned an incomplete result." };
  }
  if (result.duplicate) {
    await context.supabase.storage.from("cellar-imports").remove([input.objectPath]);
  }

  const stageError = await stageBatches(context.supabase, resultId, rows);
  if (stageError) return { error: stageError };
  const stagedError = await markStaged(context.supabase, resultId, rows);
  if (stagedError) return { error: stagedError };

  revalidatePath("/cellar/imports");
  revalidatePath("/cellar/imports/release-offers");
  return { redirectTo: `/cellar/imports/release-offers/${resultId}` };
}

export async function runReleaseOfferMatching(importId: string): Promise<never> {
  const context = await getOwnerContext();
  if (!context) redirect("/login");
  const { error } = await context.supabase.rpc("run_release_offer_matching", {
    p_import_id: importId,
  });
  if (error) redirect(`/cellar/imports/release-offers/${importId}?match_error=1`);

  revalidateReleaseOfferPaths(importId);
  redirect(`/cellar/imports/release-offers/${importId}?matched=1`);
}

function revalidateReleaseOfferPaths(importId: string) {
  revalidatePath("/release-prices");
  revalidatePath("/cellar/imports");
  revalidatePath("/cellar/imports/release-offers");
  revalidatePath(`/cellar/imports/release-offers/${importId}`);
}

export async function acceptReleaseOfferImport(importId: string): Promise<never> {
  const context = await getOwnerContext();
  if (!context) redirect("/login");
  const { error } = await context.supabase.rpc("accept_release_offer_import", {
    p_import_id: importId,
  });
  if (error) redirect(`/cellar/imports/release-offers/${importId}?accept_error=1`);

  revalidateReleaseOfferPaths(importId);
  redirect(`/cellar/imports/release-offers/${importId}?accepted=1`);
}

export async function setReleaseOfferProductResolution(
  importId: string,
  sourceRowNumber: number,
  formData: FormData,
): Promise<never> {
  const context = await getOwnerContext();
  if (!context) redirect("/login");
  const parentSku = String(formData.get("parent_sku") ?? "").trim();
  if (!/^\d{5,30}$/.test(parentSku)) {
    redirect(`/cellar/imports/release-offers/${importId}?resolve_error=${sourceRowNumber}`);
  }
  const { error } = await context.supabase.rpc("set_release_offer_product_resolution", {
    p_import_id: importId,
    p_source_row_number: sourceRowNumber,
    p_parent_sku: parentSku,
  });
  if (error) {
    redirect(`/cellar/imports/release-offers/${importId}?resolve_error=${sourceRowNumber}`);
  }
  revalidateReleaseOfferPaths(importId);
  redirect(`/cellar/imports/release-offers/${importId}?resolved=${sourceRowNumber}`);
}

export async function ignoreReleaseOfferRow(importId: string, sourceRowNumber: number): Promise<never> {
  const context = await getOwnerContext();
  if (!context) redirect("/login");
  const { error } = await context.supabase.rpc("ignore_release_offer_row", {
    p_import_id: importId,
    p_source_row_number: sourceRowNumber,
  });
  revalidateReleaseOfferPaths(importId);
  redirect(`/cellar/imports/release-offers/${importId}?${error ? "resolution_error" : "ignored"}=${sourceRowNumber}`);
}

export async function clearReleaseOfferProductResolution(importId: string, sourceRowNumber: number): Promise<never> {
  const context = await getOwnerContext();
  if (!context) redirect("/login");
  const { error } = await context.supabase.rpc("clear_release_offer_product_resolution", {
    p_import_id: importId,
    p_source_row_number: sourceRowNumber,
  });
  revalidateReleaseOfferPaths(importId);
  redirect(`/cellar/imports/release-offers/${importId}?${error ? "resolution_error" : "cleared"}=${sourceRowNumber}`);
}

export async function deleteReleaseOfferImport(importId: string): Promise<never> {
  const context = await getOwnerContext();
  if (!context) redirect("/login");
  const { data: importData, error: loadError } = await context.supabase
    .from("release_offer_imports")
    .select("storage_object_path")
    .eq("id", importId)
    .maybeSingle();
  if (loadError || !importData?.storage_object_path) {
    redirect(`/cellar/imports/release-offers/${importId}?delete_error=1`);
  }
  const { error: storageError } = await context.supabase.storage
    .from("cellar-imports")
    .remove([importData.storage_object_path]);
  if (storageError) redirect(`/cellar/imports/release-offers/${importId}?delete_error=1`);
  const { error } = await context.supabase.rpc("delete_release_offer_import", { p_import_id: importId });
  if (error) redirect(`/cellar/imports/release-offers/${importId}?delete_error=1`);
  revalidatePath("/release-prices");
  revalidatePath("/cellar/imports");
  revalidatePath("/cellar/imports/release-offers");
  redirect("/cellar/imports/release-offers?deleted=1");
}

export async function confirmReleasePriceAnchor(
  priceId: number,
  returnPath: string,
  formData: FormData,
): Promise<never> {
  const context = await getOwnerContext();
  if (!context) redirect("/login");
  const note = String(formData.get("note") ?? "").trim();
  const { error } = await context.supabase.rpc("confirm_release_price_anchor", {
    p_release_offer_price_id: priceId,
    p_note: note || undefined,
  });
  revalidatePath("/release-prices");
  revalidatePath(returnPath);
  redirect(`${returnPath}?${error ? "confirm_error" : "confirmed"}=1`);
}
