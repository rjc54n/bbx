import { type NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

function loginErrorRedirect(request: NextRequest): NextResponse {
  const target = request.nextUrl.clone();
  target.pathname = "/login";
  target.search = "";
  target.searchParams.set("recovery_error", "1");
  return NextResponse.redirect(target);
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  if (!code) {
    return loginErrorRedirect(request);
  }

  const supabase = await createServerSupabaseClient();
  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError) {
    return loginErrorRedirect(request);
  }

  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (claimsError || typeof userId !== "string") {
    await supabase.auth.signOut({ scope: "local" });
    return loginErrorRedirect(request);
  }

  const { data: owner, error: ownerError } = await supabase
    .from("app_owners")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (ownerError || !owner) {
    await supabase.auth.signOut({ scope: "local" });
    return loginErrorRedirect(request);
  }

  const target = request.nextUrl.clone();
  target.pathname = "/auth/update-password";
  target.search = "";
  return NextResponse.redirect(target);
}
