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

  it("price_vs_next_pct and next-offer fields are flagged as stored estimates; nothing else is", () => {
    for (const [key, meta] of Object.entries(CATALOGUE_METRICS)) {
      const shouldBeEstimate = key === "price_vs_next_pct" || key === "next_lowest_price_p";
      expect(meta.estimate, key).toBe(shouldBeEstimate);
    }
  });

  it("producer is the only typeahead-kind filter, and carries its backing RPC", () => {
    const typeaheadFields = Object.values(CATALOGUE_FILTERS).filter((m) => m.kind === "typeahead");
    expect(typeaheadFields.map((m) => m.field)).toEqual(["producer"]);
    expect(CATALOGUE_FILTERS.producer.rpc).toBe("search_producers");
  });
});
