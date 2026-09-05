import { parse } from "csv-parse/sync";

export const BBR_PARSER_VERSION = "bbr-v2";
export const BBR_MAX_FILE_BYTES = 4 * 1024 * 1024;
export const BBR_MAX_ROWS = 10_000;

// Present on every recovered export, from the 2025-05-21 file onward.
export const BBR_REQUIRED_HEADERS = [
  "Parent ID",
  "Product Code(s)",
  "Country",
  "Region",
  "Vintage",
  "Description",
  "Colour",
  "Maturity",
  "Bottle Format",
  "Bottle Volume",
  "Quantity in Bottles",
  "Eligible for Sale on BBX",
  "Purchase Price per Case",
  "Case Size",
  "Livex Market Price",
  "Wine Searcher Lowest List Price",
  "BBX Last Transaction Price",
  "BBX Lowest Price",
  "BBX Highest Bid",
  "Selling Case Quantity on BBX",
  "Selling Price on BBX",
  "Account Payer",
  "Beneficial Owner",
  "Current Status",
] as const;

// Added by BBR after 2025-05-21, or never populated. Parsed into typed
// columns and stored when present; left null on a file that omits them, so a
// file's absence of one of these columns no longer fails the whole import.
// See docs/IMPORT-SOURCE-PROFILES.md, "BBR recovered historical exports".
export const BBR_OPTIONAL_HEADERS = [
  "Drinking Window (From)",
  "Drinking Window (To)",
  "Alcohol Content",
  "Purchase date / warehouse goods in date",
] as const;

export const BBR_HEADERS = [
  ...BBR_REQUIRED_HEADERS,
  ...BBR_OPTIONAL_HEADERS,
] as const;

export type BbrRawRow = Record<string, string>;

export type BbrMatchStatus = "matched" | "unmatched" | "invalid";

export type ParsedBbrRow = {
  source_row_number: number;
  raw_row: BbrRawRow;
  match_status: BbrMatchStatus;
  validation_errors: string[];
  validation_warnings: string[];
  parent_sku: string | null;
  format_code: string | null;
  product_code: string | null;
  description: string | null;
  country: string | null;
  region: string | null;
  vintage: number | null;
  colour: string | null;
  maturity: string | null;
  drinking_window_from: number | null;
  drinking_window_to: number | null;
  bottle_volume_ml: number | null;
  quantity_bottles: number | null;
  eligible_for_bbx: boolean | null;
  purchase_price_per_case_p: number | null;
  case_size: number | null;
  livex_market_price_p: number | null;
  wine_searcher_lowest_list_price_p: number | null;
  bbx_last_transaction_price_p: number | null;
  bbx_lowest_price_p: number | null;
  bbx_highest_bid_p: number | null;
  current_status: string | null;
  alcohol_percent: number | null;
};

export type CatalogueFormat = {
  parent_sku: string | null;
  format_code: string | null;
  case_size: number | null;
  bottle_volume_ml: number | null;
};

export class BbrFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BbrFileError";
  }
}

function trimmed(value: unknown): string {
  return value === null || value === undefined ? "" : String(value).trim();
}

function nullableText(value: unknown): string | null {
  const result = trimmed(value);
  return result === "" ? null : result;
}

function requiredText(
  raw: BbrRawRow,
  field: string,
  errors: string[],
): string | null {
  const value = nullableText(raw[field]);
  if (value === null) errors.push(`${field} is required.`);
  return value;
}

function parseInteger(
  value: unknown,
  field: string,
  errors: string[],
  options: { required?: boolean; min?: number; max?: number } = {},
): number | null {
  const text = trimmed(value);
  if (text === "") {
    if (options.required) errors.push(`${field} is required.`);
    return null;
  }
  if (!/^-?\d+$/.test(text)) {
    errors.push(`${field} must be a whole number.`);
    return null;
  }
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed)) {
    errors.push(`${field} is outside the supported range.`);
    return null;
  }
  if (options.min !== undefined && parsed < options.min) {
    errors.push(`${field} must be at least ${options.min}.`);
    return null;
  }
  if (options.max !== undefined && parsed > options.max) {
    errors.push(`${field} must be at most ${options.max}.`);
    return null;
  }
  return parsed;
}

