import { describe, expect, it } from "vitest";
import { cellarTrackerCatalogueQuery } from "./cellartrackerMatching";

describe("CellarTracker catalogue query", () => {
  it("removes a leading producer from the CellarTracker wine name", () => {
    expect(cellarTrackerCatalogueQuery("Agricola Punica Barrua", "Agricola Punica")).toBe("barrua");
  });

  it("keeps the wine when it is the same as the producer", () => {
    expect(cellarTrackerCatalogueQuery("Domaine de l'A", "Domaine de l'A")).toBe("Domaine de l'A");
  });

  it("does not remove a producer mentioned later in the wine name", () => {
    expect(cellarTrackerCatalogueQuery("Barrua Agricola Punica", "Agricola Punica")).toBe("Barrua Agricola Punica");
  });
});
