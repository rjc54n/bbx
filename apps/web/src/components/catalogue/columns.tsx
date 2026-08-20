import type { ReactNode } from "react";
import Link from "next/link";
import { FavouriteStar } from "@/components/favourites/FavouriteStar";
import { formatDate, formatFormat, formatPence } from "@/lib/format";
import { bbrProductUrl, wineSearcherUrl } from "@/lib/listingLinks";
import type { CatalogueMetricField, PriceChangeSortField } from "@/lib/query/registry";
import type { CatalogueRow, PriceChangeRow } from "@/lib/query/rows";
import { SignedPct } from "./SignedPct";

export interface Column<Row, SortField extends string> {
  id: string;
  label: string;
  align: "left" | "right";
  sortField?: SortField;
  render: (row: Row) => ReactNode;
}

// The format premium correction agrees with the raw guide on the vast
// majority of rows (anything at the 750ml reference format), so these two
// columns are hidden by default -- see the "Show format-adjusted values"
// toggle in CatalogueBrowser -- rather than earning permanent space next to
// Market / vs Market.
export const FORMAT_ADJUSTED_COLUMN_IDS = new Set(["adjusted_guide_p", "price_vs_adjusted_guide_pct"]);

export function withFormatAdjustedColumns<Row, SortField extends string>(
  columns: Column<Row, SortField>[],
  show: boolean,
): Column<Row, SortField>[] {
  return show ? columns : columns.filter((column) => !FORMAT_ADJUSTED_COLUMN_IDS.has(column.id));
}

function WineCell({
  name,
  vintage,
  producer,
  productUrl,
  parentSku,
}: {
  name: string | null;
  vintage: number | null;
  producer: string | null;
  productUrl: string | null;
  parentSku: string | null;
}) {
  const bbrUrl = bbrProductUrl(productUrl);
  const wineSearcher = wineSearcherUrl(name, vintage);

  // The name now opens the consolidated wine card; BBR and Wine-Searcher become
  // secondary out-links rather than the primary click.
  return (
    <div className="max-w-xs">
      <div className="font-medium text-ink">
        {parentSku ? (
          <Link href={`/wine/parent/${parentSku}`} className="hover:text-accent hover:underline">
            {name ?? "–"}
          </Link>
        ) : name ?? "–"}
      </div>
      <div className="text-xs text-ink-muted">{producer ?? "–"}</div>
      <div className="mt-0.5 flex gap-3">
        {bbrUrl && (
          <a href={bbrUrl} target="_blank" rel="noreferrer" className="text-xs text-accent hover:underline">
            BBR ↗
          </a>
        )}
        {wineSearcher && (
          <a href={wineSearcher} target="_blank" rel="noreferrer" className="text-xs text-accent hover:underline">
            Wine-Searcher ↗
          </a>
        )}
      </div>
    </div>
  );
}

/**
 * Appended rather than declared in the column arrays because the star needs the
 * favourite set, which is per-request state the module-level configs cannot see.
 * Not sortable: sorting happens in the database and a favourite is not a
 * catalogue column.
 */
export function favouriteColumn<
  Row extends { parent_sku: string | null; name: string | null },
  SortField extends string,
>(favourites: ReadonlySet<string>): Column<Row, SortField> {
  return {
    id: "favourite",
    label: "Favourite",
    align: "left",
    render: (row) => (row.parent_sku
      ? <FavouriteStar
        target={{ kind: "wine", parentSku: row.parent_sku }}
        favourite={favourites.has(row.parent_sku)}
        label={row.name ?? row.parent_sku}
      />
      : <span className="text-xs text-ink-muted">–</span>),
  };
}

function RegionCell({ region, colour }: { region: string | null; colour: string | null }) {
  return (
    <div>
      <div>{region ?? "–"}</div>
      <div className="text-xs text-ink-muted">{colour ?? "–"}</div>
    </div>
  );
}

// old_value_raw/new_value_raw are raw text snapshots of whatever price field
// changed (price_history_view, pence-as-text) -- format as currency when
// parseable, fall back to the raw text otherwise rather than hiding it.
function formatRawPriceValue(raw: string | null): string {
  if (raw === null) return "–";
  const n = Number(raw);
  return Number.isFinite(n) ? formatPence(n) : raw;
}

