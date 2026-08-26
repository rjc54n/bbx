import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "./database.types";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Authentication is established by the server login action and refreshed by
// the request proxy, both of which use Supabase SSR cookies. The plain
// supabase-js browser client only reads local storage, so it omitted the
// owner session from client-side reads of private release-price views.
export const supabase = createBrowserClient<Database>(url, anonKey);
