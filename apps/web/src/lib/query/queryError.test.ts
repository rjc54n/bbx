import { describe, it, expect } from "vitest";
import { describeQueryError } from "./queryError";

describe("describeQueryError", () => {
  it("reads the message from a real Error", () => {
    expect(describeQueryError(new Error("boom"))).toBe("boom");
  });

  it("surfaces a PostgREST error object instead of [object Object]", () => {
    const err = {
      message: "canceling statement due to statement timeout",
      details: null,
      hint: null,
      code: "57014",
    };
    expect(describeQueryError(err)).toBe(
      "canceling statement due to statement timeout (57014)",
    );
  });

  it("joins message, details and hint when present", () => {
    const err = { message: "permission denied for view x", details: "role authenticated", code: "42501" };
    expect(describeQueryError(err)).toBe("permission denied for view x — role authenticated (42501)");
  });

  it("falls back to JSON for an object with no message", () => {
    expect(describeQueryError({ foo: 1 })).toBe('{"foo":1}');
  });

  it("stringifies primitives", () => {
    expect(describeQueryError("plain string")).toBe("plain string");
  });
});
