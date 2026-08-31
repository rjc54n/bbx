import { describe, expect, it, vi } from "vitest";
import {
  type CellarTrackerEvidenceRow,
  groupCellarTrackerPanels,
  loadCellarTrackerPanels,
} from "./cellartrackerPanels";

function row(overrides: Partial<CellarTrackerEvidenceRow>): CellarTrackerEvidenceRow {
  return {
    match_group_key: "2015|wine",
    quantity_home: 0,
    quantity_bbr: 0,
    total_quantity: 0,
    accepted_at: "2026-08-01T00:00:00Z",
    producer: "Producer",
    region: "Region",
    ...overrides,
  };
}

describe("groupCellarTrackerPanels", () => {
  it("sums quantities per group and keeps producer/region/snapshot", () => {
    const panels = groupCellarTrackerPanels([
      row({ match_group_key: "2015|a", quantity_home: 6, quantity_bbr: 0, total_quantity: 6 }),
      row({ match_group_key: "2015|a", quantity_home: 3, quantity_bbr: 12, total_quantity: 15 }),
      row({ match_group_key: "2016|b", quantity_home: 1, quantity_bbr: 0, total_quantity: 1, producer: "Other", region: "Elsewhere" }),
    ]);

    expect(panels.size).toBe(2);
    expect(panels.get("2015|a")).toEqual({
      producer: "Producer",
      region: "Region",
      quantityHome: 9,
      quantityBbr: 12,
      totalQuantity: 21,
      acceptedAt: "2026-08-01T00:00:00Z",
    });
    expect(panels.get("2016|b")?.producer).toBe("Other");
  });

  it("tolerates null quantities and backfills a missing producer from a later row", () => {
    const panels = groupCellarTrackerPanels([
      row({ match_group_key: "g", quantity_home: null, quantity_bbr: null, total_quantity: null, producer: null, region: null }),
      row({ match_group_key: "g", quantity_home: 2, quantity_bbr: 0, total_quantity: 2, producer: "Real", region: "Real Region" }),
    ]);
    expect(panels.get("g")).toEqual({
      producer: "Real",
      region: "Real Region",
      quantityHome: 2,
      quantityBbr: 0,
      totalQuantity: 2,
      acceptedAt: "2026-08-01T00:00:00Z",
    });
  });

  it("keeps the latest accepted_at when rows disagree", () => {
    const panels = groupCellarTrackerPanels([
      row({ match_group_key: "g", accepted_at: "2026-07-01T00:00:00Z" }),
      row({ match_group_key: "g", accepted_at: "2026-09-01T00:00:00Z" }),
    ]);
    expect(panels.get("g")?.acceptedAt).toBe("2026-09-01T00:00:00Z");
  });
});

describe("loadCellarTrackerPanels", () => {
  it("issues exactly one fetch for the whole visible page", async () => {
    const groupKeys = Array.from({ length: 25 }, (_, i) => `2015|wine-${i}`);
    const fetchRows = vi.fn(async (keys: readonly string[]) =>
      keys.map((key) => row({ match_group_key: key, quantity_home: 6, total_quantity: 6 })),
    );

    const panels = await loadCellarTrackerPanels(fetchRows, groupKeys);

    expect(fetchRows).toHaveBeenCalledTimes(1);
    expect(fetchRows).toHaveBeenCalledWith(groupKeys);
    expect(panels.size).toBe(25);
  });

  it("does not touch the database when there are no groups", async () => {
    const fetchRows = vi.fn();
    const panels = await loadCellarTrackerPanels(fetchRows, []);
    expect(fetchRows).not.toHaveBeenCalled();
    expect(panels.size).toBe(0);
  });
});
