"use client";

import { useEffect, useState } from "react";
import { useDebouncedValue } from "@/lib/query/useDebouncedValue";

interface SearchBarProps {
  value: string;
  onCommit: (value: string) => void;
}

// Standalone and always visible -- the opening screen leads with search, not
// a collapsed filter group it's hidden inside (see FilterStrip.tsx, which
// deliberately never renders the "search" field).
export function SearchBar({ value, onCommit }: SearchBarProps) {
  const [text, setText] = useState(value);
  const debounced = useDebouncedValue(text, 300);

  // Render-phase resync when the committed value changes externally (chip
  // removal, Reset, Back/Forward) -- see FilterStrip's RangeControl for the
  // same pattern.
  const [prevValue, setPrevValue] = useState(value);
  if (value !== prevValue) {
    setPrevValue(value);
    setText(value);
  }

  useEffect(() => {
    if (debounced !== value) onCommit(debounced);
    // onCommit intentionally omitted: it's a fresh closure each render from
    // the parent, and the debounced!==value guard already makes an extra run
    // harmless -- adding it would just fire this effect on every parent
    // render without changing behaviour.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced, value]);

  return (
    <input
      type="search"
      className="w-full max-w-md rounded border border-border bg-background px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
      placeholder="Search wine name or producer"
      value={text}
      onChange={(e) => setText(e.target.value)}
      aria-label="Search wine name or producer"
    />
  );
}
