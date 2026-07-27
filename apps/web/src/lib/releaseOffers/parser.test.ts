import { describe, expect, it } from "vitest";
import {
  parseReleaseOfferCsv,
  releaseWineMatchKey,
  ReleaseOfferFileError,
} from "./parser";

function csvRow(overrides: Partial<Record<string, string>> = {}): string {
  const values = {
    Date: "19/05/2010",
    Wine: "Château Poujeaux 2009",
    "Case Price": "£210 per case 12 Bottles; £219 per case 6 Magnums; £291 per case 3 Double Magnums; £180 per Imperial (8 bts in Bottle)",
    JSON_Data: JSON.stringify({
      date: "2010-05-19",
      wine: "Château Poujeaux 2009",
      description: "Offer description",
      tasting_notes: "Tasting note",
    }),
    ...overrides,
  };
  return ["Date", "Wine", "Case Price", "JSON_Data"]
    .map((header) => `"${values[header as keyof typeof values].replaceAll('"', '""')}"`)
    .join(",");
}

function csv(...rows: string[]): string {
  return ["Date,Wine,Case Price,JSON_Data", ...rows].join("\n");
}

function csvRowWithParentSku(overrides: Partial<Record<string, string>> = {}): string {
  const values = {
    Date: "19/05/2010",
    Wine: "Château Poujeaux 2009",
    "Case Price": "£210 per case 12 Bottles",
    JSON_Data: JSON.stringify({
      date: "2010-05-19",
      wine: "Château Poujeaux 2009",
      description: "Offer description",
      tasting_notes: "Tasting note",
    }),
    parent_sku: "12345678901",
    BBR_URL: "https://www.bbr.com/products-12345678901-chateau-poujeaux",
    ...overrides,
  };
  return ["Date", "Wine", "Case Price", "JSON_Data", "parent_sku", "BBR_URL"]
    .map((header) => `"${values[header as keyof typeof values].replaceAll('"', '""')}"`)
    .join(",");
}

function csvWithParentSku(...rows: string[]): string {
  return ["Date,Wine,Case Price,JSON_Data,parent_sku,BBR_URL", ...rows].join("\n");
}

describe("release-offer CSV parser", () => {
  it("preserves the source row and extracts each format-specific price", () => {
    const [row] = parseReleaseOfferCsv(csv(csvRow()));
    expect(row.source_row_number).toBe(2);
    expect(row.raw_row.Wine).toBe("Château Poujeaux 2009");
    expect(row.source_match_key).toBe("chateau poujeaux");
    expect(row.prices).toMatchObject([
      { amount_p: 21000, case_size: 12, bottle_volume_ml: 750, format_code: "12-00750" },
      { amount_p: 21900, case_size: 6, bottle_volume_ml: 1500, format_code: "06-01500" },
      { amount_p: 29100, case_size: 3, bottle_volume_ml: 3000, format_code: "03-03000" },
      { amount_p: 18000, case_size: 1, bottle_volume_ml: 6000, format_code: "01-06000" },
    ]);
    expect(row.prices.every((price) => price.tax_basis === "unknown")).toBe(true);
  });

  it("recognises in-bond variants and multiple prices in one fragment", () => {
    const [row] = parseReleaseOfferCsv(csv(csvRow({
      "Case Price": "£300 per 6 bottles in bond/£204 per 3 magnums IB",
    })));
    expect(row.prices).toMatchObject([
      { amount_p: 30000, format_code: "06-00750", tax_basis: "in_bond", parse_status: "valid" },
      { amount_p: 20400, format_code: "03-01500", tax_basis: "in_bond", parse_status: "valid" },
    ]);
  });

  it("keeps incomplete price text as unresolved evidence", () => {
    const [row] = parseReleaseOfferCsv(csv(csvRow({
      "Case Price": "£444 per",
    })));
    expect(row.validation_errors).toEqual([]);
    expect(row.prices[0]).toMatchObject({
      amount_p: 44400,
      format_code: null,
      parse_status: "unresolved",
      tax_basis: "unknown",
    });
  });

  it("extracts a direct numeric BBR product identifier", () => {
    const [row] = parseReleaseOfferCsv(csv(csvRow({
      JSON_Data: JSON.stringify({
        date: "2010-05-19",
        wine: "Château Poujeaux 2009",
        description: "See https://www.bbr.com/products-12345678901-chateau-poujeaux",
        tasting_notes: "",
      }),
    })));
    expect(row.source_product_id).toBe("12345678901");
    expect(row.source_product_url).toContain("bbr.com/products-12345678901");
  });

  it("does not treat third-party tracking URLs as resolved product URLs", () => {
    const [row] = parseReleaseOfferCsv(csv(csvRow({
      JSON_Data: JSON.stringify({
        date: "2010-05-19",
        wine: "Château Poujeaux 2009",
        description: "https://service69.mimecast.com/mimecast/click?code=secret",
        tasting_notes: "",
      }),
    })));
    expect(row.source_product_id).toBeNull();
    expect(row.source_product_url).toBeNull();
  });

  it("records inconsistent embedded metadata as warnings", () => {
    const [row] = parseReleaseOfferCsv(csv(csvRow({
      JSON_Data: JSON.stringify({
        date: "2011-01-01",
        wine: "Another wine",
        description: "",
        tasting_notes: "",
      }),
    })));
    expect(row.validation_warnings).toHaveLength(2);
    expect(row.validation_errors).toEqual([]);
  });

  it("rejects an unexpected source contract", () => {
    expect(() => parseReleaseOfferCsv("Date,Wine\n19/05/2010,Test"))
      .toThrow(ReleaseOfferFileError);
  });
});

