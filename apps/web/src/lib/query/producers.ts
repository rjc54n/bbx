import { supabase } from "@/lib/supabase";
import type { ProducerOption } from "./rows";

// producer is high-cardinality -- typeahead only, never a preloaded facet
// list (see docs/PHASE2-catalogue-browser.md Phase A note on search_producers).
export async function searchProducers(query: string): Promise<ProducerOption[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const { data, error } = await supabase.rpc("search_producers", { q: trimmed });
  if (error) throw error;
  return data ?? [];
}
