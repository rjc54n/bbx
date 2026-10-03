"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getOwnerContext } from "@/lib/auth/owner";

function winePath(parentSku: string): string {
  if (!/^\d{5,30}$/.test(parentSku)) throw new Error("Invalid Parent ID");
  return `/wine/parent/${parentSku}`;
}

function refreshReferenceReaders(parentSku: string): void {
  revalidatePath(winePath(parentSku));
  revalidatePath("/");
  revalidatePath("/favourites");
  revalidatePath("/scenarios");
}

export async function setReferencePrice(parentSku: string, formData: FormData): Promise<never> {
  const path = winePath(parentSku);
  const context = await getOwnerContext();
  if (!context) redirect("/login");

  const priceText = String(formData.get("price") ?? "").trim();
  const priceMatch = /^(\d+)(?:\.(\d{1,2}))?$/.exec(priceText);
  const pounds = priceMatch ? Number(priceMatch[1]) : NaN;
  const pence = priceMatch ? Number((priceMatch[2] ?? "").padEnd(2, "0")) : NaN;
  const priceP = pounds * 100 + pence;
  const date = String(formData.get("reference_date") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim();
  if (!Number.isSafeInteger(priceP) || priceP <= 0 || priceP > 2147483647
      || (date !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(date)) || note.length > 1000) {
    redirect(`${path}?reference_error=invalid`);
  }

  const { error } = await context.supabase.rpc("set_reference_price", {
    p_parent_sku: parentSku,
    p_price_per_75cl_p: priceP,
    p_reference_date: date || undefined,
    p_note: note || undefined,
  });
  if (error) redirect(`${path}?reference_error=save`);
  refreshReferenceReaders(parentSku);
  redirect(`${path}?reference_saved=1`);
}

export async function clearReferencePrice(parentSku: string): Promise<never> {
  const path = winePath(parentSku);
  const context = await getOwnerContext();
  if (!context) redirect("/login");
  const { error } = await context.supabase.rpc("clear_reference_price", { p_parent_sku: parentSku });
  if (error) redirect(`${path}?reference_error=clear`);
  refreshReferenceReaders(parentSku);
  redirect(`${path}?reference_cleared=1`);
}
