"use server";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { PasswordResetRequestState } from "./state";

export async function requestPasswordReset(
  _previousState: PasswordResetRequestState,
  formData: FormData,
): Promise<PasswordResetRequestState> {
  const email = formData.get("email");
  if (
    typeof email !== "string"
    || email.length > 320
    || !email.includes("@")
  ) {
    return { error: "Enter a valid email address.", sent: false };
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim());

  if (error) {
    return {
      error: "The password email could not be sent. Wait a few minutes and try again.",
      sent: false,
    };
  }

  return { error: null, sent: true };
}
