import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import ProtectedRouteError from "./error";

describe("protected route error", () => {
  it("offers a retry and a safe route back without error detail", () => {
    const html = renderToStaticMarkup(<ProtectedRouteError error={Object.assign(new Error("database connection failed"), { digest: "x" })} reset={vi.fn()} />);
    expect(html).toContain("Try again");
    expect(html).toContain("Return to catalogue");
    expect(html).not.toContain("database connection failed");
  });
});
