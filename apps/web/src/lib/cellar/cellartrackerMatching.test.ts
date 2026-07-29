import { describe, expect, it } from "vitest";
import {
  bbrCatalogueCoreTokens,
  cellarTrackerCatalogueQuery,
  cellarTrackerCoreTokens,
  coreKey,
  coreKeyScore,
  rankCellarTrackerCandidates,
  wineCoreTokens,
  type BbrCatalogueIdentity,
} from "./cellartrackerMatching";

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

describe("wineCoreTokens", () => {
  it("folds accents, sorts and de-duplicates", () => {
    expect(wineCoreTokens("Château Léoville  Barton, Léoville")).toEqual(["barton", "chateau", "leoville"]);
  });

  it("drops vintage tokens wherever they appear", () => {
    expect(wineCoreTokens("2018 Barrua 1996")).toEqual(["barrua"]);
  });

  it("drops articles and conjunctions but keeps producer words", () => {
    expect(wineCoreTokens("Domaine de la Romanée-Conti")).toEqual(["conti", "domaine", "romanee"]);
  });

  it("returns nothing for empty and punctuation-only input", () => {
    expect(wineCoreTokens("")).toEqual([]);
    expect(wineCoreTokens(null)).toEqual([]);
    expect(wineCoreTokens(" , - , ")).toEqual([]);
  });
});

describe("coreKeyScore", () => {
  it("scores identical sets as 1 and disjoint sets as 0", () => {
    expect(coreKeyScore(["a", "b"], ["a", "b"])).toBe(1);
    expect(coreKeyScore(["a"], ["b"])).toBe(0);
    expect(coreKeyScore([], ["a"])).toBe(0);
  });

  it("is the harmonic mean of precision and recall", () => {
    expect(coreKeyScore(["a", "b"], ["a", "b", "c"])).toBeCloseTo(0.8, 5);
  });
});

/**
 * Real `prod_product` records, captured 29 July 2026. The trailing geography
 * segments and the mismatch between BBR's `region` and the geography spelled
 * inside the name (Sardegna vs Sardinia) are load-bearing, so these are kept
 * verbatim rather than tidied.
 */
