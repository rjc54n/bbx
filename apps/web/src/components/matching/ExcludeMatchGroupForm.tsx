"use client";

import { mutateMatchGroup } from "@/lib/matching/actions";
import { MATCH_ADAPTERS, type MatchSource } from "@/lib/matching/adapters";

export function ExcludeMatchGroupForm({
  source,
  matchGroupKey,
  recordCount,
  returnPath,
}: {
  source: MatchSource;
  matchGroupKey: string;
  recordCount: number;
  returnPath: string;
}) {
  const action = mutateMatchGroup.bind(null, source, "exclude", matchGroupKey, returnPath);
  const prompt = MATCH_ADAPTERS[source].excludePrompt(recordCount);
  return <form action={action} onSubmit={(event) => {
    if (!window.confirm(prompt)) event.preventDefault();
  }}>
    <button className="rounded border border-accent px-2 py-1.5 text-xs text-accent">Exclude {recordCount} record{recordCount === 1 ? "" : "s"}</button>
  </form>;
}
