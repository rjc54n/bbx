import Link from "next/link";
import { requireOwner } from "@/lib/auth/owner";
import { formatDate } from "@/lib/format";
import { CellarTrackerUploadForm } from "./CellarTrackerUploadForm";

export const dynamic = "force-dynamic";

export default async function CellarTrackerImportsPage() {
  const { supabase } = await requireOwner();
  const { data, error } = await supabase
    .from("cellar_imports")
    .select("id,original_filename,uploaded_at,status,source_row_count,accepted_at")
    .eq("source_type", "cellartracker_inventory")
    .order("uploaded_at", { ascending: false });
  if (error) throw new Error("CellarTracker import history could not be loaded.");

  return (
    <main className="min-h-0 flex-1 overflow-auto bg-accent-soft">
      <div className="mx-auto max-w-6xl space-y-5 p-5">
        <nav className="flex flex-wrap gap-4 text-sm">
          <Link href="/cellar/imports" className="text-accent underline-offset-2 hover:underline">
            Back to imports
          </Link>
          <Link href="/cellartracker" className="text-accent underline-offset-2 hover:underline">
            My CellarTracker
          </Link>
        </nav>
        <header>
          <p className="text-xs font-semibold uppercase tracking-wider text-accent">Cellar inventory</p>
          <h1 className="mt-1 text-2xl font-semibold">CellarTracker imports</h1>
          <p className="mt-1 max-w-3xl text-sm text-ink-muted">
            Each accepted file is a full snapshot that replaces the active one. Quantity
            is home-held and Pending is held with BBR. Your product links, price
            corrections and excluded records are carried into every snapshot you accept.
          </p>
        </header>
        <CellarTrackerUploadForm />
        <section className="rounded-lg border border-border bg-background">
          <h2 className="border-b border-border px-5 py-3 font-semibold">Recent imports</h2>
          {data?.length ? (
            <div className="divide-y divide-border">
              {data.map((row) => (
                <Link
                  key={row.id}
                  href={`/cellar/imports/cellartracker/${row.id}`}
                  className="block px-5 py-3 hover:bg-accent-soft"
                >
                  <strong>{row.original_filename}</strong>
                  <p className="mt-1 text-sm text-ink-muted">
                    {row.source_row_count.toLocaleString()} rows · {row.status}
                    {row.accepted_at ? ` · accepted ${formatDate(row.accepted_at)}` : ""}
                  </p>
                </Link>
              ))}
            </div>
          ) : (
            <p className="p-5 text-sm text-ink-muted">No CellarTracker report has been uploaded.</p>
          )}
        </section>
      </div>
    </main>
  );
}
