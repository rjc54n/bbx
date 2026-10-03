import type { Database } from "../database.types";

// The catalogue never shows last_rest_checked_at, and not selecting it lets
// Postgres drop catalogue_view's join to private.product_rest_checks
// (see CATALOGUE_SELECT in fetchCatalogue.ts).
export type CatalogueRow = Omit<Database["public"]["Views"]["catalogue_view"]["Row"], "last_rest_checked_at"> & {
  reference_price_p: number | null;
  reference_kind: string | null;
  reference_source: string | null;
  reference_date: string | null;
  reference_date_meaning: string | null;
  reference_needs_review: boolean;
  reference_has_competing_evidence: boolean;
};
export type PriceChangeRow = Database["public"]["Views"]["recent_price_change_view"]["Row"];
export type FacetValueRow = Database["public"]["Views"]["facet_values_view"]["Row"];
export type FacetRangesRow = Database["public"]["Views"]["facet_ranges_view"]["Row"];
export type ProducerOption = Database["public"]["Functions"]["search_producers"]["Returns"][number];
