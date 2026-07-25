"use server";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { PasswordResetRequestState } from "./state";

function recoveryRedirectUrl(): string {
  const configuredOrigin = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  const vercelDomain = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  const origin = configuredOrigin
    ?? (vercelDomain ? `https://${vercelDomain}` : "http://localhost:3000");

  return new URL("/auth/callback", origin).toString();
}

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
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
    redirectTo: recoveryRedirectUrl(),
  });

  if (error) {
    return {
      error: "The password email could not be sent. Wait a few minutes and try again.",
      sent: false,
    };
  }

  return { error: null, sent: true };
}
