"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

const tabs = [
  {
    id: "explore",
    label: "Explore catalogue",
    href: "/",
  },
  {
    id: "price-changes",
    label: "Price changes",
    href: "/?mode=price-changes",
  },
  {
    id: "cellar",
    label: "My BBR Cellar",
    href: "/cellar/bbr",
  },
  { id: "cellartracker", label: "My CellarTracker", href: "/cellartracker" },
  {
    id: "release-prices",
    label: "Release prices",
    href: "/release-prices",
  },
  { id: "matching", label: "Matching", href: "/matches" },
  { id: "favourites", label: "Favourites", href: "/favourites" },
  { id: "scenarios", label: "Scenarios", href: "/scenarios" },
] as const;

export function PrimaryNavigation() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const active = pathname.startsWith("/scenarios")
    ? "scenarios"
    : pathname.startsWith("/matches")
    ? "matching"
    : pathname.startsWith("/favourites")
    ? "favourites"
    : pathname.startsWith("/release-prices") || pathname.startsWith("/cellar/imports/release-offers")
    ? "release-prices"
    : pathname.startsWith("/cellartracker") || pathname.startsWith("/cellar/imports/cellartracker")
    ? "cellartracker"
    : pathname.startsWith("/cellar")
    ? "cellar"
    : searchParams.get("mode") === "price-changes"
      ? "price-changes"
      : "explore";

  return (
    <nav
      className="flex gap-1 border-b border-border bg-background px-4 pt-2"
      aria-label="Application sections"
    >
      {tabs.map((tab) => (
        <Link
          key={tab.id}
          href={tab.href}
          aria-current={active === tab.id ? "page" : undefined}
          className={`rounded-t-md px-3 py-1.5 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${
            active === tab.id
              ? "bg-accent text-accent-ink"
              : "text-ink-muted hover:bg-accent-soft hover:text-ink"
          }`}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