const BARRUA: BbrCatalogueIdentity = { name: "2018 Barrua, Isola dei Nuraghi, Punica, Sardinia, Italy", producer: "Agricola Punica", country: "Italy", region: "Sardegna", subregion: "Isola dei Nuraghi" };
const LEOVILLE_BARTON: BbrCatalogueIdentity = { name: "2018 Château Léoville Barton, St Julien, Bordeaux", producer: "Château Léoville Barton", country: "France", region: "Bordeaux", subregion: "Médoc" };
const GRANGE: BbrCatalogueIdentity = { name: "2013 Penfolds, Grange, Bin 95, Australia", producer: "Penfolds", country: "Australia", region: "South Australia", subregion: "Barossa" };
const CLOS_ST_JACQUES: BbrCatalogueIdentity = { name: "2017 Gevrey-Chambertin, Clos St Jacques, 1er Cru, Domaine Armand Rousseau, Burgundy", producer: "Domaine Armand Rousseau", country: "France", region: "Burgundy", subregion: "Côte de Nuits" };
const HAMILTON_RUSSELL: BbrCatalogueIdentity = { name: "2025 Hamilton Russell Vineyards, Chardonnay, Hemel-en-Aarde Valley, South Africa", producer: "Hamilton Russell Vineyards", country: "South Africa", region: "Cape South Coast", subregion: "Walker Bay" };
const WHISPERING_ANGEL: BbrCatalogueIdentity = { name: "2025 Château d'Esclans, Whispering Angel Rosé, Côtes de Provence", producer: "Château d'Esclans", country: "France", region: "Provence", subregion: "Côtes de Provence" };
const TESTAMATTA: BbrCatalogueIdentity = { name: "2025 Testamatta Bianco, Bibi Graetz, Tuscany, Italy", producer: "Bibi Graetz", country: "Italy", region: "Tuscany", subregion: null };
const POLISH_HILL: BbrCatalogueIdentity = { name: "2025 Grosset, Polish Hill Riesling, Clare Valley, Australia", producer: "Grosset", country: "Australia", region: "South Australia", subregion: "Clare Valley" };
const SASSICAIA: BbrCatalogueIdentity = { name: "2018 Sassicaia, Tenuta San Guido, Bolgheri Sassicaia, Tuscany, Italy", producer: "Sassicaia", country: "Italy", region: "Tuscany", subregion: "Bolgheri Sassicaia" };
const CHATEAU_MARGAUX: BbrCatalogueIdentity = { name: "2015 Château Margaux, Margaux, Bordeaux", producer: "Château Margaux", country: "France", region: "Bordeaux", subregion: "Médoc" };
const PAVILLON_BLANC: BbrCatalogueIdentity = { name: "2015 Pavillon Blanc du Château Margaux, Bordeaux", producer: "Château Margaux", country: "France", region: "Bordeaux", subregion: null };
const PICHON_LALANDE: BbrCatalogueIdentity = { name: "2016 Château Pichon Longueville Comtesse de Lalande, Pauillac, Bordeaux", producer: "Château Pichon-Longueville Lalande", country: "France", region: "Bordeaux", subregion: "Médoc" };
const DOMAINE_LEFLAIVE: BbrCatalogueIdentity = { name: "2018 Puligny-Montrachet, Les Pucelles, 1er Cru, Domaine Leflaive, Burgundy", producer: "Domaine Leflaive", country: "France", region: "Burgundy", subregion: "Côte de Beaune" };
const OLIVIER_LEFLAIVE: BbrCatalogueIdentity = { name: "2018 Puligny-Montrachet, Les Pucelles, 1er Cru, Olivier Leflaive, Burgundy", producer: "Olivier Leflaive", country: "France", region: "Burgundy", subregion: "Côte de Beaune" };
const LA_MOULINE: BbrCatalogueIdentity = { name: "2018 Côte-Rôtie, La Mouline, E. Guigal, Rhône", producer: "Maison Guigal", country: "France", region: "Rhône ", subregion: "Northern Rhône" };
const DRC_RICHEBOURG: BbrCatalogueIdentity = { name: "2017 Richebourg, Grand Cru, Domaine de la Romanée-Conti, Burgundy", producer: "Domaine de la Romanée-Conti (DRC)", country: "France", region: "Burgundy", subregion: "Côte de Nuits" };
const MORTET_ECHEZEAUX: BbrCatalogueIdentity = { name: "2017 Echezeaux, Grand Cru, Domaine Denis Mortet, Burgundy", producer: "Denis Mortet", country: "France", region: "Burgundy", subregion: "Côte de Nuits" };

describe("bbrCatalogueCoreTokens", () => {
  it("drops wholly geographic trailing segments", () => {
    expect(bbrCatalogueCoreTokens(TESTAMATTA)).toEqual(["bianco", "bibi", "graetz", "testamatta"]);
    expect(bbrCatalogueCoreTokens(POLISH_HILL)).toEqual(["grosset", "hill", "polish", "riesling"]);
  });

  it("never drops the first segment, so an eponymous appellation survives", () => {
    expect(bbrCatalogueCoreTokens(CHATEAU_MARGAUX)).toEqual(["chateau", "margaux"]);
  });

  it("keeps geography that the record's own fields spell differently", () => {
    expect(bbrCatalogueCoreTokens(BARRUA)).toEqual(["agricola", "barrua", "punica", "sardinia"]);
  });

  /**
   * "E. Guigal" keeps only "guigal": a single-letter initial collides with the
   * "e" stopword and is dropped from both sides, which is harmless while the
   * surname carries the identity.
   */
  it("folds a producer field that the name does not repeat", () => {
    expect(bbrCatalogueCoreTokens(LA_MOULINE)).toEqual(["cote", "guigal", "maison", "mouline", "rotie"]);
  });
});

