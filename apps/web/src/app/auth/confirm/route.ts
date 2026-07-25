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
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type");
  if (!tokenHash || type !== "recovery") {
    return loginErrorRedirect(request);
  }

  const supabase = await createServerSupabaseClient();
  const { error: verifyError } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: "recovery",
  });
  if (verifyError) {
    return loginErrorRedirect(request);
  }

  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (claimsError || typeof userId !== "string") {
    await supabase.auth.signOut();
    return loginErrorRedirect(request);
  }

  const { data: owner, error: ownerError } = await supabase
    .from("app_owners")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (ownerError || !owner) {
    await supabase.auth.signOut();
    return loginErrorRedirect(request);
  }

  const target = request.nextUrl.clone();
  target.pathname = "/auth/update-password";
  target.search = "";
  return NextResponse.redirect(target);
}
