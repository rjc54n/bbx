"use client";

import { startingPointFor } from "@/lib/query/startingPoints";
import type { QueryMode } from "@/lib/query/types";

const VISIBLE_MODES = ["explore", "price-changes"] as const;

interface ModeTabsProps {
  mode: QueryMode;
  onChange: (mode: "explore" | "price-changes") => void;
}

export function ModeTabs({ mode, onChange }: ModeTabsProps) {
  return (
    <nav className="flex gap-1 px-4 pt-2" aria-label="Catalogue view">
      {VISIBLE_MODES.map((modeOption) => {
        const sp = startingPointFor(modeOption);
        const active = modeOption === mode;
        return (
          <button
            key={sp.mode}
            type="button"
            onClick={() => onChange(modeOption)}
            aria-current={active ? "page" : undefined}
            title={sp.description}
            className={`rounded-t-md px-3 py-1.5 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${
              active ? "bg-accent text-accent-ink" : "text-ink-muted hover:bg-accent-soft hover:text-ink"
            }`}
          >
            {sp.label}
          </button>
        );
      })}
    </nav>
  );
}
