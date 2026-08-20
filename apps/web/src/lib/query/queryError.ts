// Supabase/PostgREST rejects with a plain object ({ message, details, hint,
// code }), not an Error instance. `String(err)` on that renders "[object
// Object]", which hid the real cause of an intermittent catalogue failure during
// UAT. Extract a readable message and keep the Postgres/PostgREST code so a
// timeout (57014) is distinguishable from a permission or schema error.
export function describeQueryError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object") {
    const e = err as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown };
    const parts = [e.message, e.details, e.hint]
      .filter((p): p is string => typeof p === "string" && p.trim().length > 0);
    const base = parts.join(" — ") || JSON.stringify(err);
    return typeof e.code === "string" && e.code ? `${base} (${e.code})` : base;
  }
  return String(err);
}