function parseMoneyPence(
  value: unknown,
  field: string,
  errors: string[],
  required = false,
): number | null {
  const text = trimmed(value);
  if (text === "") {
    if (required) errors.push(`${field} is required.`);
    return null;
  }
  const cleaned = text.replace(/^£/, "").replaceAll(",", "");
  // Excess decimal places (a floating-point artifact seen in older exports,
  // e.g. "109.97999999999999") are rounded rather than rejected, matching
  // cellartrackerParser.ts's price().
  if (!/^\d+(?:\.\d+)?$/.test(cleaned)) {
    errors.push(`${field} must be a non-negative GBP amount.`);
    return null;
  }
  const pence = Math.round(Number(cleaned) * 100);
  if (!Number.isSafeInteger(pence)) {
    errors.push(`${field} is outside the supported range.`);
    return null;
  }
  return pence;
}

function parseBottleVolumeMl(
  value: unknown,
  errors: string[],
): number | null {
  const text = trimmed(value).toLowerCase();
  if (text === "") {
    errors.push("Bottle Volume is required.");
    return null;
  }
  const match = text.match(/^(\d+(?:\.\d+)?)\s*(ml|cl|l)$/);
  if (!match) {
    errors.push("Bottle Volume must use ml, cl or l.");
    return null;
  }
  const amount = Number(match[1]);
  const multiplier = match[2] === "ml" ? 1 : match[2] === "cl" ? 10 : 1000;
  const millilitres = amount * multiplier;
  if (!Number.isInteger(millilitres) || millilitres <= 0 || millilitres > 99_999) {
    errors.push("Bottle Volume does not resolve to a supported whole number of ml.");
    return null;
  }
  return millilitres;
}

function parseEligibility(value: unknown, errors: string[]): boolean | null {
  const text = trimmed(value).toUpperCase();
  // Older BBR exports used Y/N; the current export spells it out as YES/NO.
  if (text === "YES" || text === "Y") return true;
  if (text === "NO" || text === "N") return false;
  errors.push("Eligible for Sale on BBX must be YES, NO, Y or N.");
  return null;
}

function parseVintage(value: unknown, errors: string[]): number | null {
  const text = trimmed(value);
  const normalised = text.toUpperCase().replace(/[^A-Z]/g, "");
  if (text === "" || normalised === "NV" || normalised === "NONVINTAGE") {
    return null;
  }
  return parseInteger(text, "Vintage", errors, {
    min: 1800,
    max: new Date().getUTCFullYear() + 3,
  });
}

function parseAlcoholPercent(value: unknown, errors: string[]): number | null {
  const text = trimmed(value);
  if (text === "") return null;
  const match = text.match(/^(\d+(?:\.\d{1,2})?)%$/);
  if (!match) {
    errors.push("Alcohol Content must be a percentage such as 13.5%.");
    return null;
  }
  const result = Number(match[1]);
  if (result < 0 || result > 100) {
    errors.push("Alcohol Content must be between 0% and 100%.");
    return null;
  }
  return result;
}

function formatCode(caseSize: number | null, bottleVolumeMl: number | null): string | null {
  if (caseSize === null || bottleVolumeMl === null) return null;
  return `${String(caseSize).padStart(2, "0")}-${String(bottleVolumeMl).padStart(5, "0")}`;
}

