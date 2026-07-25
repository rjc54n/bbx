"use client";

import { useActionState } from "react";
import { stageBbrImport } from "./actions";
import { initialBbrUploadState } from "./state";

export function BbrUploadForm() {
  const [state, action, pending] = useActionState(
    stageBbrImport,
    initialBbrUploadState,
  );

  return (
    <form action={action} className="rounded-lg border border-border bg-background p-5">
      <h2 className="text-lg font-semibold">Upload BBR holdings</h2>
      <p className="mt-1 text-sm text-ink-muted">
        Upload the unmodified My Cellar CSV. Nothing changes in the accepted cellar until you review and accept it.
      </p>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div className="min-w-64 flex-1">
          <label htmlFor="bbr-file" className="mb-1 block text-sm font-medium">
            BBR CSV
          </label>
          <input
            id="bbr-file"
            name="file"
            type="file"
            accept=".csv,text/csv,application/csv,application/vnd.ms-excel"
            required
            className="block w-full rounded border border-border bg-background px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-accent-soft file:px-3 file:py-1 file:text-accent"
          />
        </div>
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-accent px-4 py-2 text-sm font-medium text-accent-ink disabled:opacity-50"
        >
          {pending ? "Checking and storing…" : "Upload and preview"}
        </button>
      </div>
      {state.error && (
        <p className="mt-3 rounded border border-accent/30 bg-accent-soft px-3 py-2 text-sm text-accent" role="alert">
          {state.error}
        </p>
      )}
      <p className="mt-3 text-xs text-ink-muted">
        Maximum 4 MB and 10,000 data rows. The source file is stored in the private cellar-imports bucket.
      </p>
    </form>
  );
}
