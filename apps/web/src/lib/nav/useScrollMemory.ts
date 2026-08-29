"use client";

import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

// List pages (catalogue, favourites, CellarTracker records) scroll their rows
// inside a nested overflow-auto container that is filled after mount. The
// browser's native scroll restoration only handles the window scroller and only
// when the content height is already present, so returning to one of these
// pages always snaps to the top. This hook persists the container's scrollTop
// per view key and restores it once on the next mount.
//
//   key    a stable identifier for the current view -- typically the serialised
//          query string. Changing it *while mounted* (the user edited a filter)
//          scrolls back to the top; it does not restore.
//   ready  false while the rows are still loading. Restore waits for the first
//          time this is true so the container is tall enough to accept the
//          saved offset. Pages whose rows render synchronously can omit it.

const STORAGE_PREFIX = "scrollMemory:";

function read(key: string): number | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_PREFIX + key);
    if (raw === null) return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function write(key: string, value: number): void {
  try {
    sessionStorage.setItem(STORAGE_PREFIX + key, String(Math.round(value)));
  } catch {
    // Private-mode Safari and storage-disabled contexts throw on write.
  }
}

export function useScrollMemory(
  ref: RefObject<HTMLElement | null>,
  key: string,
  ready = true,
): void {
  const restoredForKey = useRef<string | null>(null);
  const mountedKey = useRef(key);

  // Restore once per key, as soon as the rows are present.
  useLayoutEffect(() => {
    if (!key || !ready) return;
    if (restoredForKey.current === key) return;
    const el = ref.current;
    if (!el) return;
    const saved = read(key);
    if (saved !== null) el.scrollTop = saved;
    restoredForKey.current = key;
  }, [ref, key, ready]);

  // A key change after mount means the user re-filtered in place: start at the
  // top rather than a stale offset from the previous result set.
  useEffect(() => {
    if (!key || mountedKey.current === key) return;
    mountedKey.current = key;
    ref.current?.scrollTo({ top: 0 });
  }, [ref, key]);

  // Persist on scroll (rAF-coalesced) and when the page is hidden or unmounts.
  useEffect(() => {
    const el = ref.current;
    if (!key || !el) return;
    let frame = 0;
    const persist = () => write(key, el.scrollTop);
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        persist();
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pagehide", persist);
    return () => {
      el.removeEventListener("scroll", onScroll);
      window.removeEventListener("pagehide", persist);
      if (frame) cancelAnimationFrame(frame);
      persist();
    };
  }, [ref, key]);
}
