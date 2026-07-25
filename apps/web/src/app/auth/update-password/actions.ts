"use server";

import { redirect } from "next/navigation";
import { getOwnerContext } from "@/lib/auth/owner";
import { validateNewPassword } from "@/lib/auth/password";
import type { UpdatePasswordState } from "./state";

export async function updatePassword(
  _previousState: UpdatePasswordState,
  formData: FormData,
): Promise<UpdatePasswordState> {
  const context = await getOwnerContext();
  if (!context) {
    return {
      error: "This password link has expired or has already been used. Request another link.",
    };
  }

  const validation = validateNewPassword(
    formData.get("password"),
    formData.get("password_confirmation"),
  );
  if (validation.password === null) {
    return { error: validation.error };
  }

  const { error } = await context.supabase.auth.updateUser({
    password: validation.password,
  });
  if (error) {
    return {
      error: "The password could not be changed. Request a new link and try again.",
    };
  }

  await context.supabase.auth.signOut();
  redirect("/login?password_updated=1");
}
