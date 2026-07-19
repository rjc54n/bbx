"use client";

import { useEffect, useState } from "react";

// Debounces the free-text search box so it doesn't fire a request per
// keystroke (docs/PHASE2-catalogue-browser.md Phase C). Range/date filter
// inputs don't use this -- they commit on change/blur in the UI itself,
// they're not continuously-typed text.
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
