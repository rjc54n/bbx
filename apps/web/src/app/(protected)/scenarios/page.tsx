import Link from "next/link";
import { requireOwner } from "@/lib/auth/owner";
import { formatDate } from "@/lib/format";
import { parseScenarioDefinition } from "@/lib/scenarios/definition";
import { SCENARIO_FILTERS, type ScenarioFilterField } from "@/lib/scenarios/registry";
import { timeProtectedQuery } from "@/lib/observability/routeTiming";

export const dynamic = "force-dynamic";

type ScenarioRow = { id: string; name: string; definition: unknown; updated_at: string };

function summarise(definition: unknown): string {
  const { filters } = parseScenarioDefinition(definition);
  if (filters.length === 0) return "Needs at least one filter";
  return filters.map((filter) => {
    const label = SCENARIO_FILTERS[filter.field as ScenarioFilterField]?.label ?? filter.field;
    if (filter.kind === "range") {
      const parts = [filter.min !== undefined ? `≥ ${filter.min}` : null, filter.max !== undefined ? `≤ ${filter.max}` : null].filter(Boolean).join(" and ");
      return `${label} ${parts}`;
    }
    if (filter.kind === "boolean") return filter.value ? label : `not ${label}`;
    if (filter.kind === "enum") return `${label}: ${filter.value.join(", ")}`;
    if (filter.kind === "text") return `${label} ~ "${filter.value}"`;
    return label;
  }).join(" · ");
}

export default async function ScenariosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const owner = await requireOwner();
  const { data, error } = await timeProtectedQuery("/scenarios", "saved_scenarios_list", async () => owner.supabase
    .from("saved_scenarios")
    .select("id,name,definition,updated_at")
    .order("updated_at", { ascending: false }));
  if (error) throw new Error("Saved scenarios could not be loaded.");
  const scenarios = (data ?? []) as ScenarioRow[];

  return <div className="flex min-h-0 flex-1 flex-col">
    <header className="border-b border-border bg-accent-soft px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-accent">Scenarios</p>
          <h1 className="mt-1 text-2xl font-semibold">Saved scenarios</h1>
          <p className="mt-1 max-w-3xl text-sm text-ink-muted">
            Named filters over every biddable format, evaluated live against the wine card metrics
            (ask, bid, release, market). Open one to run it and see the wines it matches.
          </p>
        </div>
        <Link href="/scenarios/new" className="rounded bg-accent px-3 py-2 text-sm font-medium text-accent-ink">New scenario</Link>
      </div>
    </header>

    {query.deleted && <p role="status" className="border-b border-green-700/30 bg-green-50 px-5 py-3 text-sm text-green-900">The scenario was deleted.</p>}
    {query.error === "name" && <p role="alert" className="border-b border-red-700/30 bg-background px-5 py-3 text-sm text-red-800">A scenario needs a name of 1–120 characters.</p>}
    {query.error === "filters" && <p role="alert" className="border-b border-red-700/30 bg-background px-5 py-3 text-sm text-red-800">Add at least one valid filter before saving a scenario.</p>}
    {query.error === "save" && <p role="alert" className="border-b border-red-700/30 bg-background px-5 py-3 text-sm text-red-800">The scenario could not be saved.</p>}

    <div className="min-h-0 flex-1 overflow-auto p-5">
      {scenarios.length === 0
        ? <p className="text-sm text-ink-muted">No saved scenarios yet. <Link href="/scenarios/new" className="text-accent underline-offset-2 hover:underline">Create one</Link> — for example, ask within 10% of release.</p>
        : <ul className="grid gap-3 lg:grid-cols-2">
          {scenarios.map((scenario) => <li key={scenario.id}>
            <Link href={`/scenarios/${scenario.id}`} className="block rounded-lg border border-border bg-background p-4 hover:border-accent">
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="font-semibold">{scenario.name}</h2>
                <span className="text-xs text-ink-muted">{formatDate(scenario.updated_at)}</span>
              </div>
              <p className="mt-1 text-sm text-ink-muted">{summarise(scenario.definition)}</p>
            </Link>
          </li>)}
        </ul>}
    </div>
  </div>;
}
