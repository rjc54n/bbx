import { Suspense } from "react";
import { CatalogueBrowser } from "@/components/catalogue/CatalogueBrowser";

// CatalogueBrowser reads the query string via useSearchParams(), which
// requires a Suspense boundary for static builds (see Next.js docs on
// useSearchParams prerendering) -- without it `next build` fails.
export default function Page() {
  return (
    <Suspense fallback={<div className="p-4 text-sm text-ink-muted">Loading…</div>}>
      <CatalogueBrowser />
    </Suspense>
  );
}
