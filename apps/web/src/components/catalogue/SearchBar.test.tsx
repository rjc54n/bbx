import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SearchBar } from "./SearchBar";

describe("SearchBar", () => {
  it("renders an explicitly submitted search form", () => {
    const markup = renderToStaticMarkup(
      <SearchBar value="Lafite" onCommit={vi.fn()} />,
    );

    expect(markup).toContain('<form role="search"');
    expect(markup).toContain('value="Lafite"');
    expect(markup).toContain('<button type="submit"');
    expect(markup).toContain("Search</button>");
  });
});
