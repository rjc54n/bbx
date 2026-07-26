"use server";

import { createHash, randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getOwnerContext } from "@/lib/auth/owner";
import {
  parseReleaseOfferCsv,
  RELEASE_OFFER_MAX_FILE_BYTES,
  RELEASE_OFFER_PARSER_VERSION,
  ReleaseOfferFileError,
  type ParsedReleaseOfferRow,
} from "@/lib/releaseOffers/parser";

const ACCEPTED_MIME_TYPES = new Set([
  "",
  "text/csv",
  "application/csv",
  "application/vnd.ms-excel",
  "text/plain",
]);

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
  for (const [index, batch] of batches.entries()) {
    const { error } = await supabase.rpc("stage_release_offer_batch", {
      p_import_id: importId,
      p_rows: batch,
    });
    if (error) {
      const firstRow = batch[0]?.source_row_number;
      const lastRow = batch.at(-1)?.source_row_number;
      if (error.code === "23514") {
        return `The source data in rows ${firstRow} to ${lastRow} exceeds a database field limit. Nothing has been lost. Apply the release-offer migration, then upload this same file again to resume.`;
      }
      return `Release-offer batch ${index + 1} of ${batches.length} (rows ${firstRow} to ${lastRow}) could not be recorded. Nothing has been lost. Upload the same file again to resume.`;
    }
  }

  const priceCount = rows.reduce((total, row) => total + row.prices.length, 0);
  const { error } = await supabase.rpc("finalise_release_offer_import", {
    p_import_id: importId,
    p_expected_source_rows: rows.length,
    p_expected_price_fragments: priceCount,
  });
  return error ? "The release-offer import could not be matched and finalised." : null;
}

export async function processReleaseOfferUpload(
  formData: FormData,
): Promise<{ error: string } | { redirectTo: string }> {
  const context = await getOwnerContext();
  if (!context) return { error: "Your owner session has expired. Sign in again." };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a non-empty historic release-offer CSV file." };
  }
  if (file.size > RELEASE_OFFER_MAX_FILE_BYTES) {
    return { error: "The file exceeds the 4 MB import limit." };
  }
  if (!ACCEPTED_MIME_TYPES.has(file.type) || !file.name.toLowerCase().endsWith(".csv")) {
    return { error: "Choose the expected historic release-offer CSV file." };
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  let csvText: string;
  try {
    csvText = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return { error: "The release-offer file is not valid UTF-8 text." };
  }

  let rows: ParsedReleaseOfferRow[];
  try {
    rows = parseReleaseOfferCsv(csvText);
  } catch (error) {
    if (error instanceof ReleaseOfferFileError) return { error: error.message };
    return { error: "The release-offer CSV could not be parsed." };
  }

  const checksum = createHash("sha256").update(bytes).digest("hex");
  const { data: existing, error: existingError } = await context.supabase
    .from("release_offer_imports")
    .select("id, status")
    .eq("source_type", "historic_csv")
    .eq("content_checksum", checksum)
    .eq("parser_version", RELEASE_OFFER_PARSER_VERSION)
    .maybeSingle();
  if (existingError) {
    return { error: "The release-price backend is not ready or could not be reached." };
  }

  if (existing?.id && existing.status !== "staging") {
    return { redirectTo: `/cellar/imports/release-offers/${existing.id}?duplicate=1` };
  }
  if (existing?.id) {
    const resumeError = await stageBatches(context.supabase, existing.id, rows);
    if (resumeError) return { error: resumeError };
    return { redirectTo: `/cellar/imports/release-offers/${existing.id}?resumed=1` };
  }

  const importId = randomUUID();
  const objectPath = `${context.userId}/${importId}/release-offers.csv`;
  const { error: storageError } = await context.supabase.storage
    .from("cellar-imports")
    .upload(objectPath, bytes, { contentType: "text/csv", upsert: false });
  if (storageError) return { error: "The private source file could not be stored." };

  const { data: begun, error: beginError } = await context.supabase.rpc(
    "begin_release_offer_import",
    {
      p_import_id: importId,
      p_source_type: "historic_csv",
      p_content_checksum: checksum,
      p_original_filename: safeFilename(file.name),
      p_byte_size: file.size,
      p_storage_object_path: objectPath,
      p_parser_version: RELEASE_OFFER_PARSER_VERSION,
    },
  );
  if (beginError) {
    await context.supabase.storage.from("cellar-imports").remove([objectPath]);
    return { error: "The release-offer import could not be started." };
  }

  const result = begun as { import_id?: string; duplicate?: boolean } | null;
  const resultId = result?.import_id;
  if (!resultId) {
    await context.supabase.storage.from("cellar-imports").remove([objectPath]);
    return { error: "The import backend returned an incomplete result." };
  }
  if (result.duplicate) {
    await context.supabase.storage.from("cellar-imports").remove([objectPath]);
  }

  const stageError = await stageBatches(context.supabase, resultId, rows);
  if (stageError) return { error: stageError };

  revalidatePath("/cellar/imports");
  revalidatePath("/cellar/imports/release-offers");
  return { redirectTo: `/cellar/imports/release-offers/${resultId}` };
}

export async function acceptReleaseOfferImport(importId: string): Promise<never> {
  const context = await getOwnerContext();
  if (!context) redirect("/login");
  const { error } = await context.supabase.rpc("accept_release_offer_import", {
    p_import_id: importId,
  });
  if (error) redirect(`/cellar/imports/release-offers/${importId}?accept_error=1`);

  revalidatePath("/release-prices");
  revalidatePath("/cellar/imports");
  revalidatePath(`/cellar/imports/release-offers/${importId}`);
  redirect(`/cellar/imports/release-offers/${importId}?accepted=1`);
}

export async function resolveReleaseOfferRow(
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
  const { error } = await context.supabase.rpc("resolve_release_offer_row", {
    p_import_id: importId,
    p_source_row_number: sourceRowNumber,
    p_parent_sku: parentSku,
  });
  if (error) {
    redirect(`/cellar/imports/release-offers/${importId}?resolve_error=${sourceRowNumber}`);
  }
  revalidatePath("/release-prices");
  revalidatePath(`/cellar/imports/release-offers/${importId}`);
  redirect(`/cellar/imports/release-offers/${importId}?resolved=${sourceRowNumber}`);
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
