import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/database.types";

function credentials(): { url: string; key: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error("Supabase URL and publishable key are not configured.");
  }
  return { url, key };
}

let browserClient: ReturnType<typeof createBrowserClient<Database>> | undefined;

export function createClientSupabaseClient() {
  if (!browserClient) {
    const { url, key } = credentials();
    browserClient = createBrowserClient<Database>(url, key);
  }
  return browserClient;
}
