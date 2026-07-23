import { describe, expect, it } from "vitest";
import {
  CATALOGUE_FILTERS,
  CATALOGUE_METRICS,
  PRICE_CHANGE_METRICS,
  PRICE_CHANGE_SORT_FIELDS,
} from "./registry";

// Every registry entry's own `field` must equal its object key -- both parse()
// (which iterates Object.keys and looks up by that key) and Phase D (which
// will render {label, explanation} straight from these objects) rely on that
// invariant holding.
function assertSelfDescribing(registry: Record<string, { field: string }>) {
  for (const [key, meta] of Object.entries(registry)) {
    expect(meta.field, `${key} entry's .field should equal its own key`).toBe(key);
  }
}

describe("registry self-consistency", () => {
  it("CATALOGUE_FILTERS entries are keyed by their own field", () => {
    assertSelfDescribing(CATALOGUE_FILTERS);
  });

  it("CATALOGUE_METRICS entries are keyed by their own field", () => {
    assertSelfDescribing(CATALOGUE_METRICS);
  });

  it("PRICE_CHANGE_METRICS entries are keyed by their own field", () => {
    assertSelfDescribing(PRICE_CHANGE_METRICS);
  });

  it("every filterable catalogue field is also a displayable metric, except the virtual free-text search filter", () => {
    // "search" is an ilike across name+producer, not a real catalogue_view
    // column -- it has no column of its own to display.
    for (const field of Object.keys(CATALOGUE_FILTERS)) {
      if (field === "search") continue;
      expect(Object.keys(CATALOGUE_METRICS)).toContain(field);
    }
  });

  it("every price-changes sortable field is a displayable price-change metric", () => {
    for (const field of PRICE_CHANGE_SORT_FIELDS) {
      expect(Object.keys(PRICE_CHANGE_METRICS)).toContain(field);
    }
  });

  it("only the next-offer and format-adjusted-guide fields are flagged non-observed; nothing else is", () => {
    // `estimate` covers two distinct non-observed categories, disambiguated in
    // each entry's `explanation`, not by a second flag: price_vs_next_pct /
    // next_lowest_price_p are stored estimates (stale-as-of-last-scan);
    // adjusted_guide_p / price_vs_adjusted_guide_pct are a modelled correction
    // (BBR release-offer premiums applied to the guide, not observed on BBX
    // at all). Both are real non-observed categories; everything else here is
    // either a live-scan fact or a deterministic derivation of one (e.g.
    // price_per_bottle_p / price_per_litre_p are direct arithmetic on `ask`).
    const nonObserved = new Set([
      "price_vs_next_pct",
      "next_lowest_price_p",
      "adjusted_guide_p",
      "price_vs_adjusted_guide_pct",
    ]);
    for (const [key, meta] of Object.entries(CATALOGUE_METRICS)) {
      expect(meta.estimate, key).toBe(nonObserved.has(key));
    }
  });

  it("producer is the only typeahead-kind filter, and carries its backing RPC", () => {
    const typeaheadFields = Object.values(CATALOGUE_FILTERS).filter((m) => m.kind === "typeahead");
    expect(typeaheadFields.map((m) => m.field)).toEqual(["producer"]);
    expect(CATALOGUE_FILTERS.producer.rpc).toBe("search_producers");
  });
});
