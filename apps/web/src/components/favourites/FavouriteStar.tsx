"use client";

import { useOptimistic, useState, useTransition } from "react";
import { setFavourite } from "@/app/(protected)/favourites/actions";
import type { FavouriteTarget } from "@/lib/favourites/target";

/**
 * The one star control. Every surface renders this rather than its own button,
 * so a favourite means the same thing and looks the same everywhere.
 *
 * useOptimistic rather than a hand-rolled rollback: on failure the optimistic
 * value reverts on its own when the transition ends, because the server value
 * never changed. On success the action calls refresh(), the server value
 * arrives, and the optimistic value resolves onto it.
 */
export function FavouriteStar({ target, favourite, label }: {
  target: FavouriteTarget;
  favourite: boolean;
  /** The wine, for the accessible name -- "Add Ducru-Beaucaillou to favourites". */
  label: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [optimistic, setOptimistic] = useOptimistic(
    favourite,
    (_current: boolean, next: boolean) => next,
  );

  function toggle() {
    const next = !optimistic;
    setError(null);
    startTransition(async () => {
      setOptimistic(next);
      const result = await setFavourite(target, next);
      if (result.error) setError(result.error);
    });
  }

  return <span className="inline-flex items-center gap-2">
    <button
      type="button"
      onClick={toggle}
      aria-label={`${optimistic ? "Remove" : "Add"} ${label} ${optimistic ? "from" : "to"} favourites`}
      aria-pressed={optimistic}
      title={optimistic ? "Remove from favourites" : "Add to favourites"}
      disabled={isPending}
      className={`inline-flex size-9 items-center justify-center rounded border transition-colors disabled:cursor-wait disabled:opacity-60 ${optimistic ? "border-accent bg-accent text-accent-ink" : "border-border text-ink-muted hover:border-accent hover:text-accent"}`}
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill={optimistic ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8">
        <path strokeLinecap="round" strokeLinejoin="round" d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78Z" />
      </svg>
    </button>
    {error && <span role="alert" className="text-left text-xs text-accent">{error}</span>}
  </span>;
}
