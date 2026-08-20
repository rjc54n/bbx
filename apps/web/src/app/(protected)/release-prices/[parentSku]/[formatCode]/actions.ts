"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getOwnerContext } from "@/lib/auth/owner";

// Owner release-price anchor: set/override or clear a per-format release price
// the import missed. Prices on this surface are per case (as stored), entered in
// pounds. Mirrors confirmReleasePriceAnchor's shape (owner context, rpc,
// revalidate the affected surfaces, redirect with a status flag).

export async function setOwnerReleaseAnchor(
  parentSku: string,
  formatCode: string,
  returnPath: string,
  formData: FormData,
): Promise<never> {
  const context = await getOwnerContext();
  if (!context) redirect("/login");

  const pounds = Number(String(formData.get("price") ?? "").trim());
  if (!Number.isFinite(pounds) || pounds <= 0) redirect(`${returnPath}?owner_error=1`);
  // v1 accepts in-bond owner prices only (the RPC and a DB constraint enforce the
  // same). The form no longer submits a tax basis; reject any other value that
  // reaches this layer rather than silently coercing it.
  const taxBasis = String(formData.get("tax_basis") ?? "in_bond").trim() || "in_bond";
  if (taxBasis !== "in_bond") redirect(`${returnPath}?owner_error=1`);
  const offerDate = String(formData.get("offer_date") ?? "").trim();
  const sourceNote = String(formData.get("source_note") ?? "").trim();

  const { error } = await context.supabase.rpc("set_owner_release_anchor", {
    p_parent_sku: parentSku,
    p_format_code: formatCode,
    p_release_price_p: Math.round(pounds * 100),
    p_tax_basis: "in_bond",
    p_offer_date: offerDate || undefined,
    p_source_note: sourceNote || undefined,
  });

  revalidatePath("/release-prices");
  revalidatePath(returnPath);
  revalidatePath(`/wine/parent/${parentSku}`);
  redirect(`${returnPath}?${error ? "owner_error" : "owner_set"}=1`);
}

export async function clearOwnerReleaseAnchor(
  parentSku: string,
  formatCode: string,
  returnPath: string,
): Promise<never> {
  const context = await getOwnerContext();
  if (!context) redirect("/login");

  const { error } = await context.supabase.rpc("clear_owner_release_anchor", {
    p_parent_sku: parentSku,
    p_format_code: formatCode,
  });

  revalidatePath("/release-prices");
  revalidatePath(returnPath);
  revalidatePath(`/wine/parent/${parentSku}`);
  redirect(`${returnPath}?${error ? "owner_error" : "owner_cleared"}=1`);
}
