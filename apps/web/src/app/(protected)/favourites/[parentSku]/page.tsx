import Link from "next/link";
import { notFound } from "next/navigation";
import { FavouriteStar } from "@/components/favourites/FavouriteStar";
import { requireOwner } from "@/lib/auth/owner";
import { isTargetFavourited } from "@/lib/favourites/server";
import { perBottleP } from "@/lib/favourites/browser";
import { formatDate, formatDateTime, formatFormat, formatPence, formatSignedPct } from "@/lib/format";

export const dynamic = "force-dynamic";

type CatalogueFormat = {
  parent_sku: string;
  format_code: string | null;
  name: string | null;
  vintage: number | null;
  producer: string | null;
  country: string | null;
  region: string | null;
  subregion: string | null;
  colour: string | null;
  product_url: string | null;
  case_size: number | null;
  bottle_volume_ml: number | null;
  ask: number | null;
  highest_bid_p: number | null;
  market_price_p: number | null;
  adjusted_guide_p: number | null;
  is_listed: boolean | null;
  last_rest_checked_at: string | null;
};

type AnchorRow = {
  format_code: string | null;
  anchor_status: string | null;
  offer_date: string | null;
  release_price_p: number | null;
  case_size: number | null;
  bottle_volume_ml: number | null;
  ask_vs_release_pct: number | null;
  bid_vs_release_pct: number | null;
};

type ReleaseRecord = {
  import_id: string;
  source_row_number: number;
  offer_date: string | null;
  source_wine: string | null;
  format_code: string | null;
  release_price_p: number | null;
  case_size: number | null;
  bottle_volume_ml: number | null;
  match_method: string | null;
  source_product_url: string | null;
};

type CellarTrackerRecord = {
  import_id: string;
  source_row_number: number;
  source_wine: string;
  vintage: number | null;
  producer: string | null;
  quantity_home: number;
  quantity_bbr: number;
  fully_consumed: boolean;
  purchase_price_per_bottle_p: number | null;
  begin_consume: number | null;
  end_consume: number | null;
  match_method: string | null;
};

type BbrHolding = {
  import_id: string;
  source_row_number: number;
  description: string | null;
  format_code: string | null;
  case_size: number | null;
  bottle_volume_ml: number | null;
  quantity_bottles: number;
  purchase_price_per_case_p: number | null;
  current_status: string | null;
  eligible_for_bbx: boolean | null;
};

type Suggestion = { name: string | null; vintage: number | null; producer: string | null; region: string | null };

function methodLabel(value: string | null): string {
  const labels: Record<string, string> = {
    local_exact: "local exact match",
    algolia_exact: "Algolia exact match",
    algolia_confirmed: "Algolia confirmed",
    exact_name_vintage: "exact name and vintage",
    direct: "supplied product ID",
    manual: "manual Parent ID",
  };
  return value ? labels[value] ?? value.replaceAll("_", " ") : "unknown method";
}

function Card({ title, children, note }: { title: string; children: React.ReactNode; note?: string }) {
  return <section className="rounded-lg border border-border bg-background p-5">
    <h2 className="text-lg font-semibold">{title}</h2>
    {note && <p className="mt-1 max-w-3xl text-sm text-ink-muted">{note}</p>}
    {children}
  </section>;
}

