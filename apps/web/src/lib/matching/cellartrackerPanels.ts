// The CellarTracker evidence panel (Part A, §3.4): producer, region, holding
// quantities and the accepted-snapshot timestamp, grouped to the visible
// (source, match_group_key). The page fetches current_cellartracker_records
// ONCE for the whole visible page and groups client-side here — never a
// request per card.

export type CellarTrackerEvidenceRow = {
  match_group_key: string;
  quantity_home: number | null;
  quantity_bbr: number | null;
  total_quantity: number | null;
  accepted_at: string | null;
  producer: string | null;
  region: string | null;
};

export type CellarTrackerGroupPanel = {
  producer: string | null;
  region: string | null;
  quantityHome: number;
  quantityBbr: number;
  totalQuantity: number;
  acceptedAt: string | null;
};

export function groupCellarTrackerPanels(
  rows: readonly CellarTrackerEvidenceRow[],
): Map<string, CellarTrackerGroupPanel> {
  const panels = new Map<string, CellarTrackerGroupPanel>();
  for (const row of rows) {
    const panel = panels.get(row.match_group_key) ?? {
      producer: row.producer,
      region: row.region,
      quantityHome: 0,
      quantityBbr: 0,
      totalQuantity: 0,
      acceptedAt: row.accepted_at,
    };
    panel.quantityHome += row.quantity_home ?? 0;
    panel.quantityBbr += row.quantity_bbr ?? 0;
    panel.totalQuantity += row.total_quantity ?? 0;
    panel.producer = panel.producer ?? row.producer;
    panel.region = panel.region ?? row.region;
    // Every row in the current snapshot carries the same accepted_at; keep the
    // latest defensively in case a fixture or a mid-import read disagrees.
    if (row.accepted_at && (!panel.acceptedAt || row.accepted_at > panel.acceptedAt)) {
      panel.acceptedAt = row.accepted_at;
    }
    panels.set(row.match_group_key, panel);
  }
  return panels;
}

/**
 * Load the panels for one visible page of match groups in a single query.
 * `fetchRows` is the only database touch; the test asserts it is called once
 * with every group key, regardless of card count.
 */
export async function loadCellarTrackerPanels(
  fetchRows: (groupKeys: readonly string[]) => Promise<readonly CellarTrackerEvidenceRow[]>,
  groupKeys: readonly string[],
): Promise<Map<string, CellarTrackerGroupPanel>> {
  if (groupKeys.length === 0) return new Map();
  return groupCellarTrackerPanels(await fetchRows(groupKeys));
}
