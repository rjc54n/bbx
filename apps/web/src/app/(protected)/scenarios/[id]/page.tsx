import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth/owner";
import { parseScenarioDefinition } from "@/lib/scenarios/definition";
import { parsePage } from "@/lib/scenarios/browser";
import { evaluateScenario } from "@/lib/scenarios/evaluate";
import { decodeScenarioPreview, encodeScenarioPreview, PREVIEW_PARAM, scenarioPreviewHref } from "@/lib/scenarios/preview";
import { ScenarioEditor } from "@/components/scenarios/ScenarioEditor";
import { ScenarioMatches } from "@/components/scenarios/ScenarioMatches";
import { timeProtectedQuery } from "@/lib/observability/routeTiming";
import { deleteScenario, updateScenario } from "../actions";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/i;

const ROUTE = "/scenarios/[id]";

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

  const { data: scenario, error } = await timeProtectedQuery(ROUTE, "saved_scenario", async () => supabase
    .from("saved_scenarios").select("id,name,definition").eq("id", id).maybeSingle());
  if (error) throw new Error("Scenario could not be loaded.");
  if (!scenario) notFound();

  const savedDefinition = parseScenarioDefinition(scenario.definition);
  const previewDefinition = decodeScenarioPreview(query[PREVIEW_PARAM]);
  const isPreview = previewDefinition !== null;
  const definition = previewDefinition ?? savedDefinition;

  const page = parsePage(query.page);
  const canRun = definition.filters.length > 0;
  const basePath = `/scenarios/${id}`;
  // The view to return to (this scenario, still previewing if it is). Used for
  // pagination, the empty-page redirect, and the wine card's "Back to results".
  const viewHref = previewDefinition ? scenarioPreviewHref(basePath, previewDefinition) : basePath;
  const previewQuery = previewDefinition
    ? { [PREVIEW_PARAM]: encodeScenarioPreview(previewDefinition) }
    : undefined;

  let rows: Awaited<ReturnType<typeof evaluateScenario>>["rows"] = [];
  let hasNext = false;
  if (canRun) {
    const result = await evaluateScenario(supabase, definition, page, ROUTE);
    if (page > 1 && result.rows.length === 0) redirect(viewHref);
    rows = result.rows;
    hasNext = result.hasNext;
  }

  return <main className="min-h-0 flex-1 overflow-auto bg-accent-soft">
    <div className="mx-auto max-w-6xl space-y-5 p-5">
      <Link href="/scenarios" className="text-sm text-accent underline-offset-2 hover:underline">Back to scenarios</Link>
      {query.saved && <p role="status" className="rounded border border-green-700/30 bg-green-50 px-4 py-3 text-sm text-green-900">Scenario saved.</p>}
      {query.error === "name" && <p role="alert" className="rounded border border-red-700/30 bg-background px-4 py-3 text-sm text-red-800">A scenario needs a name of 1–120 characters.</p>}
      {query.error === "filters" && <p role="alert" className="rounded border border-red-700/30 bg-background px-4 py-3 text-sm text-red-800">Add at least one valid filter before saving this scenario.</p>}
      {(query.error === "save" || query.error === "delete") && <p role="alert" className="rounded border border-red-700/30 bg-background px-4 py-3 text-sm text-red-800">The scenario could not be {query.error === "delete" ? "deleted" : "saved"}.</p>}

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-accent">Scenario</p>
          <h1 className="mt-1 text-2xl font-semibold">{scenario.name}</h1>
          <p className="mt-1 text-sm text-ink-muted">Results are shown as a bounded preview.</p>
        </div>
        <form action={deleteScenario.bind(null, id)}>
          <button type="submit" className="rounded border border-border px-3 py-2 text-sm hover:border-red-700 hover:text-red-800">Delete scenario</button>
        </form>
      </header>

      {isPreview && <p role="status" className="flex flex-wrap items-center gap-3 rounded border border-accent/40 bg-accent-soft px-4 py-3 text-sm">
        <span>Previewing unsaved changes. Use <strong>Save and run</strong> below to keep them.</span>
        <Link href={basePath} className="text-accent underline-offset-2 hover:underline">Discard preview</Link>
      </p>}

      <section className="rounded-lg border border-border bg-background p-5">
        <h2 className="text-lg font-semibold">Definition</h2>
        <p className="mt-1 text-sm text-ink-muted">Edit the filters, then <strong>Run</strong> to preview without saving or <strong>Save and run</strong> to keep the changes.</p>
        <div className="mt-4">
          <ScenarioEditor
            key={isPreview ? "preview" : "saved"}
            action={updateScenario.bind(null, id)}
            submitLabel="Save and run"
            previewBasePath={basePath}
            initialName={scenario.name}
            initialFilters={definition.filters}
            initialSort={definition.sort}
          />
        </div>
      </section>

      {canRun ? <ScenarioMatches
        rows={rows}
        page={page}
        hasNext={hasNext}
        basePath={basePath}
        query={previewQuery}
        from={viewHref}
      /> : <section className="rounded-lg border border-border bg-background p-5">
        <h2 className="font-semibold">Preview unavailable</h2>
        <p className="mt-1 text-sm text-ink-muted">This existing scenario has no valid filters. Add a filter above, then Run or Save it to see the matches.</p>
      </section>}
    </div>
  </main>;
}