export default async function FavouriteWinePage({ params }: {
  params: Promise<{ parentSku: string }>;
}) {
  const { parentSku } = await params;
  if (!/^\d{5,30}$/.test(parentSku)) notFound();
  const owner = await requireOwner();
  const { supabase } = owner;

  const [catalogue, anchors, releases, cellartracker, holdings, suggestion, favourited] = await Promise.all([
    supabase.from("catalogue_view")
      .select("parent_sku,format_code,name,vintage,producer,country,region,subregion,colour,product_url,case_size,bottle_volume_ml,ask,highest_bid_p,market_price_p,adjusted_guide_p,is_listed,last_rest_checked_at")
      .eq("parent_sku", parentSku).order("bottle_volume_ml").order("case_size"),
    supabase.from("release_price_market_view")
      .select("format_code,anchor_status,offer_date,release_price_p,case_size,bottle_volume_ml,ask_vs_release_pct,bid_vs_release_pct")
      .eq("parent_sku", parentSku),
    supabase.from("release_offer_evidence_view")
      .select("import_id,source_row_number,offer_date,source_wine,format_code,release_price_p,case_size,bottle_volume_ml,match_method,source_product_url")
      .eq("parent_sku", parentSku).order("offer_date", { ascending: false }),
    supabase.from("current_cellartracker_records")
      .select("import_id,source_row_number,source_wine,vintage,producer,quantity_home,quantity_bbr,fully_consumed,purchase_price_per_bottle_p,begin_consume,end_consume,match_method")
      .eq("parent_sku", parentSku).order("source_wine"),
    supabase.from("current_bbr_holdings")
      .select("import_id,source_row_number,description,format_code,case_size,bottle_volume_ml,quantity_bottles,purchase_price_per_case_p,current_status,eligible_for_bbx")
      .eq("parent_sku", parentSku).order("format_code"),
    // Identity of last resort: release offers match against BBR's wider
    // prod_product catalogue, so a favourited Parent ID need not be in the
    // tracked book at all.
    supabase.from("release_offer_match_suggestion_view")
      .select("name,vintage,producer,region").eq("parent_sku", parentSku).limit(1).maybeSingle(),
    isTargetFavourited(owner, { kind: "wine", parentSku }),
  ]);

  for (const [what, result] of [
    ["Catalogue formats", catalogue], ["Release anchors", anchors], ["Release history", releases],
    ["CellarTracker records", cellartracker], ["BBR holdings", holdings],
  ] as const) {
    if (result.error) throw new Error(`${what} could not be loaded: ${result.error.message} (${result.error.code})`);
  }

  const formats = (catalogue.data ?? []) as CatalogueFormat[];
  const anchorRows = (anchors.data ?? []) as AnchorRow[];
  const releaseRecords = (releases.data ?? []) as ReleaseRecord[];
  const cellarRecords = (cellartracker.data ?? []) as CellarTrackerRecord[];
  const bbrHoldings = (holdings.data ?? []) as BbrHolding[];
  const fallback = (suggestion.data ?? null) as Suggestion | null;

  const known = formats.length > 0 || releaseRecords.length > 0
    || cellarRecords.length > 0 || bbrHoldings.length > 0 || fallback !== null;
  if (!known) notFound();

  const identity = {
    name: formats[0]?.name ?? cellarRecords[0]?.source_wine ?? fallback?.name
      ?? releaseRecords[0]?.source_wine ?? bbrHoldings[0]?.description ?? parentSku,
    vintage: formats[0]?.vintage ?? cellarRecords[0]?.vintage ?? fallback?.vintage ?? null,
    producer: formats[0]?.producer ?? cellarRecords[0]?.producer ?? fallback?.producer ?? null,
    place: [formats[0]?.country, formats[0]?.region ?? fallback?.region, formats[0]?.subregion]
      .filter(Boolean).join(" · "),
    colour: formats[0]?.colour ?? null,
    productUrl: formats[0]?.product_url ?? releaseRecords[0]?.source_product_url ?? null,
  };
  const anchorByFormat = new Map(anchorRows.map((row) => [row.format_code, row]));

  return <main className="min-h-0 flex-1 overflow-auto bg-accent-soft">
    <div className="mx-auto max-w-6xl space-y-5 p-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-accent">Favourite wine</p>
          <h1 className="mt-1 text-2xl font-semibold">{identity.name}</h1>
          <p className="mt-1 text-sm text-ink-muted">
            {identity.vintage ?? "Vintage unavailable"} · {identity.producer ?? "Producer unavailable"} · Parent {parentSku}
            {identity.place && ` · ${identity.place}`}{identity.colour && ` · ${identity.colour}`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <FavouriteStar target={{ kind: "wine", parentSku }} favourite={favourited} label={identity.name} />
          {identity.productUrl && <a href={identity.productUrl} target="_blank" rel="noreferrer" className="rounded border border-border px-3 py-2 text-sm hover:border-accent hover:text-accent">Open at BBR ↗</a>}
          <Link href="/favourites" className="rounded border border-accent px-3 py-2 text-sm text-accent">All favourites</Link>
        </div>
      </header>

      {formats.length === 0 && <p role="status" className="rounded border border-accent/40 bg-background p-3 text-sm">
        This wine is not in the tracked BBX catalogue, so there is no live market data for it.
        Everything below comes from the source records that reference this Parent ID.
      </p>}

      {formats.length > 0 && <Card
        title="Market now"
        note="All prices are 75cl bottle equivalents. The guide is a constant £/litre per wine, so it reads flat across formats while asks do not — the adjusted guide applies BBR's own release-offer format premiums instead."
      >
        <div className="mt-4 overflow-auto">
          <table className="w-full min-w-max text-left text-sm">
            <thead className="text-xs uppercase text-ink-muted">
              <tr>
                <th className="py-2 pr-3">Format</th><th className="py-2 pr-3">Listing</th>
                <th className="py-2 pr-3 text-right">Ask / 75cl</th><th className="py-2 pr-3 text-right">Bid / 75cl</th>
                <th className="py-2 pr-3 text-right">Guide / 75cl</th><th className="py-2 pr-3 text-right">Adjusted / 75cl</th>
                <th className="py-2 pr-3 text-right">Ask vs release</th><th className="py-2">Checked</th>
              </tr>
            </thead>
            <tbody>
              {formats.map((format) => {
                const anchor = anchorByFormat.get(format.format_code);
                return <tr key={format.format_code} className="border-t border-border">
                  <td className="py-2 pr-3">{formatFormat(format.case_size, format.bottle_volume_ml)}</td>
                  <td className="py-2 pr-3">{format.is_listed ? "Listed" : "Unlisted"}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{formatPence(perBottleP(format.ask, format.case_size, format.bottle_volume_ml))}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{formatPence(perBottleP(format.highest_bid_p, format.case_size, format.bottle_volume_ml))}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{formatPence(perBottleP(format.market_price_p, format.case_size, format.bottle_volume_ml))}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{formatPence(perBottleP(format.adjusted_guide_p, format.case_size, format.bottle_volume_ml))}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{formatSignedPct(anchor?.ask_vs_release_pct ?? null)}</td>
                  <td className="py-2 text-xs text-ink-muted">{formatDateTime(format.last_rest_checked_at)}</td>
                </tr>;
              })}
            </tbody>
          </table>
        </div>
      </Card>}

      <Card
        title="Release history"
        note={releaseRecords.length > 0
          ? "Every accepted BBR release offer that resolves to this Parent ID, oldest offers last."
          : undefined}
      >
        {releaseRecords.length === 0
          ? <p className="mt-3 text-sm text-ink-muted">No accepted release offer resolves to this wine.</p>
          : <div className="mt-4 overflow-auto">
            <table className="w-full min-w-max text-left text-sm">
              <thead className="text-xs uppercase text-ink-muted">
                <tr>
                  <th className="py-2 pr-3">Offer date</th><th className="py-2 pr-3">Format</th>
                  <th className="py-2 pr-3 text-right">Release / 75cl</th><th className="py-2 pr-3">Anchor</th>
                  <th className="py-2 pr-3">Matched by</th><th className="py-2">Record</th>
                </tr>
              </thead>
              <tbody>
                {releaseRecords.map((record) => {
                  const anchor = anchorByFormat.get(record.format_code);
                  const isAnchor = anchor?.offer_date === record.offer_date
                    && anchor?.release_price_p === record.release_price_p;
                  return <tr key={`${record.import_id}-${record.source_row_number}-${record.format_code}`} className="border-t border-border">
                    <td className="py-2 pr-3 whitespace-nowrap">{formatDate(record.offer_date)}</td>
                    <td className="py-2 pr-3">{formatFormat(record.case_size, record.bottle_volume_ml)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{formatPence(perBottleP(record.release_price_p, record.case_size, record.bottle_volume_ml))}</td>
                    <td className="py-2 pr-3 text-xs">{isAnchor ? (anchor?.anchor_status === "confirmed" ? "Confirmed anchor" : "Provisional anchor") : "–"}</td>
                    <td className="py-2 pr-3 text-xs text-ink-muted">{methodLabel(record.match_method)}</td>
                    <td className="py-2">
                      <Link href={`/release-prices/offers/${record.import_id}/${record.source_row_number}`} className="text-sm text-accent underline-offset-2 hover:underline">Open</Link>
                    </td>
                  </tr>;
                })}
              </tbody>
            </table>
          </div>}
      </Card>

      <Card
        title="My cellar"
        note={cellarRecords.length > 0 || bbrHoldings.length > 0
          ? "CellarTracker's BBR quantity and the BBR cellar holdings describe the same bottles from two sources, so they are shown separately rather than totalled."
          : undefined}
      >
        {cellarRecords.length === 0 && bbrHoldings.length === 0
          ? <p className="mt-3 text-sm text-ink-muted">You hold none of this wine in either source.</p>
          : <div className="mt-4 space-y-5">
            {cellarRecords.length > 0 && <div>
              <h3 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">CellarTracker</h3>
              <ul className="mt-2 space-y-2">
                {cellarRecords.map((record) => <li key={`${record.import_id}-${record.source_row_number}`} className="flex flex-wrap items-baseline justify-between gap-3 rounded border border-border p-3 text-sm">
                  <div>
                    <Link href={`/cellartracker/${record.import_id}/${record.source_row_number}`} className="font-medium text-accent underline-offset-2 hover:underline">{record.source_wine}</Link>
                    <p className="mt-1 text-xs text-ink-muted">
                      {record.quantity_home} at home · {record.quantity_bbr} at BBR · paid {formatPence(record.purchase_price_per_bottle_p)} / 75cl
                      {record.fully_consumed && " · fully consumed"}
                      {record.begin_consume && record.end_consume ? ` · drink ${record.begin_consume}–${record.end_consume}` : ""}
                    </p>
                  </div>
                  <span className="text-xs text-ink-muted">Linked by {methodLabel(record.match_method)}</span>
                </li>)}
              </ul>
            </div>}
            {bbrHoldings.length > 0 && <div>
              <h3 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">BBR cellar</h3>
              <ul className="mt-2 space-y-2">
                {bbrHoldings.map((holding) => <li key={`${holding.import_id}-${holding.source_row_number}`} className="flex flex-wrap items-baseline justify-between gap-3 rounded border border-border p-3 text-sm">
                  <div>
                    <p className="font-medium">{holding.description ?? parentSku}</p>
                    <p className="mt-1 text-xs text-ink-muted">
                      {formatFormat(holding.case_size, holding.bottle_volume_ml)} · {holding.quantity_bottles} bottle{holding.quantity_bottles === 1 ? "" : "s"}
                      {" · paid "}{formatPence(perBottleP(holding.purchase_price_per_case_p, holding.case_size, holding.bottle_volume_ml))} / 75cl
                      {holding.current_status ? ` · ${holding.current_status}` : ""}
                    </p>
                  </div>
                  <span className="text-xs text-ink-muted">{holding.eligible_for_bbx ? "BBX eligible" : "Not BBX eligible"}</span>
                </li>)}
              </ul>
            </div>}
          </div>}
      </Card>

      <Card
        title="How this wine is joined up"
        note="Unlink and re-link live on the record pages, so the audit trail stays with the record rather than being duplicated here."
      >
        <ul className="mt-3 space-y-1 text-sm">
          <li>{formats.length > 0
            ? `${formats.length} format${formats.length === 1 ? "" : "s"} in the tracked BBX catalogue`
            : "Not in the tracked BBX catalogue"}</li>
          <li>{releaseRecords.length > 0
            ? `${releaseRecords.length} accepted release-offer price${releaseRecords.length === 1 ? "" : "s"}`
            : "No accepted release offers"}</li>
          <li>{cellarRecords.length > 0
            ? `${cellarRecords.length} CellarTracker record${cellarRecords.length === 1 ? "" : "s"} in the current snapshot`
            : "No CellarTracker records in the current snapshot"}</li>
          <li>{bbrHoldings.length > 0
            ? `${bbrHoldings.length} BBR cellar holding${bbrHoldings.length === 1 ? "" : "s"}`
            : "No BBR cellar holdings"}</li>
        </ul>
      </Card>
    </div>
  </main>;
}
