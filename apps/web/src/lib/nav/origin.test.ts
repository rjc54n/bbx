import { describe, expect, it } from "vitest";
import { currentLocation, readOrigin, wineHref } from "./origin";

describe("readOrigin", () => {
  it("accepts a same-origin absolute path with query", () => {
    expect(readOrigin("/?mode=explore&region=Bordeaux")).toBe("/?mode=explore&region=Bordeaux");
    expect(readOrigin("/scenarios/abc")).toBe("/scenarios/abc");
  });

  it("rejects protocol-relative and scheme paths", () => {
    expect(readOrigin("//evil.example")).toBeNull();
    expect(readOrigin("/\\evil.example")).toBeNull();
    expect(readOrigin("https://evil.example")).toBeNull();
    expect(readOrigin("javascript:alert(1)")).toBeNull();
  });

  it("rejects relative and empty values", () => {
    expect(readOrigin("scenarios/abc")).toBeNull();
    expect(readOrigin("")).toBeNull();
    expect(readOrigin(null)).toBeNull();
    expect(readOrigin(undefined)).toBeNull();
  });
});

describe("currentLocation", () => {
  it("appends a query string only when present", () => {
    expect(currentLocation("/", new URLSearchParams("a=1&b=2"))).toBe("/?a=1&b=2");
    expect(currentLocation("/cellartracker", "")).toBe("/cellartracker");
    expect(currentLocation("/x", new URLSearchParams())).toBe("/x");
  });
});

describe("wineHref", () => {
  it("tags on a validated, encoded origin", () => {
    expect(wineHref("123", "/?region=Bordeaux&sort=ask")).toBe(
      "/wine/parent/123?from=%2F%3Fregion%3DBordeaux%26sort%3Dask",
    );
  });

  it("omits the param when there is no usable origin", () => {
    expect(wineHref("123")).toBe("/wine/parent/123");
    expect(wineHref("123", "//evil")).toBe("/wine/parent/123");
    expect(wineHref("123", null)).toBe("/wine/parent/123");
  });
});
