"use server";

import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { LoginState } from "./state";

export async function login(
  _previousState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = formData.get("email");
  const password = formData.get("password");
  if (typeof email !== "string" || typeof password !== "string") {
    return { error: "Enter your email address and password." };
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: email.trim(),
    password,
  });
  if (error) {
    return { error: "The email address or password was not accepted." };
  }

  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  const { data: owner } = typeof userId === "string"
    ? await supabase
      .from("app_owners")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle()
    : { data: null };

  if (!owner) {
    await supabase.auth.signOut();
    return { error: "This account is not authorised to access the cellar." };
  }

  redirect("/cellar/imports/bbr");
}

export async function logout(): Promise<never> {
  const supabase = await createServerSupabaseClient();
  await supabase.auth.signOut();
  redirect("/login");
}
