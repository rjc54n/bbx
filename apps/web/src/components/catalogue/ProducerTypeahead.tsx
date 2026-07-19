"use client";

import { useEffect, useState } from "react";
import { searchProducers } from "@/lib/query/producers";
import type { ProducerOption } from "@/lib/query/rows";
import { useDebouncedValue } from "@/lib/query/useDebouncedValue";

interface ProducerTypeaheadProps {
  value: string | undefined;
  onSelect: (producer: string | undefined) => void;
}

// producer is high-cardinality -- async typeahead against search_producers,
// never a preloaded facet list (docs/PHASE2-catalogue-browser.md Phase A).
export function ProducerTypeahead({ value, onSelect }: ProducerTypeaheadProps) {
  const [text, setText] = useState(value ?? "");
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<ProducerOption[]>([]);
  const debouncedText = useDebouncedValue(text, 250);

  // Render-phase resync when the committed value changes externally (chip
  // removal, Reset, Back/Forward) -- see RangeControl in FilterStrip.tsx for
  // the same pattern and why it's an effect-free alternative here.
  const [prevValue, setPrevValue] = useState(value);
  if (value !== prevValue) {
    setPrevValue(value);
    setText(value ?? "");
  }

  const shouldSearch = open && debouncedText.trim().length >= 2;

  useEffect(() => {
    if (!shouldSearch) return;
    let cancelled = false;
    searchProducers(debouncedText).then((results) => {
      if (!cancelled) setOptions(results);
    });
    return () => {
      cancelled = true;
    };
  }, [shouldSearch, debouncedText]);

  const visibleOptions = shouldSearch ? options : [];

  return (
    <div className="relative">
      <input
        type="text"
        className="w-full rounded border border-border bg-background px-2 py-1 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        placeholder="Any producer"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          if (e.target.value === "") onSelect(undefined);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {visibleOptions.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-64 w-64 overflow-auto rounded border border-border bg-background shadow-md">
          {visibleOptions.map((option) => (
            <li key={option.producer}>
              <button
                type="button"
                className="flex w-full items-center justify-between px-3 py-1.5 text-left text-sm hover:bg-accent-soft focus-visible:bg-accent-soft"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setText(option.producer);
                  onSelect(option.producer);
                  setOpen(false);
                }}
              >
                <span>{option.producer}</span>
                <span className="tabular-nums text-ink-muted">{option.n}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