describe("release wine match key", () => {
  it("removes accents, punctuation and a vintage", () => {
    expect(releaseWineMatchKey("2007 Le Musigny, Grand Cru, Domaine J-F Mugnier"))
      .toBe("le musigny grand cru domaine j f mugnier");
  });
});

describe("the six-column parent_sku source contract", () => {
  it("accepts the new header alongside the legacy four-column header", () => {
    const [row] = parseReleaseOfferCsv(csvWithParentSku(csvRowWithParentSku()));
    expect(row.source_product_id).toBe("12345678901");
    expect(row.source_product_url).toBe("https://www.bbr.com/products-12345678901-chateau-poujeaux");
  });

  it("prefers the CSV parent_sku column over JSON_Data.source_product_id and a scraped link", () => {
    const [row] = parseReleaseOfferCsv(csvWithParentSku(csvRowWithParentSku({
      parent_sku: "10000000001",
      JSON_Data: JSON.stringify({
        date: "2010-05-19",
        wine: "Château Poujeaux 2009",
        description: "See https://www.bbr.com/products-99999999999-chateau-poujeaux",
        tasting_notes: "",
        source_product_id: "20000000002",
      }),
    })));
    expect(row.source_product_id).toBe("10000000001");
  });

  it("falls back to JSON_Data.source_product_id when parent_sku is not a valid numeric ID", () => {
    const [row] = parseReleaseOfferCsv(csvWithParentSku(csvRowWithParentSku({
      parent_sku: "not-a-number",
      JSON_Data: JSON.stringify({
        date: "2010-05-19",
        wine: "Château Poujeaux 2009",
        description: "",
        tasting_notes: "",
        source_product_id: "20000000002",
      }),
    })));
    expect(row.source_product_id).toBe("20000000002");
    expect(row.validation_warnings).toContain(
      "The parent_sku column is not a supported numeric BBR Parent ID.",
    );
  });

  it("falls back to a scraped bbr.com link when parent_sku and JSON_Data.source_product_id are both absent", () => {
    const [row] = parseReleaseOfferCsv(csvWithParentSku(csvRowWithParentSku({
      parent_sku: "",
      BBR_URL: "",
      JSON_Data: JSON.stringify({
        date: "2010-05-19",
        wine: "Château Poujeaux 2009",
        description: "See https://www.bbr.com/products-30000000003-chateau-poujeaux",
        tasting_notes: "",
      }),
    })));
    expect(row.source_product_id).toBe("30000000003");
  });

  it("rejects a BBR_URL whose host is not bbr.com and does not store it", () => {
    const [row] = parseReleaseOfferCsv(csvWithParentSku(csvRowWithParentSku({
      parent_sku: "",
      BBR_URL: "https://example.com/products-12345678901-chateau-poujeaux",
      JSON_Data: JSON.stringify({
        date: "2010-05-19",
        wine: "Château Poujeaux 2009",
        description: "",
        tasting_notes: "",
      }),
    })));
    expect(row.source_product_url).toBeNull();
    expect(row.source_product_id).toBeNull();
    expect(row.validation_warnings).toContain("BBR_URL is not a valid bbr.com product link.");
  });

  it("stores a bbr.com BBR_URL as source_product_url even without a resolvable product ID", () => {
    const [row] = parseReleaseOfferCsv(csvWithParentSku(csvRowWithParentSku({
      parent_sku: "",
      BBR_URL: "https://www.bbr.com/offers/current-en-primeur",
      JSON_Data: JSON.stringify({
        date: "2010-05-19",
        wine: "Château Poujeaux 2009",
        description: "",
        tasting_notes: "",
      }),
    })));
    expect(row.source_product_url).toBe("https://www.bbr.com/offers/current-en-primeur");
    expect(row.source_product_id).toBeNull();
  });
});

describe("malformed rows", () => {
  it("quarantines a flattened offer table by its header signature", () => {
    const [row] = parseReleaseOfferCsv(csv(csvRow({
      Wine: "VintageWineCase sizeBottle SizeAvailable CasesPrice per case IB2005Château Batailley, Pauillac, Bordeaux1275cl6",
      "Case Price": "£6002005Château Branaire-Ducru, St Julien1275cl2£3,2522005Château Haut-Brion, Pessac1275cl1",
    })));
    expect(row.prices).toEqual([]);
    expect(row.validation_errors).toEqual([]);
    expect(row.validation_warnings.some((w) => /flattened offer table/i.test(w))).toBe(true);
  });

  it("quarantines a row whose price overflows int4, without the header signature", () => {
    const [row] = parseReleaseOfferCsv(csv(csvRow({
      Wine: "Château Haut-Brion 2005",
      "Case Price": "£3,2522005 in bond",
    })));
    expect(row.prices).toEqual([]);
    expect(row.validation_warnings.some((w) => /flattened offer table/i.test(w))).toBe(true);
  });

  it("still extracts prices from a normal multi-format row", () => {
    const [row] = parseReleaseOfferCsv(csv(csvRow()));
    expect(row.prices.length).toBeGreaterThan(0);
    expect(row.prices.every((p) => p.amount_p === null || p.amount_p <= 2_147_483_647)).toBe(true);
  });
});