function parseSourceRow(raw: BbrRawRow, sourceRowNumber: number): ParsedBbrRow {
  const errors: string[] = [];
  const warnings: string[] = [];

  const parentSku = requiredText(raw, "Parent ID", errors);
  if (parentSku !== null && !/^\d{5,30}$/.test(parentSku)) {
    errors.push("Parent ID must contain 5 to 30 digits.");
  }

  const productCode = requiredText(raw, "Product Code(s)", errors);
  const description = requiredText(raw, "Description", errors);
  const vintage = parseVintage(raw.Vintage, errors);
  const drinkingWindowFrom = parseInteger(
    raw["Drinking Window (From)"],
    "Drinking Window (From)",
    errors,
    { min: 1800, max: 2300 },
  );
  const drinkingWindowTo = parseInteger(
    raw["Drinking Window (To)"],
    "Drinking Window (To)",
    errors,
    { min: 1800, max: 2300 },
  );
  if (
    drinkingWindowFrom !== null
    && drinkingWindowTo !== null
    && drinkingWindowFrom > drinkingWindowTo
  ) {
    errors.push("Drinking Window (From) cannot be later than Drinking Window (To).");
  }

  requiredText(raw, "Bottle Format", errors);

  const bottleVolumeMl = parseBottleVolumeMl(raw["Bottle Volume"], errors);
  const quantityBottles = parseInteger(
    raw["Quantity in Bottles"],
    "Quantity in Bottles",
    errors,
    { required: true, min: 1, max: 100_000 },
  );
  const caseSize = parseInteger(raw["Case Size"], "Case Size", errors, {
    required: true,
    min: 1,
    max: 99,
  });
  const eligibleForBbx = parseEligibility(raw["Eligible for Sale on BBX"], errors);

  return {
    source_row_number: sourceRowNumber,
    raw_row: raw,
    match_status: errors.length > 0 ? "invalid" : "unmatched",
    validation_errors: errors,
    validation_warnings: warnings,
    parent_sku: parentSku,
    format_code: formatCode(caseSize, bottleVolumeMl),
    product_code: productCode,
    description,
    country: nullableText(raw.Country),
    region: nullableText(raw.Region),
    vintage,
    colour: nullableText(raw.Colour),
    maturity: nullableText(raw.Maturity),
    drinking_window_from: drinkingWindowFrom,
    drinking_window_to: drinkingWindowTo,
    bottle_volume_ml: bottleVolumeMl,
    quantity_bottles: quantityBottles,
    eligible_for_bbx: eligibleForBbx,
    purchase_price_per_case_p: parseMoneyPence(
      raw["Purchase Price per Case"],
      "Purchase Price per Case",
      errors,
      true,
    ),
    case_size: caseSize,
    livex_market_price_p: parseMoneyPence(
      raw["Livex Market Price"],
      "Livex Market Price",
      errors,
    ),
    wine_searcher_lowest_list_price_p: parseMoneyPence(
      raw["Wine Searcher Lowest List Price"],
      "Wine Searcher Lowest List Price",
      errors,
    ),
    bbx_last_transaction_price_p: parseMoneyPence(
      raw["BBX Last Transaction Price"],
      "BBX Last Transaction Price",
      errors,
    ),
    bbx_lowest_price_p: parseMoneyPence(
      raw["BBX Lowest Price"],
      "BBX Lowest Price",
      errors,
    ),
    bbx_highest_bid_p: parseMoneyPence(
      raw["BBX Highest Bid"],
      "BBX Highest Bid",
      errors,
    ),
    current_status: nullableText(raw["Current Status"]),
    alcohol_percent: parseAlcoholPercent(raw["Alcohol Content"], errors),
  };
}

export type BbrParsedRows = ParsedBbrRow[] & {
  /**
   * Trailing rows dropped because their column count didn't match the
   * header (e.g. BBR's end-of-file terms disclaimer on older exports). A
   * short/ragged row anywhere else in the file is left in place and fails
   * its own required-field validation as before.
   */
  droppedTrailingRowCount: number;
};

