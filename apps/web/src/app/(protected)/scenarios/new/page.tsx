import Link from "next/link";
import { requireOwner } from "@/lib/auth/owner";
import { ScenarioEditor } from "@/components/scenarios/ScenarioEditor";
import { createScenario } from "../actions";

export const dynamic = "force-dynamic";

export default async function NewScenarioPage() {
  await requireOwner();

  return <main className="min-h-0 flex-1 overflow-auto bg-accent-soft">
    <div className="mx-auto max-w-4xl space-y-5 p-5">
      <Link href="/scenarios" className="text-sm text-accent underline-offset-2 hover:underline">Back to scenarios</Link>
      <header>
        <p className="text-xs font-semibold uppercase tracking-wider text-accent">Scenarios</p>
        <h1 className="mt-1 text-2xl font-semibold">New scenario</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-muted">
          Add filters over the wine card metrics, name it, and create it. You&apos;ll see the wines it
          matches once it&apos;s saved.
        </p>
      </header>
      <section className="rounded-lg border border-border bg-background p-5">
        <ScenarioEditor action={createScenario} submitLabel="Create scenario" />
      </section>
    </div>
  </main>;
}
