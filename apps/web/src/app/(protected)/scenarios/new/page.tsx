import Link from "next/link";
import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth/owner";
import { parsePage } from "@/lib/scenarios/browser";
import { evaluateScenario } from "@/lib/scenarios/evaluate";
import { decodeScenarioPreview, encodeScenarioPreview, PREVIEW_PARAM, scenarioPreviewHref } from "@/lib/scenarios/preview";
import { ScenarioEditor } from "@/components/scenarios/ScenarioEditor";
import { ScenarioMatches } from "@/components/scenarios/ScenarioMatches";
import { createScenario } from "../actions";

export const dynamic = "force-dynamic";

const ROUTE = "/scenarios/new";

export default async function NewScenarioPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { supabase } = await requireOwner();
  const query = await searchParams;

  const previewDefinition = decodeScenarioPreview(query[PREVIEW_PARAM]);
  const page = parsePage(query.page);

  let rows: Awaited<ReturnType<typeof evaluateScenario>>["rows"] = [];
  let hasNext = false;
  if (previewDefinition) {
    const result = await evaluateScenario(supabase, previewDefinition, page, ROUTE);
    if (page > 1 && result.rows.length === 0) redirect(scenarioPreviewHref(ROUTE, previewDefinition));
    rows = result.rows;
    hasNext = result.hasNext;
  }

  return <main className="min-h-0 flex-1 overflow-auto bg-accent-soft">
    <div className="mx-auto max-w-4xl space-y-5 p-5">
      <Link href="/scenarios" className="text-sm text-accent underline-offset-2 hover:underline">Back to scenarios</Link>
      <header>
        <p className="text-xs font-semibold uppercase tracking-wider text-accent">Scenarios</p>
        <h1 className="mt-1 text-2xl font-semibold">New scenario</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-muted">
          Add filters over the wine card metrics, then <strong>Run</strong> to preview the wines it
          matches. Name it and <strong>Create</strong> when you&apos;re happy.
        </p>
      </header>
      <section className="rounded-lg border border-border bg-background p-5">
        <ScenarioEditor
          key={previewDefinition ? "preview" : "blank"}
          action={createScenario}
          submitLabel="Create scenario"
          previewBasePath={ROUTE}
          initialFilters={previewDefinition?.filters}
          initialSort={previewDefinition?.sort}
        />
      </section>

      {previewDefinition && <ScenarioMatches
        rows={rows}
        page={page}
        hasNext={hasNext}
        basePath={ROUTE}
        query={{ [PREVIEW_PARAM]: encodeScenarioPreview(previewDefinition) }}
        from={scenarioPreviewHref(ROUTE, previewDefinition)}
        heading="Preview"
      />}
    </div>
  </main>;
}
