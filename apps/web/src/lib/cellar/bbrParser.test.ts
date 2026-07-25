import { describe, expect, it } from "vitest";
import {
  BBR_HEADERS,
  BbrFileError,
  matchBbrRows,
  parseBbrCsv,
} from "./bbrParser";

function csvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function validRow(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    "Parent ID": "20098007342",
    "Product Code(s)": "2009-06-00750-01-8007342",
    Country: "France",
    Region: "Bordeaux",
    Vintage: "2009",
    Description: "Château Pontet-Canet, Pauillac, Bordeaux",
    Colour: "Red",
    Maturity: "Ready - at best",
    "Drinking Window (From)": "2015",
    "Drinking Window (To)": "2037",
    "Bottle Format": "Bottle",
    "Bottle Volume": "75 cl",
    "Quantity in Bottles": "6",
    "Eligible for Sale on BBX": "YES",
    "Purchase Price per Case": "450",
    "Case Size": "6",
    "Livex Market Price": "816",
    "Wine Searcher Lowest List Price": "756",
    "BBX Last Transaction Price": "800",
    "BBX Lowest Price": "820",
    "BBX Highest Bid": "785",
    "Selling Case Quantity on BBX": "",
    "Selling Price on BBX": "",
    "Account Payer": "Private owner",
    "Beneficial Owner": "Private owner",
    "Current Status": "In bond",
    "Alcohol Content": "13.5%",
    "Purchase date / warehouse goods in date": "",
    ...overrides,
  };
}

function makeCsv(
  rows: Record<string, string>[],
  headers: readonly string[] = BBR_HEADERS,
): string {
  return [
    headers.map(csvCell).join(","),
    ...rows.map((row) => headers.map((header) => csvCell(row[header] ?? "")).join(",")),
  ].join("\n");
}

describe("parseBbrCsv", () => {
  it("parses the BBR contract without losing quoted descriptions or private raw fields", () => {
    const [row] = parseBbrCsv(`\uFEFF${makeCsv([validRow()])}`);

    expect(row.source_row_number).toBe(2);
    expect(row.match_status).toBe("unmatched");
    expect(row.parent_sku).toBe("20098007342");
    expect(row.format_code).toBe("06-00750");
    expect(row.description).toBe("Château Pontet-Canet, Pauillac, Bordeaux");
    expect(row.quantity_bottles).toBe(6);
    expect(row.purchase_price_per_case_p).toBe(45_000);
    expect(row.livex_market_price_p).toBe(81_600);
    expect(row.alcohol_percent).toBe(13.5);
    expect(row.raw_row["Account Payer"]).toBe("Private owner");
    expect(row.validation_errors).toEqual([]);
  });

  it("retains unknown future columns in the immutable raw row", () => {
    const headers = [...BBR_HEADERS, "Future BBR Field"];
    const [row] = parseBbrCsv(makeCsv([
      validRow({ "Future BBR Field": "retained" }),
    ], headers));

    expect(row.raw_row["Future BBR Field"]).toBe("retained");
  });

  it("accepts non-vintage wine and non-standard bottle labels when format dimensions are valid", () => {
    const [row] = parseBbrCsv(makeCsv([
      validRow({
        Vintage: "N.V.",
        "Bottle Format": "Magnum",
        "Bottle Volume": "1.5 l",
        "Case Size": "3",
      }),
    ]));

    expect(row.vintage).toBeNull();
    expect(row.format_code).toBe("03-01500");
    expect(row.validation_errors).toEqual([]);
  });

  it("rejects a file whose required contract headers are missing", () => {
    const headers = BBR_HEADERS.filter((header) => header !== "Parent ID");

    expect(() => parseBbrCsv(makeCsv([validRow()], headers))).toThrowError(
      new BbrFileError("The BBR CSV is missing required header(s): Parent ID."),
    );
  });

  it("marks row validation failures without discarding the raw evidence", () => {
    const [row] = parseBbrCsv(makeCsv([
      validRow({
        "Purchase Price per Case": "not money",
        "Drinking Window (From)": "2040",
        "Drinking Window (To)": "2030",
      }),
    ]));

    expect(row.match_status).toBe("invalid");
    expect(row.validation_errors).toContain(
      "Purchase Price per Case must be a non-negative GBP amount with at most two decimals.",
    );
    expect(row.validation_errors).toContain(
      "Drinking Window (From) cannot be later than Drinking Window (To).",
    );
    expect(row.raw_row["Purchase Price per Case"]).toBe("not money");
  });

  it("marks a repeated product and format as invalid", () => {
    const rows = parseBbrCsv(makeCsv([validRow(), validRow()]));

    expect(rows[0].match_status).toBe("unmatched");
    expect(rows[1].match_status).toBe("invalid");
    expect(rows[1].validation_errors).toContain(
      "This product and format duplicate source row 2.",
    );
  });
});

describe("matchBbrRows", () => {
  it("requires the exact product and format pair", () => {
    const parsed = parseBbrCsv(makeCsv([validRow()]));

    const matched = matchBbrRows(parsed, [{
      parent_sku: "20098007342",
      format_code: "06-00750",
      case_size: 6,
      bottle_volume_ml: 750,
    }]);
    expect(matched[0].match_status).toBe("matched");

    const wrongFormat = matchBbrRows(parsed, [{
      parent_sku: "20098007342",
      format_code: "12-00750",
      case_size: 12,
      bottle_volume_ml: 750,
    }]);
    expect(wrongFormat[0].match_status).toBe("unmatched");
    expect(wrongFormat[0].validation_warnings).toContain(
      "Parent ID exists, but format 06-00750 is not in the catalogue.",
    );
  });
});