describe("cellarTrackerCoreTokens", () => {
  it("unions the wine and producer without subtracting geography", () => {
    expect(coreKey(cellarTrackerCoreTokens("Agricola Punica Barrua", "Agricola Punica")))
      .toBe("agricola barrua punica");
  });

  it("keeps a Burgundy cru name that is also the appellation", () => {
    expect(cellarTrackerCoreTokens("Domaine de la Romanee-Conti Echezeaux", "Domaine de la Romanee-Conti"))
      .toEqual(["conti", "domaine", "echezeaux", "romanee"]);
  });
});

type Fixture = {
  wine: string;
  producer: string;
  vintage: number;
  pool: Array<[string, BbrCatalogueIdentity]>;
  expectedTop: string;
  expectedAutoLink: string | null;
};

/**
 * The shortlist pools are the candidates the two Algolia queries actually
 * returned for these rows, reduced to the entries that scored above zero plus
 * the near-miss distractors that make the auto-link decision non-trivial.
 */
const FIXTURES: Fixture[] = [
  { wine: "Agricola Punica Barrua", producer: "Agricola Punica", vintage: 2018, pool: [["20188027560", BARRUA]], expectedTop: "20188027560", expectedAutoLink: "20188027560" },
  { wine: "Chateau Leoville Barton", producer: "Chateau Leoville Barton", vintage: 2018, pool: [["20181012361", LEOVILLE_BARTON]], expectedTop: "20181012361", expectedAutoLink: "20181012361" },
  { wine: "Penfolds Grange", producer: "Penfolds", vintage: 2013, pool: [["20131004285", GRANGE]], expectedTop: "20131004285", expectedAutoLink: "20131004285" },
  { wine: "Domaine Armand Rousseau Pere et Fils Gevrey-Chambertin Clos St. Jacques", producer: "Domaine Armand Rousseau Pere et Fils", vintage: 2017, pool: [["20171057092", CLOS_ST_JACQUES]], expectedTop: "20171057092", expectedAutoLink: null },
  { wine: "Hamilton Russell Vineyards Chardonnay", producer: "Hamilton Russell Vineyards", vintage: 2025, pool: [["20258114020", HAMILTON_RUSSELL]], expectedTop: "20258114020", expectedAutoLink: "20258114020" },
  { wine: "Chateau d'Esclans Whispering Angel Rose", producer: "Chateau d'Esclans", vintage: 2025, pool: [["20258116037", WHISPERING_ANGEL]], expectedTop: "20258116037", expectedAutoLink: "20258116037" },
  { wine: "Bibi Graetz Testamatta Bianco", producer: "Bibi Graetz", vintage: 2025, pool: [["20258157089", TESTAMATTA]], expectedTop: "20258157089", expectedAutoLink: "20258157089" },
  { wine: "Grosset Polish Hill Riesling", producer: "Grosset", vintage: 2025, pool: [["20258125905", POLISH_HILL]], expectedTop: "20258125905", expectedAutoLink: "20258125905" },
  { wine: "Tenuta San Guido Sassicaia Bolgheri", producer: "Tenuta San Guido", vintage: 2018, pool: [["20188008596", SASSICAIA]], expectedTop: "20188008596", expectedAutoLink: "20188008596" },
  { wine: "Chateau Margaux", producer: "Chateau Margaux", vintage: 2015, pool: [["20158007951", CHATEAU_MARGAUX], ["20158122861", PAVILLON_BLANC]], expectedTop: "20158007951", expectedAutoLink: "20158007951" },
  { wine: "Chateau Pichon Longueville Comtesse de Lalande", producer: "Chateau Pichon Longueville Comtesse de Lalande", vintage: 2016, pool: [["20168009157", PICHON_LALANDE]], expectedTop: "20168009157", expectedAutoLink: "20168009157" },
  { wine: "Domaine Leflaive Puligny-Montrachet 1er Cru Les Pucelles", producer: "Domaine Leflaive", vintage: 2018, pool: [["20181073515", DOMAINE_LEFLAIVE], ["20188016151", OLIVIER_LEFLAIVE]], expectedTop: "20181073515", expectedAutoLink: "20181073515" },
  { wine: "E. Guigal Cote-Rotie La Mouline", producer: "E. Guigal", vintage: 2018, pool: [["20188012531", LA_MOULINE]], expectedTop: "20188012531", expectedAutoLink: "20188012531" },
  // DRC Echezeaux 2017 is not in the catalogue. The shortlist offers the right
  // producer with the wrong wine and the right wine from the wrong producer;
  // neither may be linked without review.
  { wine: "Domaine de la Romanee-Conti Echezeaux", producer: "Domaine de la Romanee-Conti", vintage: 2017, pool: [["20178122164", DRC_RICHEBOURG], ["20178018780", MORTET_ECHEZEAUX]], expectedTop: "20178122164", expectedAutoLink: null },
];

