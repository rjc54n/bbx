"use client";

import { useEffect, useState } from "react";

// Debounces asynchronous suggestion inputs such as the producer typeahead.
// The main catalogue search uses explicit form submission because changing
// its URL triggers a complete result query.
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
