"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ORIGIN_PARAM, readOrigin } from "@/lib/nav/origin";

// The wine card's "back" control. When the link that opened the card carried a
// `from` location (see lib/nav/origin), this is a real <Link> back to that exact
// view. Otherwise it falls back to browser history, then to the catalogue.
export function BackToOrigin({ fallbackLabel = "Back" }: { fallbackLabel?: string }) {
  const router = useRouter();
  const from = readOrigin(useSearchParams().get(ORIGIN_PARAM));

  const className =
    "inline-flex items-center gap-1 text-sm text-accent underline-offset-2 hover:underline";

  if (from) {
    return (
      <Link href={from} className={className}>
        <span aria-hidden="true">←</span> Back to results
      </Link>
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        if (window.history.length > 1) router.back();
        else router.push("/");
      }}
      className={className}
    >
      <span aria-hidden="true">←</span> {fallbackLabel}
    </button>
  );
}