function hitsFor(fixture: Fixture) {
  return fixture.pool.map(([parentSku, product]) => ({
    parent_sku: parentSku,
    name: product.name,
    vintage: fixture.vintage,
    producer: product.producer,
    region: product.region,
    subregion: product.subregion,
    country: product.country,
  }));
}

describe("rankCellarTrackerCandidates", () => {
  it.each(FIXTURES)("ranks and decides $wine", (fixture) => {
    const result = rankCellarTrackerCandidates({
      match_group_key: `${fixture.vintage}|test`,
      source_wine: fixture.wine,
      source_producer: fixture.producer,
      source_vintage: fixture.vintage,
    }, hitsFor(fixture));
    expect(result.candidates[0]?.parent_sku).toBe(fixture.expectedTop);
    expect(result.autoLinkParentSku).toBe(fixture.expectedAutoLink);
  });

  it("auto-links 12 of the 14 representative rows", () => {
    const linked = FIXTURES.filter((fixture) => fixture.expectedAutoLink !== null);
    expect(linked).toHaveLength(12);
  });

  it("numbers candidates by descending score", () => {
    const result = rankCellarTrackerCandidates({
      match_group_key: "2018|test",
      source_wine: "Domaine Leflaive Puligny-Montrachet 1er Cru Les Pucelles",
      source_producer: "Domaine Leflaive",
      source_vintage: 2018,
    }, hitsFor(FIXTURES[11]));
    expect(result.candidates.map((candidate) => candidate.rank)).toEqual([1, 2]);
    expect(result.candidates[0].match_score).toBeGreaterThan(result.candidates[1].match_score);
  });

  it("never auto-links without a source vintage", () => {
    const result = rankCellarTrackerCandidates({
      match_group_key: "unknown|test",
      source_wine: "Bibi Graetz Testamatta Bianco",
      source_producer: "Bibi Graetz",
      source_vintage: null,
    }, hitsFor(FIXTURES[6]));
    expect(result.candidates).toHaveLength(1);
    expect(result.autoLinkParentSku).toBeNull();
  });

  it("ignores hits whose vintage does not match the group", () => {
    const result = rankCellarTrackerCandidates({
      match_group_key: "2019|test",
      source_wine: "Agricola Punica Barrua",
      source_producer: "Agricola Punica",
      source_vintage: 2019,
    }, hitsFor(FIXTURES[0]));
    expect(result.candidates).toHaveLength(0);
    expect(result.autoLinkParentSku).toBeNull();
  });

  it("returns at most five suggestions", () => {
    const pool = Array.from({ length: 8 }, (_, index) => ({
      parent_sku: `2018800000${index}`,
      name: `2018 Barolo ${index}, Piedmont, Italy`,
      vintage: 2018,
      producer: "Barolo House",
      region: "Piedmont",
      country: "Italy",
    }));
    const result = rankCellarTrackerCandidates({
      match_group_key: "2018|test",
      source_wine: "Barolo House Barolo 3",
      source_producer: "Barolo House",
      source_vintage: 2018,
    }, pool);
    expect(result.candidates).toHaveLength(5);
  });
});
