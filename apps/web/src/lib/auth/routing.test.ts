import { describe, expect, it } from "vitest";
import { isPublicAppPath, safeReturnPath } from "./routing";

describe("isPublicAppPath", () => {
  it.each([
    "/login",
    "/login/",
    "/forgot-password",
    "/auth/update-password",
  ])("keeps %s outside the application gate", (pathname) => {
    expect(isPublicAppPath(pathname)).toBe(true);
  });

  it.each(["/", "/cellar/bbr", "/cellar/imports/bbr", "/login/other"])(
    "protects %s",
    (pathname) => {
      expect(isPublicAppPath(pathname)).toBe(false);
    },
  );
});

describe("safeReturnPath", () => {
  it.each([
    ["/", "/"],
    ["/?mode=price-changes&sort=observed_at%3Adesc", "/?mode=price-changes&sort=observed_at%3Adesc"],
    ["/cellar/bbr?region=Bordeaux", "/cellar/bbr?region=Bordeaux"],
  ])("accepts the local path %s", (value, expected) => {
    expect(safeReturnPath(value)).toBe(expected);
  });

  it.each([
    undefined,
    "",
    "https://example.com",
    "//example.com/path",
    "/login",
    "/forgot-password?next=/cellar/bbr",
    "/auth/update-password",
  ])("falls back to the catalogue for %s", (value) => {
    expect(safeReturnPath(value)).toBe("/");
  });
});