export function parseBbrCsv(csvText: string): BbrParsedRows {
  let records: string[][];
  try {
    records = parse(csvText, {
      bom: true,
      columns: false,
      skip_empty_lines: true,
      relax_column_count: true,
    }) as string[][];
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown CSV error";
    throw new BbrFileError(`The BBR CSV could not be parsed: ${message}`);
  }

  if (records.length < 2) {
    throw new BbrFileError("The BBR CSV must contain a header and at least one data row.");
  }

  const headers = records[0].map((header, index) =>
    index === 0 ? trimmed(header).replace(/^\uFEFF/, "") : trimmed(header),
  );
  const duplicateHeaders = headers.filter(
    (header, index) => headers.indexOf(header) !== index,
  );
  if (duplicateHeaders.length > 0) {
    throw new BbrFileError(
      `The BBR CSV has duplicate header(s): ${[...new Set(duplicateHeaders)].join(", ")}.`,
    );
  }

  const missingHeaders = BBR_REQUIRED_HEADERS.filter((header) => !headers.includes(header));
  if (missingHeaders.length > 0) {
    throw new BbrFileError(
      `The BBR CSV is missing required header(s): ${missingHeaders.join(", ")}.`,
    );
  }

  let dataRows = records.slice(1);
  let droppedTrailingRowCount = 0;
  while (
    dataRows.length > 0
    && dataRows[dataRows.length - 1].length !== headers.length
  ) {
    dataRows = dataRows.slice(0, -1);
    droppedTrailingRowCount += 1;
  }

  if (dataRows.length === 0) {
    throw new BbrFileError("The BBR CSV must contain a header and at least one data row.");
  }

  if (dataRows.length > BBR_MAX_ROWS) {
    throw new BbrFileError(`The BBR CSV exceeds the ${BBR_MAX_ROWS.toLocaleString()} row limit.`);
  }

  const result = dataRows.map((record, index) => {
    const raw = Object.fromEntries(headers.map((header, column) => [
      header,
      record[column] ?? "",
    ]));
    return parseSourceRow(raw, index + 2);
  });

  const seen = new Map<string, number>();
  for (const row of result) {
    if (row.parent_sku === null || row.format_code === null) continue;
    const key = `${row.parent_sku}|${row.format_code}`;
    const earlierRow = seen.get(key);
    if (earlierRow !== undefined) {
      row.validation_errors.push(
        `This product and format duplicate source row ${earlierRow}.`,
      );
      row.match_status = "invalid";
    } else {
      seen.set(key, row.source_row_number);
    }
  }

  for (const row of result) {
    if (row.validation_errors.length > 0) row.match_status = "invalid";
  }
  return Object.assign(result, { droppedTrailingRowCount });
}

export function matchBbrRows(
  rows: ParsedBbrRow[],
  catalogueFormats: CatalogueFormat[],
): ParsedBbrRow[] {
  const productIds = new Set(
    catalogueFormats
      .map((format) => format.parent_sku)
      .filter((value): value is string => value !== null),
  );
  const exactFormats = new Set(
    catalogueFormats
      .filter((format) => format.parent_sku !== null && format.format_code !== null)
      .map((format) => `${format.parent_sku}|${format.format_code}`),
  );

  return rows.map((row) => {
    if (row.validation_errors.length > 0) {
      return { ...row, match_status: "invalid" };
    }
    if (row.parent_sku === null || row.format_code === null) {
      return { ...row, match_status: "invalid" };
    }
    const exactKey = `${row.parent_sku}|${row.format_code}`;
    if (exactFormats.has(exactKey)) {
      return { ...row, match_status: "matched" };
    }
    const warning = productIds.has(row.parent_sku)
      ? `Parent ID exists, but format ${row.format_code} is not in the catalogue.`
      : "Parent ID is not in the catalogue.";
    return {
      ...row,
      match_status: "unmatched",
      validation_warnings: [...row.validation_warnings, warning],
    };
  });
}
