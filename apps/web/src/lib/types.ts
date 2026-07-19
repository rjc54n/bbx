import type { Database } from "./database.types";

export type CandidateRow = Database["public"]["Views"]["candidate_view"]["Row"];

export type SortField = "pct_market" | "pct_last" | "pct_next" | "least_listing_price_p" | "last_seen_at";
