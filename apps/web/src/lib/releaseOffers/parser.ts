import { createHash } from "node:crypto";
import { parse } from "csv-parse/sync";

export const RELEASE_OFFER_PARSER_VERSION = "release-offers-v2";
export const RELEASE_OFFER_MAX_FILE_BYTES = 4 * 1024 * 1024;
export const RELEASE_OFFER_MAX_ROWS = 10_000;

export const RELEASE_OFFER_HEADERS = [
  "Date",
  "Wine",
  "Case Price",
  "JSON_Data",
] as const;

export const RELEASE_OFFER_HEADERS_WITH_PARENT_SKU = [
  "Date",
  "Wine",
  "Case Price",
  "JSON_Data",
  "parent_sku",
  "BBR_URL",
] as const;

type RawRow = Record<string, string>;

type SourceJson = {
  date?: unknown;
  wine?: unknown;
  description?: unknown;
  tasting_notes?: unknown;
  source_message_id?: unknown;
  source_product_url?: unknown;
  source_product_id?: unknown;
};

export type ReleaseOfferPrice = {
  fragment_index: number;
  raw_price_text: string;
  amount_p: number | null;
  currency: "GBP";
  case_size: number | null;
  bottle_volume_ml: number | null;
  format_code: string | null;
  tax_basis: "in_bond" | "duty_paid" | "unknown";
  parse_status: "valid" | "unresolved";
  price_fingerprint: string;
  validation_warnings: string[];
};

export type ParsedReleaseOfferRow = {
  source_row_number: number;
  raw_row: RawRow;
  offer_date: string;
  source_wine: string;
  source_vintage: number | null;
  source_match_key: string;
  source_price_text: string;
  description: string | null;
  tasting_notes: string | null;
  source_message_id: string | null;
  source_product_url: string | null;
  source_product_id: string | null;
  content_fingerprint: string;
  validation_errors: string[];
  validation_warnings: string[];
  prices: ReleaseOfferPrice[];
};

