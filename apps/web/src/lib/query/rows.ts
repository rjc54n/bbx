import type { Database } from "../database.types";

export type CatalogueRow = Database["public"]["Views"]["catalogue_view"]["Row"];
export type PriceChangeRow = Database["public"]["Views"]["recent_price_change_view"]["Row"];
export type FacetValueRow = Database["public"]["Views"]["facet_values_view"]["Row"];
export type FacetRangesRow = Database["public"]["Views"]["facet_ranges_view"]["Row"];
export type ProducerOption = Database["public"]["Functions"]["search_producers"]["Returns"][number];
