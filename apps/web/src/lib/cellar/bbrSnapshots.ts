// BBR holdings history, slice 6: snapshot dating and the current-preview diff.
//
// Plan: docs/BBR-HOLDINGS-HISTORY-IMPLEMENTATION-PLAN.md, slice 6. Functional
// spec sections 4.1 and 4.4 (BBRH-01, BBRH-03).

/**
 * Suggests an ISO effective date from a BBR export filename such as
 * `my-cellar-view-2026-07-23.csv`. Returns null rather than guessing: a
 * filename with no date-shaped substring, more than one candidate, or a
 * substring that is not a real calendar date is left for the owner to state
 * outright. This is a suggestion only -- the owner always confirms the date
 * before it is used (spec 4.1, BBRH-01).
 */
export function suggestEffectiveDate(filename: string): string | null {
  const matches = filename.match(/\d{4}-\d{2}-\d{2}/g);
  if (!matches || matches.length !== 1) return null;

  const [candidate] = matches;
  return isRealCalendarDate(candidate) ? candidate : null;
}

function isRealCalendarDate(iso: string): boolean {
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) return false;

  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
  );
}

/**
 * The position-grain shape both sides of a current-preview diff are read as.
 * `bbr_holding_evidence` supplies this for any import, current or proposed,
 * so the current side is read from the nominated import's evidence rather
 * than `current_bbr_holdings` (which does not carry `catalogue_matched`).
 */
export type SnapshotPositionRow = {
  parent_sku: string;
  format_code: string;
  description: string;
  vintage: number | null;
  quantity_bottles: number;
  purchase_price_per_case_p: number | null;
  catalogue_matched: boolean;
};

export type PositionIdentity = {
  parent_sku: string;
  format_code: string;
  description: string;
  vintage: number | null;
};

export type QuantityChange = PositionIdentity & {
  fromQuantityBottles: number;
  toQuantityBottles: number;
};

export type ReportedPriceChange = PositionIdentity & {
  fromPurchasePricePerCaseP: number | null;
  toPurchasePricePerCaseP: number | null;
};

/**
 * Identity-level comparison between the nominated current snapshot and a
 * proposed one, at (parent_sku, format_code) grain. Spec 4.4 is explicit that
 * counts alone are insufficient -- the owner must be able to identify every
 * position that will cease to be current -- so every list here names the
 * positions involved, not just how many there are.
 */
export type CurrentSnapshotDiff = {
  /** Positions the proposed snapshot introduces that the current one lacks. */
  newCurrent: PositionIdentity[];
  /** Current positions the proposed snapshot omits; these become former. */
  becomingFormer: PositionIdentity[];
  /** Positions held in both snapshots whose bottle quantity differs. */
  quantityChanges: QuantityChange[];
  /** Positions held in both snapshots whose reported purchase price differs. */
  reportedPriceChanges: ReportedPriceChange[];
  /** Proposed-snapshot rows the local catalogue could not decorate. */
  undecorated: PositionIdentity[];
};

function positionKey(row: { parent_sku: string; format_code: string }): string {
  return `${row.parent_sku}|${row.format_code}`;
}

function identityOf(row: SnapshotPositionRow): PositionIdentity {
  return {
    parent_sku: row.parent_sku,
    format_code: row.format_code,
    description: row.description,
    vintage: row.vintage,
  };
}

export function diffCurrentSnapshot(
  current: SnapshotPositionRow[],
  proposed: SnapshotPositionRow[],
): CurrentSnapshotDiff {
  const currentByKey = new Map(current.map((row) => [positionKey(row), row]));
  const proposedByKey = new Map(proposed.map((row) => [positionKey(row), row]));

  const newCurrent: PositionIdentity[] = [];
  const quantityChanges: QuantityChange[] = [];
  const reportedPriceChanges: ReportedPriceChange[] = [];
  const undecorated: PositionIdentity[] = [];

  for (const [key, proposedRow] of proposedByKey) {
    const currentRow = currentByKey.get(key);
    if (!currentRow) {
      newCurrent.push(identityOf(proposedRow));
    } else {
      if (currentRow.quantity_bottles !== proposedRow.quantity_bottles) {
        quantityChanges.push({
          ...identityOf(proposedRow),
          fromQuantityBottles: currentRow.quantity_bottles,
          toQuantityBottles: proposedRow.quantity_bottles,
        });
      }
      if (currentRow.purchase_price_per_case_p !== proposedRow.purchase_price_per_case_p) {
        reportedPriceChanges.push({
          ...identityOf(proposedRow),
          fromPurchasePricePerCaseP: currentRow.purchase_price_per_case_p,
          toPurchasePricePerCaseP: proposedRow.purchase_price_per_case_p,
        });
      }
    }

    if (!proposedRow.catalogue_matched) {
      undecorated.push(identityOf(proposedRow));
    }
  }

  const becomingFormer: PositionIdentity[] = [];
  for (const [key, currentRow] of currentByKey) {
    if (!proposedByKey.has(key)) {
      becomingFormer.push(identityOf(currentRow));
    }
  }

  return { newCurrent, becomingFormer, quantityChanges, reportedPriceChanges, undecorated };
}
