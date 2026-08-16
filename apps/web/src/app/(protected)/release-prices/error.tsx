"use client";

export default function ReleasePricesError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="flex min-h-0 flex-1 items-center justify-center bg-accent-soft p-5">
    <section className="max-w-md rounded-lg border border-border bg-background p-5">
      <h1 className="text-xl font-semibold">This page couldn’t load</h1>
      <p className="mt-2 text-sm text-ink-muted">Try again. If it continues to fail, the error has been recorded for investigation.</p>
      <button type="button" onClick={reset} className="mt-4 rounded bg-accent px-3 py-2 text-sm font-medium text-accent-ink">Reload</button>
    </section>
  </main>;
}