export class ReleaseOfferFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReleaseOfferFileError";
  }
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function nullableText(value: unknown): string | null {
  const valueText = text(value);
  return valueText || null;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function parseDate(value: string): string | null {
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  const [, day, month, year] = match;
  const result = `${year}-${month}-${day}`;
  const parsed = new Date(`${result}T00:00:00Z`);
  return Number.isNaN(parsed.valueOf())
    || parsed.getUTCFullYear() !== Number(year)
    || parsed.getUTCMonth() + 1 !== Number(month)
    || parsed.getUTCDate() !== Number(day)
    ? null
    : result;
}

export function releaseWineMatchKey(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replaceAll("æ", "a")
    .replaceAll("œ", "o")
    .replace(/(^|\D)(?:18|19|20)\d{2}(?=\D|$)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function numberWord(value: string | undefined): number | null {
  if (!value) return null;
  const compact = value.toLowerCase().replace(/[^a-z0-9]/g, "");
  const words: Record<string, number> = {
    single: 1,
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    six: 6,
    dozen: 12,
    twelve: 12,
    twentyfour: 24,
  };
  if (compact in words) return words[compact];
  return /^\d+$/.test(compact) ? Number(compact) : null;
}

function priceFragments(value: string): string[] {
  const starts = [...value.matchAll(/£\s*[\d,]+(?:\.\d{1,2})?/g)]
    .map((match) => match.index ?? 0);
  return starts.map((start, index) => {
    const end = starts[index + 1] ?? value.length;
    return value
      .slice(start, end)
      .replace(/^[\s;/]+|[\s;/]+$/g, "")
      .trim();
  });
}

function inferFormat(fragment: string): {
  caseSize: number | null;
  bottleVolumeMl: number | null;
} {
  const lower = fragment.toLowerCase();
  let bottleVolumeMl = 750;
  if (/half[ -]?bottles?|37\.5\s*cl|375\s*ml/.test(lower)) bottleVolumeMl = 375;
  else if (/salmanazar|9\s*l(?:itre)?\b|900\s*cl/.test(lower)) bottleVolumeMl = 9000;
  else if (/imperial|methuselah|6\s*l(?:itre)?\b|600\s*cl/.test(lower)) bottleVolumeMl = 6000;
  else if (/double[ -]?magnum|3\s*l(?:itre)?\b|300\s*cl/.test(lower)) bottleVolumeMl = 3000;
  else if (/\bmagnums?\b|1\.5\s*l(?:itre)?\b|150\s*cl/.test(lower)) bottleVolumeMl = 1500;
  else if (/jeroboam/.test(lower)) return { caseSize: null, bottleVolumeMl: null };

  const quantityPattern = "(single|one|two|three|four|six|twelve|dozen|twenty[- ]four|\\d+)";
  const explicit = lower.match(new RegExp(
    `\\bper\\s+(?:case\\s*(?:of\\s*)?|case\\s*\\(\\s*)?${quantityPattern}\\s*\\)?[- ]*(?:half[- ]?)?(?:bottles?|bts?|magnums?)?\\b`,
  ));
  let caseSize = numberWord(explicit?.[1]);

  if (caseSize === null) {
    const nounQuantity = lower.match(new RegExp(
      `\\bper\\s+${quantityPattern}[- ]+(?:half[- ]?)?(?:bottles?|bts?|magnums?)\\b`,
    ));
    caseSize = numberWord(nounQuantity?.[1]);
  }
  if (caseSize === null && /\bper\s+(?:(?:single|one)\s+)?(?:bottle|magnum|double[ -]?magnum|imperial|methuselah|salmanazar)\b/.test(lower)) {
    caseSize = 1;
  }
  if (caseSize === null) {
    const bareQuantity = lower.match(/\bper\s+(6|12)\s+(?:in|under)\s+bond\b/);
    caseSize = bareQuantity ? Number(bareQuantity[1]) : null;
  }

  return { caseSize, bottleVolumeMl: caseSize === null ? null : bottleVolumeMl };
}

function formatCode(caseSize: number | null, bottleVolumeMl: number | null): string | null {
  if (caseSize === null || bottleVolumeMl === null) return null;
  return `${String(caseSize).padStart(2, "0")}-${String(bottleVolumeMl).padStart(5, "0")}`;
}

function parsePrice(fragment: string, index: number, rowFingerprint: string): ReleaseOfferPrice {
  const warnings: string[] = [];
  const money = fragment.match(/£\s*([\d,]+(?:\.\d{1,2})?)/);
  const amountP = money
    ? Math.round(Number(money[1].replaceAll(",", "")) * 100)
    : null;
  const { caseSize, bottleVolumeMl } = inferFormat(fragment);
  const lower = fragment.toLowerCase();
  const taxBasis = /\b(?:in|under)\s+bond\b|\bib\b/.test(lower)
    ? "in_bond"
    : /duty\s+paid|(?:vat|duty).*(?:included|paid)|delivered/.test(lower)
      ? "duty_paid"
      : "unknown";

  if (amountP === null || amountP <= 0) warnings.push("No valid GBP amount was found.");
  if (caseSize === null || bottleVolumeMl === null) {
    warnings.push("The case size and bottle format could not be resolved exactly.");
  }
  if (taxBasis === "unknown") warnings.push("The tax basis is not explicit.");

  const code = formatCode(caseSize, bottleVolumeMl);
  const parseStatus = amountP !== null && amountP > 0 && code !== null
    ? "valid"
    : "unresolved";
  return {
    fragment_index: index,
    raw_price_text: fragment.slice(0, 1000),
    amount_p: amountP,
    currency: "GBP",
    case_size: caseSize,
    bottle_volume_ml: bottleVolumeMl,
    format_code: code,
    tax_basis: taxBasis,
    parse_status: parseStatus,
    price_fingerprint: sha256(`${rowFingerprint}\u001f${index}\u001f${fragment}`),
    validation_warnings: warnings,
  };
}

function directBbrProductLink(values: Array<string | null>): {
  url: string | null;
  productId: string | null;
} {
  for (const value of values) {
    if (!value) continue;
    const urls = value.match(/https?:\/\/[^\s<>()"']+/gi) ?? [];
    for (const rawUrl of urls) {
      try {
        const url = new URL(rawUrl.replace(/[.,;:]+$/, ""));
        if (!/(^|\.)bbr\.com$/i.test(url.hostname)) continue;
        if (!/\/products?-/i.test(url.pathname)) continue;
        const productId = url.pathname.match(/\/products?-([0-9]{5,30})(?:\b|[-/])/i)?.[1] ?? null;
        return { url: url.toString(), productId };
      } catch {
        // Malformed source links remain in raw evidence.
      }
    }
  }
  return { url: null, productId: null };
}

function parseBbrUrlColumn(value: string | null): {
  url: string | null;
  productId: string | null;
} {
  if (!value) return { url: null, productId: null };
  try {
    const url = new URL(value.replace(/[.,;:]+$/, ""));
    if (!/^https?:$/i.test(url.protocol)) return { url: null, productId: null };
    if (!/(^|\.)bbr\.com$/i.test(url.hostname)) return { url: null, productId: null };
    const productId = url.pathname.match(/\/products?-([0-9]{5,30})(?:\b|[-/])/i)?.[1] ?? null;
    return { url: url.toString(), productId };
  } catch {
    return { url: null, productId: null };
  }
}

function parseRow(raw: RawRow, sourceRowNumber: number): ParsedReleaseOfferRow {
  const errors: string[] = [];
  const warnings: string[] = [];
  const dateText = text(raw.Date);
  const wine = text(raw.Wine);
  const sourcePriceText = text(raw["Case Price"]);
  const offerDate = parseDate(dateText);
  const sourceVintageMatch = wine.match(/(?:^|\D)((?:18|19|20)\d{2})(?=\D|$)/);
  const sourceVintage = sourceVintageMatch ? Number(sourceVintageMatch[1]) : null;
  if (!offerDate) errors.push("Date must use DD/MM/YYYY and be a real date.");
  if (!wine) errors.push("Wine is required.");
  if (!sourcePriceText) errors.push("Case Price is required.");

  let sourceJson: SourceJson = {};
  try {
    const parsed = JSON.parse(text(raw.JSON_Data));
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
      errors.push("JSON_Data must be a JSON object.");
    } else {
      sourceJson = parsed as SourceJson;
    }
  } catch {
    errors.push("JSON_Data is not valid JSON.");
  }

  const description = nullableText(sourceJson.description);
  const tastingNotes = nullableText(sourceJson.tasting_notes);
  if (text(sourceJson.wine) && text(sourceJson.wine) !== wine) {
    warnings.push("JSON_Data wine differs from the Wine column.");
  }
  if (text(sourceJson.date) && offerDate && text(sourceJson.date) !== offerDate) {
    warnings.push("JSON_Data date differs from the Date column.");
  }

  const explicitUrl = nullableText(sourceJson.source_product_url);
  const directLink = directBbrProductLink([explicitUrl, description, tastingNotes]);
  const csvBbrUrlText = nullableText(raw.BBR_URL);
  const csvBbrUrl = parseBbrUrlColumn(csvBbrUrlText);
  if (csvBbrUrlText && !csvBbrUrl.url) {
    warnings.push("BBR_URL is not a valid bbr.com product link.");
  }

  // Precedence for the tier-1 direct match key: CSV parent_sku, then
  // JSON_Data.source_product_id, then a resolved bbr.com link (the CSV
  // BBR_URL column first, falling back to a link scraped from JSON_Data).
  const csvParentSku = nullableText(raw.parent_sku);
  let sourceProductId: string | null = null;
  if (csvParentSku) {
    if (/^\d{5,30}$/.test(csvParentSku)) {
      sourceProductId = csvParentSku;
    } else {
      warnings.push("The parent_sku column is not a supported numeric BBR Parent ID.");
    }
  }
  if (!sourceProductId) {
    const jsonProductId = nullableText(sourceJson.source_product_id);
    if (jsonProductId) {
      if (/^\d{5,30}$/.test(jsonProductId)) {
        sourceProductId = jsonProductId;
      } else {
        warnings.push("The source product ID is not a supported numeric BBR Parent ID.");
      }
    }
  }
  if (!sourceProductId) sourceProductId = csvBbrUrl.productId ?? directLink.productId;
  const sourceProductUrl = csvBbrUrl.url ?? directLink.url;

  const fingerprint = sha256([
    offerDate ?? dateText,
    wine,
    sourcePriceText,
    description ?? "",
    tastingNotes ?? "",
    nullableText(sourceJson.source_message_id) ?? "",
  ].join("\u001f"));
  const fragments = priceFragments(sourcePriceText);
  if (fragments.length === 0 && sourcePriceText) {
    warnings.push("No GBP price fragment was found.");
  }

  return {
    source_row_number: sourceRowNumber,
    raw_row: raw,
    offer_date: offerDate ?? "1970-01-01",
    source_wine: wine || "Invalid source row",
    source_vintage: sourceVintage,
    source_match_key: releaseWineMatchKey(wine) || "invalid-source-row",
    source_price_text: sourcePriceText || "Missing",
    description,
    tasting_notes: tastingNotes,
    source_message_id: nullableText(sourceJson.source_message_id),
    source_product_url: sourceProductUrl,
    source_product_id: sourceProductId,
    content_fingerprint: fingerprint,
    validation_errors: errors,
    validation_warnings: warnings,
    prices: fragments.map((fragment, index) => parsePrice(fragment, index + 1, fingerprint)),
  };
}

export function parseReleaseOfferCsv(csvText: string): ParsedReleaseOfferRow[] {
  let records: RawRow[];
  try {
    records = parse(csvText, {
      bom: true,
      columns: (headers: string[]) => {
        const isLegacy = JSON.stringify(headers) === JSON.stringify(RELEASE_OFFER_HEADERS);
        const isCurrent = JSON.stringify(headers) === JSON.stringify(RELEASE_OFFER_HEADERS_WITH_PARENT_SKU);
        if (!isLegacy && !isCurrent) {
          throw new ReleaseOfferFileError(
            `Unexpected headers. Expected: ${RELEASE_OFFER_HEADERS.join(", ")} `
              + `or ${RELEASE_OFFER_HEADERS_WITH_PARENT_SKU.join(", ")}.`,
          );
        }
        return headers;
      },
      skip_empty_lines: true,
      relax_quotes: false,
    });
  } catch (error) {
    if (error instanceof ReleaseOfferFileError) throw error;
    throw new ReleaseOfferFileError("The release-offer CSV is not valid CSV.");
  }

  if (records.length === 0) throw new ReleaseOfferFileError("The CSV has no data rows.");
  if (records.length > RELEASE_OFFER_MAX_ROWS) {
    throw new ReleaseOfferFileError(`The CSV exceeds ${RELEASE_OFFER_MAX_ROWS.toLocaleString()} rows.`);
  }
  return records.map((record, index) => parseRow(record, index + 2));
}