export const CATALOGUE_COLUMNS: Column<CatalogueRow, CatalogueMetricField>[] = [
  {
    id: "wine",
    label: "Wine",
    align: "left",
    render: (row) => <WineCell name={row.name} vintage={row.vintage} producer={row.producer} productUrl={row.product_url} parentSku={row.parent_sku} />,
  },
  {
    id: "region",
    label: "Region / Colour",
    align: "left",
    render: (row) => <RegionCell region={row.region} colour={row.colour} />,
  },
  {
    id: "format",
    label: "Format",
    align: "left",
    render: (row) => formatFormat(row.case_size, row.bottle_volume_ml),
  },
  {
    id: "ask",
    label: "Ask",
    align: "right",
    sortField: "ask",
    render: (row) => <span className="font-medium">{formatPence(row.ask)}</span>,
  },
  {
    id: "price_per_bottle_p",
    label: "Per bottle",
    align: "right",
    sortField: "price_per_bottle_p",
    render: (row) => formatPence(row.price_per_bottle_p),
  },
  {
    id: "highest_bid_p",
    label: "Bid",
    align: "right",
    sortField: "highest_bid_p",
    render: (row) => formatPence(row.highest_bid_p),
  },
  {
    id: "release_price_p",
    label: "Release price",
    align: "right",
    render: (row) =>
      row.release_price_p != null && row.anchor_status === "owner" ? (
        <span className="inline-flex items-center gap-1">
          {formatPence(row.release_price_p)}
          <span className="rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-medium leading-none text-accent-ink">owner</span>
        </span>
      ) : (
        formatPence(row.release_price_p)
      ),
  },
  {
    id: "market_price_p",
    label: "Market",
    align: "right",
    sortField: "market_price_p",
    render: (row) => formatPence(row.market_price_p),
  },
  {
    id: "price_vs_market_pct",
    label: "vs Market",
    align: "right",
    sortField: "price_vs_market_pct",
    render: (row) => <SignedPct value={row.price_vs_market_pct} />,
  },
  {
    id: "adjusted_guide_p",
    label: "Adj. guide",
    align: "right",
    sortField: "adjusted_guide_p",
    render: (row) => formatPence(row.adjusted_guide_p),
  },
  {
    id: "price_vs_adjusted_guide_pct",
    label: "vs Adj. guide",
    align: "right",
    sortField: "price_vs_adjusted_guide_pct",
    render: (row) => <SignedPct value={row.price_vs_adjusted_guide_pct} estimate />,
  },
  {
    id: "price_vs_last_pct",
    label: "vs Last tx",
    align: "right",
    sortField: "price_vs_last_pct",
    render: (row) => <SignedPct value={row.price_vs_last_pct} />,
  },
  {
    id: "price_vs_next_pct",
    label: "vs Next offer",
    align: "right",
    sortField: "price_vs_next_pct",
    render: (row) => <SignedPct value={row.price_vs_next_pct} estimate />,
  },
  {
    id: "qty_available",
    label: "Qty",
    align: "right",
    sortField: "qty_available",
    render: (row) => row.qty_available ?? "–",
  },
  {
    id: "first_seen_at",
    label: "First seen",
    align: "right",
    sortField: "first_seen_at",
    render: (row) => formatDate(row.first_seen_at),
  },
  {
    id: "last_seen_at",
    label: "Last seen",
    align: "right",
    sortField: "last_seen_at",
    render: (row) => formatDate(row.last_seen_at),
  },
];

export const PRICE_CHANGE_COLUMNS: Column<PriceChangeRow, PriceChangeSortField>[] = [
  {
    id: "wine",
    label: "Wine",
    align: "left",
    render: (row) => <WineCell name={row.name} vintage={row.vintage} producer={row.producer} productUrl={row.product_url} parentSku={row.parent_sku} />,
  },
  {
    id: "region",
    label: "Region / Colour",
    align: "left",
    render: (row) => <RegionCell region={row.region} colour={row.colour} />,
  },
  {
    id: "format",
    label: "Format",
    align: "left",
    render: (row) => formatFormat(row.case_size, row.bottle_volume_ml),
  },
  {
    id: "field_name",
    label: "Field changed",
    align: "left",
    render: (row) => row.field_name ?? "–",
  },
  {
    id: "old_value_raw",
    label: "Old value",
    align: "right",
    render: (row) => formatRawPriceValue(row.old_value_raw),
  },
  {
    id: "new_value_raw",
    label: "New value",
    align: "right",
    render: (row) => <span className="font-medium">{formatRawPriceValue(row.new_value_raw)}</span>,
  },
  {
    id: "observed_at",
    label: "Changed",
    align: "right",
    sortField: "observed_at",
    render: (row) => formatDate(row.observed_at),
  },
];
