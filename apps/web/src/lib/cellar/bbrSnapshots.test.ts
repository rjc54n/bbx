import { describe, expect, it } from "vitest";
import {
  diffCurrentSnapshot,
  suggestEffectiveDate,
  type SnapshotPositionRow,
} from "./bbrSnapshots";

function position(overrides: Partial<SnapshotPositionRow> = {}): SnapshotPositionRow {
  return {
    parent_sku: "20098007342",
    format_code: "06-00750",
    description: "Château Pontet-Canet, Pauillac, Bordeaux",
    vintage: 2009,
    quantity_bottles: 6,
    purchase_price_per_case_p: 45000,
    catalogue_matched: true,
    ...overrides,
  };
}

describe("suggestEffectiveDate", () => {
  it("extracts an ISO date from a real BBR export filename", () => {
    expect(suggestEffectiveDate("my-cellar-view-2026-07-23.csv")).toBe("2026-07-23");
  });

  it("returns null when the filename carries no date-shaped substring", () => {
    expect(suggestEffectiveDate("My Cellar.csv")).toBeNull();
  });

  it("returns null rather than guessing when two dates are present", () => {
    expect(suggestEffectiveDate("backup-2026-01-01-of-2026-01-02.csv")).toBeNull();
  });

  it("returns null for a date-shaped substring that is not a real calendar date", () => {
    expect(suggestEffectiveDate("my-cellar-view-2026-13-01.csv")).toBeNull();
    expect(suggestEffectiveDate("my-cellar-view-2026-02-30.csv")).toBeNull();
  });

  it("accepts a leap-day date", () => {
    expect(suggestEffectiveDate("my-cellar-view-2024-02-29.csv")).toBe("2024-02-29");
  });
});

describe("diffCurrentSnapshot", () => {
  it("reports no changes when the two snapshots hold identical positions", () => {
    const row = position();
    const diff = diffCurrentSnapshot([row], [row]);
    expect(diff).toEqual({
      newCurrent: [],
      becomingFormer: [],
      quantityChanges: [],
      reportedPriceChanges: [],
      undecorated: [],
    });
  });

  it("identifies a position new to the proposed snapshot", () => {
    const proposedOnly = position({ parent_sku: "999", description: "New wine" });
    const diff = diffCurrentSnapshot([], [proposedOnly]);
    expect(diff.newCurrent).toEqual([
      {
        parent_sku: "999",
        format_code: "06-00750",
        description: "New wine",
        vintage: 2009,
      },
    ]);
  });

  it("identifies a current position missing from the proposed snapshot as becoming former", () => {
    const currentOnly = position({ parent_sku: "777", description: "Departing wine" });
    const diff = diffCurrentSnapshot([currentOnly], []);
    expect(diff.becomingFormer).toEqual([
      {
        parent_sku: "777",
        format_code: "06-00750",
        description: "Departing wine",
        vintage: 2009,
      },
    ]);
  });

  it("identifies a quantity change for a position held in both snapshots", () => {
    const before = position({ quantity_bottles: 6 });
    const after = position({ quantity_bottles: 3 });
    const diff = diffCurrentSnapshot([before], [after]);
    expect(diff.quantityChanges).toEqual([
      expect.objectContaining({
        parent_sku: "20098007342",
        fromQuantityBottles: 6,
        toQuantityBottles: 3,
      }),
    ]);
    expect(diff.newCurrent).toEqual([]);
    expect(diff.becomingFormer).toEqual([]);
  });

  it("identifies a reported purchase-price change, including newly-supplied and newly-missing prices", () => {
    const before = position({ purchase_price_per_case_p: 45000 });
    const after = position({ purchase_price_per_case_p: 48000 });
    const diff = diffCurrentSnapshot([before], [after]);
    expect(diff.reportedPriceChanges).toEqual([
      expect.objectContaining({
        fromPurchasePricePerCaseP: 45000,
        toPurchasePricePerCaseP: 48000,
      }),
    ]);

    const wasPriced = position({ purchase_price_per_case_p: 45000 });
    const nowUnpriced = position({ purchase_price_per_case_p: null });
    const diff2 = diffCurrentSnapshot([wasPriced], [nowUnpriced]);
    expect(diff2.reportedPriceChanges).toEqual([
      expect.objectContaining({
        fromPurchasePricePerCaseP: 45000,
        toPurchasePricePerCaseP: null,
      }),
    ]);
  });

  it("lists a proposed row the catalogue could not decorate", () => {
    const undecorated = position({ parent_sku: "555", catalogue_matched: false });
    const diff = diffCurrentSnapshot([], [undecorated]);
    expect(diff.undecorated).toEqual([
      {
        parent_sku: "555",
        format_code: "06-00750",
        description: "Château Pontet-Canet, Pauillac, Bordeaux",
        vintage: 2009,
      },
    ]);
  });

  it("distinguishes positions by format under the same Parent ID", () => {
    const bottle = position({ format_code: "06-00750" });
    const magnum = position({ format_code: "03-01500" });
    const diff = diffCurrentSnapshot([bottle], [bottle, magnum]);
    expect(diff.newCurrent).toEqual([
      expect.objectContaining({ format_code: "03-01500" }),
    ]);
    expect(diff.becomingFormer).toEqual([]);
  });
});
