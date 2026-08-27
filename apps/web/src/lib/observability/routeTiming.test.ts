import { describe, expect, it, vi } from "vitest";
import { timeProtectedQuery } from "./routeTiming";

describe("timeProtectedQuery", () => {
  it("logs only the protected query fields and a database code", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
    await timeProtectedQuery("/scenarios/[id]", "scenario_preview", async () => ({ error: { code: "57014" } }));
    const event = JSON.parse(String(log.mock.calls[0][0]));
    expect(event).toMatchObject({
      event: "protected_route_query",
      route: "/scenarios/[id]",
      operation: "scenario_preview",
      outcome: "database_error",
      database_error_code: "57014",
    });
    expect(Object.keys(event).sort()).toEqual(["database_error_code", "elapsed_ms", "event", "operation", "outcome", "route"]);
    log.mockRestore();
  });
});
