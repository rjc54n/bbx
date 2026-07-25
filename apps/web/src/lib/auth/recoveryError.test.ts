import { describe, expect, it } from "vitest";
import { passwordRecoveryErrorMessage } from "./recoveryError";

describe("passwordRecoveryErrorMessage", () => {
  it.each([
    { status: 429 },
    { code: "email_rate_limit_exceeded" },
    { code: "over_email_send_rate_limit" },
  ])("explains authentication email rate limits for $code$status", (error) => {
    expect(passwordRecoveryErrorMessage(error)).toBe(
      "The authentication email limit has been reached. Wait one hour after the most recent email before trying again.",
    );
  });

  it("keeps other delivery failures generic", () => {
    expect(
      passwordRecoveryErrorMessage({
        code: "unexpected_failure",
        status: 500,
      }),
    ).toBe(
      "The password email could not be sent. Check the address and try again later.",
    );
  });
});
