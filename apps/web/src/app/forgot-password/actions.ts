"use server";

import { createClient } from "@supabase/supabase-js";
import { headers } from "next/headers";
import type { Database } from "@/lib/database.types";
import type { PasswordResetRequestState } from "./state";

async function recoveryRedirectUrl(): Promise<string> {
  const requestOrigin = (await headers()).get("origin");
  const configuredOrigin = process.env.NEXT_PUBLIC_SITE_URL?.trim()
    ?? requestOrigin
    ?? "http://localhost:3000";

  return new URL("/auth/update-password", configuredOrigin).toString();
}

function passwordResetClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error("Supabase URL and publishable key are not configured.");
  }

  return createClient<Database>(url, key, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      flowType: "implicit",
      persistSession: false,
    },
  });
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

  const supabase = passwordResetClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
    redirectTo: await recoveryRedirectUrl(),
  });

  if (error) {
    return {
      error: "The password email could not be sent. Wait a few minutes and try again.",
      sent: false,
    };
  }

  return { error: null, sent: true };
}
