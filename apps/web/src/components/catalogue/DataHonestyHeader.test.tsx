import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
import { PublicationBanner } from "./DataHonestyHeader";
import type { ScanHealthRow } from "@/lib/query/scanHealth";

it("shows old publication, incomplete discovery and failed later publication together", () => {
  const html = renderToStaticMarkup(<PublicationBanner loading={false} now={Date.parse("2026-10-04T12:00:00Z")}
    health={{ publication: { published_at: "2026-10-01T12:00:00Z", algolia_complete: false,
      rest_skus_expected: 100, rest_skus_priced: 90 } as ScanHealthRow,
      failure: { finished_at: "2026-10-02T12:00:00Z", source_committed_at: "2026-10-02T11:50:00Z" } as ScanHealthRow }} />);
  expect(html).toContain("Last published:");
  expect(html).toContain("Incomplete");
  expect(html).toContain("Publication is over 60 hours old.");
  expect(html).toContain("Later attempt failed:");
  expect(html).toContain("Source saved; publication needs recovery.");
});
it("keeps unavailable status distinct from no verified history", () => {
  const unavailable = renderToStaticMarkup(<PublicationBanner loading={false} health={null} now={0} />);
  expect(unavailable).toContain("Publication status unavailable.");
  expect(unavailable).not.toContain("No verified publication");
});
