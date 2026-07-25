import { describe, expect, it } from "vitest";
import { MIN_PASSWORD_LENGTH, validateNewPassword } from "./password";

describe("validateNewPassword", () => {
  it("accepts a matching password at the minimum length", () => {
    const password = "a".repeat(MIN_PASSWORD_LENGTH);

    expect(validateNewPassword(password, password)).toEqual({
      password,
      error: null,
    });
  });

  it("rejects short passwords", () => {
    expect(validateNewPassword("short", "short")).toEqual({
      password: null,
      error: `Use at least ${MIN_PASSWORD_LENGTH} characters.`,
    });
  });

  it("rejects mismatched confirmation", () => {
    expect(
      validateNewPassword(
        "a-long-password",
        "a-different-one",
      ),
    ).toEqual({
      password: null,
      error: "The passwords do not match.",
    });
  });

  it("rejects missing form values", () => {
    expect(validateNewPassword(null, null)).toEqual({
      password: null,
      error: "Enter and confirm the new password.",
    });
  });
});
