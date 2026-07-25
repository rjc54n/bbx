import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isPublicAppPath } from "@/lib/auth/routing";
import type { Database } from "@/lib/database.types";

function redirectWithSessionCookies(
  url: URL,
  sessionResponse: NextResponse,
): NextResponse {
  const redirectResponse = NextResponse.redirect(url);
  sessionResponse.cookies.getAll().forEach((cookie) => {
    redirectResponse.cookies.set(cookie);
  });
  return redirectResponse;
}

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return response;

  const supabase = createServerClient<Database>(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
        Object.entries(headers).forEach(([name, value]) => {
          response.headers.set(name, value);
        });
      },
    },
  });

  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const userId = claimsError ? null : claimsData?.claims?.sub;
  const publicPath = isPublicAppPath(request.nextUrl.pathname);

  let isOwner: boolean | null = null;
  if (typeof userId === "string" && (!publicPath || request.nextUrl.pathname === "/login")) {
    const { data: owner, error: ownerError } = await supabase
      .from("app_owners")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();
    isOwner = ownerError ? null : owner !== null;
  }

  if (!publicPath && (typeof userId !== "string" || isOwner === false)) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    loginUrl.searchParams.set(
      "next",
      `${request.nextUrl.pathname}${request.nextUrl.search}`,
    );
    return redirectWithSessionCookies(loginUrl, response);
  }

  if (request.nextUrl.pathname === "/login" && isOwner === true) {
    const catalogueUrl = request.nextUrl.clone();
    catalogueUrl.pathname = "/";
    catalogueUrl.search = "";
    return redirectWithSessionCookies(catalogueUrl, response);
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
