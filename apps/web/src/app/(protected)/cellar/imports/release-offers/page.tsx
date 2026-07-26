import Link from "next/link";
import { requireOwner } from "@/lib/auth/owner";
import { ReleaseOfferUploadForm } from "./ReleaseOfferUploadForm";

export const dynamic = "force-dynamic";

function dateTime(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/London",
  }).format(new Date(value));
}

export default async function ReleaseOfferImportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const { supabase } = await requireOwner();
  const { data, error } = await supabase
    .from("release_offer_imports")
    .select("id, original_filename, imported_at, status, source_row_count, priced_fragment_count, matched_row_count, unmatched_row_count")
    .order("imported_at", { ascending: false })
    .limit(20);
  if (error) throw new Error("Release-offer imports could not be loaded.");

  return (
    <main className="min-h-0 flex-1 overflow-auto bg-accent-soft">
      <div className="mx-auto max-w-5xl space-y-5 p-5">
        <nav className="flex flex-wrap gap-4 text-sm">
          <Link href="/cellar/imports" className="text-accent underline-offset-2 hover:underline">
            Back to imports
          </Link>
          <Link href="/release-prices" className="text-accent underline-offset-2 hover:underline">
            Release prices
          </Link>
        </nav>
        <header>
          <p className="text-xs font-semibold uppercase tracking-wider text-accent">Release-price evidence</p>
          <h1 className="mt-1 text-2xl font-semibold">Import BBR offers</h1>
          <p className="mt-1 max-w-3xl text-sm text-ink-muted">
            The source file is kept unchanged. Prices are split by format and remain pending unless the product, format and in-bond basis are exact.
          </p>
        </header>
        <ReleaseOfferUploadForm
          error={typeof query.error === "string" ? query.error : undefined}
        />
        <section className="rounded-lg border border-border bg-background">
          <h2 className="border-b border-border px-5 py-3 font-semibold">Recent imports</h2>
          {data?.length ? (
            <div className="divide-y divide-border">
              {data.map((item) => (
                <Link
                  key={item.id}
                  href={`/cellar/imports/release-offers/${item.id}`}
                  className="block px-5 py-3 hover:bg-accent-soft"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{item.original_filename}</span>
                    <span className="text-xs font-semibold uppercase text-accent">{item.status}</span>
                  </div>
                  <p className="mt-1 text-xs text-ink-muted">
                    {dateTime(item.imported_at)} · {item.source_row_count.toLocaleString()} rows · {item.priced_fragment_count.toLocaleString()} price fragments · {item.matched_row_count.toLocaleString()} matched · {item.unmatched_row_count.toLocaleString()} unresolved
                  </p>
                </Link>
              ))}
            </div>
          ) : (
            <p className="px-5 py-4 text-sm text-ink-muted">No release-offer import has been recorded.</p>
          )}
        </section>
      </div>
    </main>
  );
}
