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

  // Session routing and token refresh only. The proxy used to query app_owners
  // here as well, which put a third database round trip on every navigation --
  // the layout and the page each run the same check. It now makes an optimistic
  // claims-only decision and leaves authorisation to requireOwner() (one cached
  // lookup per render) and to RLS, which is the split the Next.js authentication
  // guide recommends: https://nextjs.org/docs/app/guides/authentication
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const signedIn = !claimsError && typeof claimsData?.claims?.sub === "string";
  const publicPath = isPublicAppPath(request.nextUrl.pathname);

  if (!publicPath && !signedIn) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    loginUrl.searchParams.set(
      "next",
      `${request.nextUrl.pathname}${request.nextUrl.search}`,
    );
    return redirectWithSessionCookies(loginUrl, response);
  }

  // A signed-in visitor to /login goes to the app, except when requireOwner()
  // just sent them here. Ownership is no longer known at this point, so without
  // that exception a signed-in non-owner would bounce between /login and /
  // forever.
  const denied = request.nextUrl.searchParams.get("denied") === "1";
  if (request.nextUrl.pathname === "/login" && signedIn && !denied) {
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
