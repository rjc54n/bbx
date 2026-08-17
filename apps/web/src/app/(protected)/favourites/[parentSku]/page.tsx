import { notFound, redirect } from "next/navigation";

// The favourite wine detail page became the canonical wine card at
// /wine/parent/[parentSku] (docs/WINE-RECORD-SPEC.md step 1). Kept as a
// redirect so existing favourite links and bookmarks still resolve.
export default async function FavouriteWineRedirect({ params }: {
  params: Promise<{ parentSku: string }>;
}) {
  const { parentSku } = await params;
  if (!/^\d{5,30}$/.test(parentSku)) notFound();
  redirect(`/wine/parent/${parentSku}`);
}
