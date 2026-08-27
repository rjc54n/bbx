"use client";

import Link from "next/link";

export default function ProtectedRouteError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="flex min-h-0 flex-1 items-center justify-center bg-accent-soft p-5">
    <section className="max-w-md rounded-lg border border-border bg-background p-5">
      <h1 className="text-xl font-semibold">This page could not load</h1>
      <p className="mt-2 text-sm text-ink-muted">The request may have failed temporarily. Try again, or return to the catalogue.</p>
      <div className="mt-4 flex flex-wrap gap-3">
        <button type="button" onClick={reset} className="rounded bg-accent px-3 py-2 text-sm font-medium text-accent-ink">Try again</button>
        <Link href="/" className="rounded border border-border px-3 py-2 text-sm text-ink hover:border-accent">Return to catalogue</Link>
      </div>
    </section>
  </main>;
}
