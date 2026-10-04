import { supabase } from "@/lib/supabase";
import type { Database } from "../database.types";

export type ScanHealthRow = Database["public"]["Views"]["scan_health_view"]["Row"];
export const PUBLICATION_MAX_AGE_HOURS = 60;
export type PublicationHealth = { publication: ScanHealthRow | null; failure: ScanHealthRow | null };

export function publicationIsOverdue(publishedAt: string | null, now: number): boolean {
  if (!publishedAt) return true;
  const timestamp = Date.parse(publishedAt);
  return !Number.isFinite(timestamp) || now - timestamp > PUBLICATION_MAX_AGE_HOURS * 3_600_000;
}

export async function fetchPublicationHealth(): Promise<PublicationHealth> {
  const [publication, failure] = await Promise.all([
    supabase.from("scan_health_view").select("*")
      .eq("scope", "biddable_full_book").not("published_at", "is", null)
      .order("published_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("scan_health_view").select("*")
      .eq("scope", "biddable_full_book").eq("status", "failed")
      .order("finished_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (publication.error) throw publication.error;
  if (failure.error) throw failure.error;
  const failedAt = failure.data?.finished_at ?? failure.data?.started_at;
  const publishedAt = publication.data?.published_at;
  return {
    publication: publication.data,
    failure: failedAt && (!publishedAt || Date.parse(failedAt) > Date.parse(publishedAt)) ? failure.data : null,
  };
}
