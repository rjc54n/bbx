import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  catalogue: { data: [] as { parent_sku: string; format_code: string; case_size: number; bottle_volume_ml: number }[], error: null },
  reference: { data: [] as unknown[], error: null as { message: string } | null },
  range: vi.fn(),
  referenceIn: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from(table: string) {
      if (table === "catalogue_view") return {
        select() { return this; },
        order() { return this; },
        range(from: number, to: number) { mock.range(from, to); return this; },
        abortSignal() { return this; },
        then(resolve: (value: typeof mock.catalogue) => void) { return Promise.resolve(mock.catalogue).then(resolve); },
      };
      if (table === "resolved_reference_price_view") return {
        select() { return this; },
        in(field: string, values: string[]) { mock.referenceIn(field, values); return this; },
        abortSignal() { return this; },
        then(resolve: (value: typeof mock.reference) => void) { return Promise.resolve(mock.reference).then(resolve); },
      };
      throw new Error(`Unexpected table: ${table}`);
    },
  },
}));

import { fetchCatalogue, PAGE_SIZE } from "./fetchCatalogue";
import { startingPointFor } from "./startingPoints";

describe("fetchCatalogue reference status", () => {
  beforeEach(() => {
    mock.range.mockClear();
    mock.referenceIn.mockClear();
    mock.catalogue.data = Array.from({ length: PAGE_SIZE + 1 }, (_, index) => ({
      parent_sku: String(index), format_code: "06-00750", case_size: 6, bottle_volume_ml: 750,
    }));
    mock.reference.data = [];
    mock.reference.error = null;
  });

  it("keeps market rows and reports a failed private lookup", async () => {
    mock.reference.error = { message: "private lookup failed" };
    const result = await fetchCatalogue(startingPointFor("explore").initialState);

    expect(mock.range).toHaveBeenCalledWith(0, PAGE_SIZE);
    expect(mock.referenceIn).toHaveBeenCalledWith(
      "parent_sku", Array.from({ length: PAGE_SIZE }, (_, index) => String(index)),
    );
    expect(result.rows).toHaveLength(PAGE_SIZE);
    expect(result.hasNext).toBe(true);
    expect(result.referenceStatus).toBe("failed");
    expect(result.rows.every((row) => row.reference_price_p === null)).toBe(true);
  });

  it("treats a successful lookup with no reference rows as loaded", async () => {
    const result = await fetchCatalogue(startingPointFor("explore").initialState);
    expect(result.referenceStatus).toBe("loaded");
    expect(result.rows.every((row) => row.reference_price_p === null)).toBe(true);
  });
});
