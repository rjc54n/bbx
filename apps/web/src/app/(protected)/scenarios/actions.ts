"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getOwnerContext } from "@/lib/auth/owner";
import type { Json } from "@/lib/database.types";
import { parseScenarioDefinition } from "@/lib/scenarios/definition";

function readDefinition(formData: FormData): unknown {
  const raw = String(formData.get("definition") ?? "").trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function readName(formData: FormData): string {
  return String(formData.get("name") ?? "").trim();
}

export async function createScenario(formData: FormData): Promise<never> {
  const context = await getOwnerContext();
  if (!context) redirect("/login");
  const name = readName(formData);
  if (!name || name.length > 120) redirect("/scenarios?error=name");
  // Round-trip through the validator so only registry-valid filters persist.
  const definition = parseScenarioDefinition(readDefinition(formData));
  if (definition.filters.length === 0) redirect("/scenarios?error=filters");

  const { data, error } = await context.supabase
    .from("saved_scenarios")
    .insert({ user_id: context.userId, name, definition: definition as unknown as Json })
    .select("id")
    .single();
  if (error || !data) redirect("/scenarios?error=save");

  revalidatePath("/scenarios");
  redirect(`/scenarios/${data.id}`);
}

export async function updateScenario(id: string, formData: FormData): Promise<never> {
  const context = await getOwnerContext();
  if (!context) redirect("/login");
  const returnPath = `/scenarios/${id}`;
  const name = readName(formData);
  if (!name || name.length > 120) redirect(`${returnPath}?error=name`);
  const definition = parseScenarioDefinition(readDefinition(formData));
  if (definition.filters.length === 0) redirect(`${returnPath}?error=filters`);

  const { error } = await context.supabase
    .from("saved_scenarios")
    .update({ name, definition: definition as unknown as Json })
    .eq("id", id);
  if (error) redirect(`${returnPath}?error=save`);

  revalidatePath("/scenarios");
  revalidatePath(returnPath);
  redirect(`${returnPath}?saved=1`);
}

export async function deleteScenario(id: string): Promise<never> {
  const context = await getOwnerContext();
  if (!context) redirect("/login");
  const { error } = await context.supabase.from("saved_scenarios").delete().eq("id", id);
  if (error) redirect(`/scenarios/${id}?error=delete`);
  revalidatePath("/scenarios");
  redirect("/scenarios?deleted=1");
}
