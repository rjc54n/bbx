import { supabase } from "@/lib/supabase";
import type { Database } from "../database.types";

export type ScanHealthRow = Database["public"]["Views"]["scan_health_view"]["Row"];

// scan_health_view is itself ORDER BY started_at DESC, but a view's own
// ORDER BY has no guaranteed effect once PostgREST layers a query on top --
// order explicitly here rather than relying on it.
export async function fetchLatestCompletedScan(): Promise<ScanHealthRow | null> {
  const { data, error } = await supabase
    .from("scan_health_view")
    .select("*")
    .eq("status", "completed")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}
