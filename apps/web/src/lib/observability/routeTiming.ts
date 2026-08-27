import "server-only";

type DatabaseFailure = { code?: string | null };

function databaseErrorCode(value: unknown): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const code = databaseErrorCode(item);
      if (code) return code;
    }
    return null;
  }
  if (value && typeof value === "object" && "error" in value) {
    const error = (value as { error?: DatabaseFailure | null }).error;
    return typeof error?.code === "string" ? error.code : null;
  }
  return null;
}

/**
 * Emits compact JSON suitable for Vercel and Supabase log correlation. It
 * deliberately excludes identifiers, filters, SQL and database error detail.
 */
export async function timeProtectedQuery<T>(
  route: string,
  operation: string,
  query: () => Promise<T>,
): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await query();
    const databaseCode = databaseErrorCode(result);
    console.info(JSON.stringify({
      event: "protected_route_query",
      route,
      operation,
      elapsed_ms: Date.now() - startedAt,
      outcome: databaseCode ? "database_error" : "ok",
      database_error_code: databaseCode,
    }));
    return result;
  } catch (error) {
    const databaseCode = error && typeof error === "object" && "code" in error
      && typeof (error as DatabaseFailure).code === "string"
      ? (error as DatabaseFailure).code
      : null;
    console.info(JSON.stringify({
      event: "protected_route_query",
      route,
      operation,
      elapsed_ms: Date.now() - startedAt,
      outcome: "exception",
      database_error_code: databaseCode,
    }));
    throw error;
  }
}
