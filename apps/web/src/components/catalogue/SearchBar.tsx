"use client";

import { type FormEvent, useState } from "react";

interface SearchBarProps {
  value: string;
  onCommit: (value: string) => void;
}

// Standalone and always visible -- the opening screen leads with search, not
// a collapsed filter group it's hidden inside (see FilterStrip.tsx, which
// deliberately never renders the "search" field).
export function SearchBar({ value, onCommit }: SearchBarProps) {
  const [text, setText] = useState(value);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = text.trim();
    setText(next);
    if (next !== value) onCommit(next);
  }

  return (
    <form onSubmit={submit} role="search" className="flex w-full max-w-md gap-2">
      <input
        type="search"
        className="min-w-0 flex-1 rounded border border-border bg-background px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        placeholder="Search wine name or producer"
        value={text}
        onChange={(event) => setText(event.target.value)}
        aria-label="Search wine name or producer"
      />
      <button
        type="submit"
        className="rounded bg-accent px-3 py-2 text-sm font-medium text-accent-ink"
      >
        Search
      </button>
    </form>
  );
}
