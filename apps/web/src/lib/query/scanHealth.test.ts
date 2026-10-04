import { beforeEach, describe, expect, it, vi } from "vitest";
const { from } = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { from } }));
import { fetchPublicationHealth, publicationIsOverdue } from "./scanHealth";

function query(data: unknown, error: unknown = null) {
  const chain = {
    select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data, error }),
  };
  from.mockReturnValueOnce(chain);
  return chain;
}
beforeEach(() => from.mockReset());
describe("publication status", () => {
  it("shows useful partial publication and a later failed attempt", async () => {
    const publication = { published_at: "2026-10-01T12:00:00Z", status: "partial" };
    const failure = { finished_at: "2026-10-02T12:00:00Z", status: "failed" };
    const publishedQuery = query(publication);
    query(failure);
    expect(await fetchPublicationHealth()).toEqual({ publication, failure });
    expect(publishedQuery.eq).toHaveBeenCalledWith("scope", "biddable_full_book");
    expect(publishedQuery.eq).not.toHaveBeenCalledWith("status", "completed");
    expect(publishedQuery.not).toHaveBeenCalledWith("published_at", "is", null);
  });
  it("hides an older failure once a newer publication succeeds", async () => {
    query({ published_at: "2026-10-03T12:00:00Z" });
    query({ finished_at: "2026-10-02T12:00:00Z" });
    expect((await fetchPublicationHealth()).failure).toBeNull();
  });
  it("does not invent a publication for historical terminal statuses", async () => {
    query(null); query({ finished_at: "2026-10-02T12:00:00Z" });
    const health = await fetchPublicationHealth();
    expect(health.publication).toBeNull();
    expect(health.failure).not.toBeNull();
  });
  it("exposes a status query error instead of an empty history", async () => {
    query(null, new Error("unavailable")); query(null);
    await expect(fetchPublicationHealth()).rejects.toThrow("unavailable");
  });
  it("alerts only after 60 hours, independent of later window-only jobs", () => {
    const at = "2026-10-01T12:00:00Z";
    const threshold = Date.parse(at) + 60 * 3_600_000;
    expect(publicationIsOverdue(at, threshold)).toBe(false);
    expect(publicationIsOverdue(at, threshold + 1)).toBe(true);
    expect(publicationIsOverdue(null, threshold)).toBe(true);
  });
});
