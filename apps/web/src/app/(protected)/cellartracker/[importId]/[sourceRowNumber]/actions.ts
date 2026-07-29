"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getOwnerContext } from "@/lib/auth/owner";

const LIST_PATH = "/cellartracker";

function validRecord(importId: string, sourceRowNumber: number) {
  return /^[0-9a-f-]{36}$/i.test(importId)
    && Number.isSafeInteger(sourceRowNumber)
    && sourceRowNumber > 0;
}

function recordPath(importId: string, sourceRowNumber: number) {
  return `${LIST_PATH}/${importId}/${sourceRowNumber}`;
}

function revalidateRecord(importId: string, sourceRowNumber: number) {
  revalidatePath(LIST_PATH);
  revalidatePath("/cellartracker/matches");
  revalidatePath(recordPath(importId, sourceRowNumber));
}

async function saveCellarTrackerRecordLink(
  importId: string,
  sourceRowNumber: number,
  parentSku: string,
  method: "manual" | "algolia_confirmed",
): Promise<never> {
  if (!validRecord(importId, sourceRowNumber) || !/^\d{5,30}$/.test(parentSku)) {
    redirect(validRecord(importId, sourceRowNumber)
      ? `${recordPath(importId, sourceRowNumber)}?action_error=1`
      : LIST_PATH);
  }
  const context = await getOwnerContext();
  if (!context) redirect("/login");
  const { error } = await context.supabase.rpc("set_cellartracker_product_resolution", {
    p_import_id: importId,
    p_source_row_number: sourceRowNumber,
    p_parent_sku: parentSku,
    p_method: method,
  });
  revalidateRecord(importId, sourceRowNumber);
  redirect(`${recordPath(importId, sourceRowNumber)}?${error ? "action_error" : "changed"}=1`);
}

export async function confirmCellarTrackerRecordCandidate(
  importId: string,
  sourceRowNumber: number,
  parentSku: string,
): Promise<never> {
  return saveCellarTrackerRecordLink(importId, sourceRowNumber, parentSku, "algolia_confirmed");
}

export async function setManualCellarTrackerRecordLink(
  importId: string,
  sourceRowNumber: number,
  formData: FormData,
): Promise<never> {
  return saveCellarTrackerRecordLink(
    importId,
    sourceRowNumber,
    String(formData.get("parent_sku") ?? "").trim(),
    "manual",
  );
}

export async function unlinkCellarTrackerRecord(
  importId: string,
  sourceRowNumber: number,
): Promise<never> {
  if (!validRecord(importId, sourceRowNumber)) redirect(LIST_PATH);
  const context = await getOwnerContext();
  if (!context) redirect("/login");
  const { error } = await context.supabase.rpc("unlink_cellartracker_product_resolution", {
    p_import_id: importId,
    p_source_row_number: sourceRowNumber,
  });
  revalidateRecord(importId, sourceRowNumber);
  redirect(`${recordPath(importId, sourceRowNumber)}?${error ? "action_error" : "changed"}=1`);
}

export async function updateCellarTrackerRecordPrice(
  importId: string,
  sourceRowNumber: number,
  formData: FormData,
): Promise<never> {
  if (!validRecord(importId, sourceRowNumber)) redirect(LIST_PATH);
  const input = String(formData.get("price") ?? "").trim();
  const amount = /^\d+(?:\.\d{1,2})?$/.test(input) ? Number(input) : Number.NaN;
  const priceP = Number.isFinite(amount) ? Math.round(amount * 100) : -1;
  if (priceP < 0 || priceP > 2_147_483_647) {
    redirect(`${recordPath(importId, sourceRowNumber)}?action_error=1`);
  }
  const context = await getOwnerContext();
  if (!context) redirect("/login");
  const { error } = await context.supabase.rpc("update_cellartracker_record_price", {
    p_import_id: importId,
    p_source_row_number: sourceRowNumber,
    p_price_p: priceP,
  });
  revalidateRecord(importId, sourceRowNumber);
  redirect(`${recordPath(importId, sourceRowNumber)}?${error ? "action_error" : "changed"}=1`);
}

export async function deleteCellarTrackerRecord(
  importId: string,
  sourceRowNumber: number,
): Promise<never> {
  if (!validRecord(importId, sourceRowNumber)) redirect(LIST_PATH);
  const context = await getOwnerContext();
  if (!context) redirect("/login");
  const { error } = await context.supabase.rpc("delete_cellartracker_record", {
    p_import_id: importId,
    p_source_row_number: sourceRowNumber,
  });
  revalidateRecord(importId, sourceRowNumber);
  redirect(error
    ? `${recordPath(importId, sourceRowNumber)}?delete_error=1`
    : `${LIST_PATH}?deleted=1`);
}
