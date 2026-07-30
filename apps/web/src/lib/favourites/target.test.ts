import { describe, expect, it } from "vitest";
import {
  buildFavouriteState,
  isFavourited,
  isValidFavouriteTarget,
  pendingKey,
  targetForRecord,
} from "./target";

describe("targetForRecord", () => {
  it("favourites the wine once a record is linked, so the star propagates", () => {
    expect(targetForRecord("release_offer", "linked", "20100000001", "2010|a wine"))
      .toEqual({ kind: "wine", parentSku: "20100000001" });
  });

  it("falls back to the match group while a record is unlinked", () => {
    expect(targetForRecord("cellartracker", null, null, "2010|a wine"))
      .toEqual({ kind: "record", source: "cellartracker", matchGroupKey: "2010|a wine" });
  });

  it("treats a suppressed or ignored record as unlinked", () => {
    expect(targetForRecord("cellartracker", "suppressed", null, "2010|a wine"))
      .toEqual({ kind: "record", source: "cellartracker", matchGroupKey: "2010|a wine" });
    expect(targetForRecord("release_offer", "ignored", null, "2010|a wine"))
      .toEqual({ kind: "record", source: "release_offer", matchGroupKey: "2010|a wine" });
  });

  it("prefers the wine even when a group key is also present", () => {
    expect(targetForRecord("cellartracker", "linked", "20100000001", "2010|a wine"))
      .toEqual({ kind: "wine", parentSku: "20100000001" });
  });

  it("gives no target when there is neither a link nor a group key", () => {
    expect(targetForRecord("cellartracker", null, null, null)).toBeNull();
  });

  it("gives no target for a link with no Parent ID and no group key", () => {
    expect(targetForRecord("release_offer", "linked", null, null)).toBeNull();
  });
});

describe("isFavourited", () => {
  const state = buildFavouriteState(
    ["20100000001"],
    [{ source: "cellartracker", match_group_key: "2011|pending wine" }],
  );

  it("reports a favourited wine", () => {
    expect(isFavourited(state, { kind: "wine", parentSku: "20100000001" })).toBe(true);
  });

  it("reports an unfavourited wine", () => {
    expect(isFavourited(state, { kind: "wine", parentSku: "20999999999" })).toBe(false);
  });

  it("reports a pending favourite", () => {
    expect(isFavourited(state, {
      kind: "record",
      source: "cellartracker",
      matchGroupKey: "2011|pending wine",
    })).toBe(true);
  });

  it("does not leak a pending favourite across sources sharing a group key", () => {
    expect(isFavourited(state, {
      kind: "record",
      source: "release_offer",
      matchGroupKey: "2011|pending wine",
    })).toBe(false);
  });

  it("ignores pending rows with an unrecognised source", () => {
    const odd = buildFavouriteState([], [{ source: "not_a_source", match_group_key: "2011|x" }]);
    expect(odd.pendingKeys.size).toBe(0);
  });
});

describe("pendingKey", () => {
  it("namespaces the group key by source", () => {
    expect(pendingKey("cellartracker", "2011|a wine")).toBe("cellartracker:2011|a wine");
  });
});

describe("isValidFavouriteTarget", () => {
  it("accepts a Parent ID of five to thirty digits", () => {
    expect(isValidFavouriteTarget({ kind: "wine", parentSku: "12345" })).toBe(true);
    expect(isValidFavouriteTarget({ kind: "wine", parentSku: "20100000001" })).toBe(true);
  });

  it("rejects a Parent ID the database check would reject", () => {
    expect(isValidFavouriteTarget({ kind: "wine", parentSku: "1234" })).toBe(false);
    expect(isValidFavouriteTarget({ kind: "wine", parentSku: "2010-0000-1" })).toBe(false);
    expect(isValidFavouriteTarget({ kind: "wine", parentSku: "" })).toBe(false);
  });

  it("rejects an empty or over-long match group key", () => {
    expect(isValidFavouriteTarget({
      kind: "record",
      source: "cellartracker",
      matchGroupKey: "",
    })).toBe(false);
    expect(isValidFavouriteTarget({
      kind: "record",
      source: "cellartracker",
      matchGroupKey: "x".repeat(1_101),
    })).toBe(false);
  });

  it("accepts a match group key at the database limit", () => {
    expect(isValidFavouriteTarget({
      kind: "record",
      source: "cellartracker",
      matchGroupKey: "x".repeat(1_100),
    })).toBe(true);
  });
});
