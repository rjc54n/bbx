import { NextResponse } from "next/server";
import { processReleaseOfferUpload } from "../actions";

function redirectTo(request: Request, path: string): NextResponse {
  return NextResponse.redirect(new URL(path, request.url), 303);
}

export async function POST(request: Request): Promise<NextResponse> {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return redirectTo(
      request,
      "/cellar/imports/release-offers?error=The+uploaded+file+could+not+be+read.",
    );
  }

  const result = await processReleaseOfferUpload(formData);
  if ("redirectTo" in result) return redirectTo(request, result.redirectTo);

  return redirectTo(
    request,
    `/cellar/imports/release-offers?error=${encodeURIComponent(result.error)}`,
  );
}
