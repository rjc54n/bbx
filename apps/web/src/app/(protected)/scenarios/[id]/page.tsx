import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOwner } from "@/lib/auth/owner";
import { applyFilters } from "@/lib/query/applyFilters";
import { perBottleP } from "@/lib/favourites/browser";
import { formatFormat, formatPence, formatSignedPct } from "@/lib/format";
import { parseScenarioDefinition } from "@/lib/scenarios/definition";
import { scenarioPageCount, scenarioPageForCount, scenarioRange, parsePage } from "@/lib/scenarios/browser";
import { ScenarioEditor } from "@/components/scenarios/ScenarioEditor";
import { Pagination } from "@/components/nav/Pagination";
import { deleteScenario, updateScenario } from "../actions";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/i;

type ScenarioResultRow = {
  parent_sku: string | null;
  format_code: string | null;
  name: string | null;
  vintage: number | null;
  case_size: number | null;
  bottle_volume_ml: number | null;
  lowest_ask_p: number | null;
  release_price_p: number | null;
  ask_vs_release_pct: number | null;
  anchor_status: string | null;
};

export default async function ScenarioDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const query = await searchParams;
  const owner = await requireOwner();
  const { supabase } = owner;

  const { data: scenario, error } = await supabase
    .from("saved_scenarios").select("id,name,definition").eq("id", id).maybeSingle();
  if (error) throw new Error("Scenario could not be loaded.");
  if (!scenario) notFound();

  const definition = parseScenarioDefinition(scenario.definition);

  async function loadPage(page: number) {
    const request = applyFilters(
      supabase.from("wine_scenario_view").select("*", { count: "exact" }),
      definition.filters,
    );
    const { from, to } = scenarioRange(page);
    return request
      .order(definition.sort.field, { ascending: definition.sort.dir === "asc", nullsFirst: false })
      .order("parent_sku", { ascending: true })
      .order("format_code", { ascending: true })
      .range(from, to);
  }

  let page = parsePage(query.page);
  let { data, count, error: runError } = await loadPage(page);
  if (runError && page > 1) {
    const clamped = scenarioPageForCount(page, count ?? 0);
    page = clamped < page ? clamped : 1;
    ({ data, count, error: runError } = await loadPage(page));
  }
  if (runError) throw new Error(`The scenario could not be evaluated: ${runError.message}`);
  const rows = (data ?? []) as ScenarioResultRow[];
  const total = count ?? 0;
  const pageCount = scenarioPageCount(total);

  return <main className="min-h-0 flex-1 overflow-auto bg-accent-soft">
    <div className="mx-auto max-w-6xl space-y-5 p-5">
      <Link href="/scenarios" className="text-sm text-accent underline-offset-2 hover:underline">Back to scenarios</Link>
      {query.saved && <p role="status" className="rounded border border-green-700/30 bg-green-50 px-4 py-3 text-sm text-green-900">Scenario saved.</p>}
      {query.error === "name" && <p role="alert" className="rounded border border-red-700/30 bg-background px-4 py-3 text-sm text-red-800">A scenario needs a name of 1–120 characters.</p>}
      {(query.error === "save" || query.error === "delete") && <p role="alert" className="rounded border border-red-700/30 bg-background px-4 py-3 text-sm text-red-800">The scenario could not be {query.error === "delete" ? "deleted" : "saved"}.</p>}

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-accent">Scenario</p>
          <h1 className="mt-1 text-2xl font-semibold">{scenario.name}</h1>
          <p className="mt-1 text-sm text-ink-muted"><strong className="tabular-nums">{total.toLocaleString()}</strong> matching format{total === 1 ? "" : "s"}</p>
        </div>
        <form action={deleteScenario.bind(null, id)}>
          <button type="submit" className="rounded border border-border px-3 py-2 text-sm hover:border-red-700 hover:text-red-800">Delete scenario</button>
        </form>
      </header>

      <section className="rounded-lg border border-border bg-background p-5">
        <h2 className="text-lg font-semibold">Definition</h2>
        <p className="mt-1 text-sm text-ink-muted">Edit the filters and save to re-run.</p>
        <div className="mt-4">
          <ScenarioEditor
            action={updateScenario.bind(null, id)}
            submitLabel="Save and run"
            initialName={scenario.name}
            initialFilters={definition.filters}
            initialSort={definition.sort}
          />
        </div>
      </section>

      <section className="rounded-lg border border-border bg-background">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
          <h2 className="font-semibold">Matches</h2>
        </div>
        <div className="overflow-auto">
          <table className="w-full min-w-max text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="px-5 py-2">Wine</th><th className="px-3 py-2">Format</th>
                <th className="px-3 py-2 text-right">Ask / 75cl</th><th className="px-3 py-2 text-right">Release / 75cl</th>
                <th className="px-3 py-2 text-right">Ask vs release</th><th className="px-3 py-2">Anchor</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? <tr><td colSpan={6} className="px-5 py-10 text-center text-ink-muted">No biddable format matches this scenario.</td></tr>
                : rows.map((row) => <tr key={`${row.parent_sku}-${row.format_code}`} className="border-t border-border">
                  <td className="px-5 py-2">
                    {row.parent_sku
                      ? <Link href={`/wine/parent/${row.parent_sku}`} className="font-medium text-accent underline-offset-2 hover:underline">{row.name ?? row.parent_sku}</Link>
                      : <span className="font-medium">{row.name ?? "–"}</span>}
                    <span className="block text-xs text-ink-muted">{row.vintage ?? "Vintage unavailable"}</span>
                  </td>
                  <td className="px-3 py-2">{formatFormat(row.case_size, row.bottle_volume_ml)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatPence(perBottleP(row.lowest_ask_p, row.case_size, row.bottle_volume_ml))}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatPence(perBottleP(row.release_price_p, row.case_size, row.bottle_volume_ml))}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatSignedPct(row.ask_vs_release_pct)}</td>
                  <td className="px-3 py-2 text-xs text-ink-muted">{row.anchor_status ?? "–"}</td>
                </tr>)}
            </tbody>
          </table>
        </div>
        <Pagination
          page={page}
          totalPages={pageCount}
          totalCount={total}
          label="matches"
          basePath={`/scenarios/${id}`}
        />
      </section>
    </div>
  </main>;
}
