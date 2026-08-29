"use client";

import { useRef, type ReactNode } from "react";
import { useScrollMemory } from "@/lib/nav/useScrollMemory";

// A scroll container that remembers its position per `memoryKey`, for use from
// server components that cannot call the useScrollMemory hook directly. Client
// components should use the hook against their own ref instead.
export function ScrollMemory({
  memoryKey,
  className,
  children,
}: {
  memoryKey: string;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useScrollMemory(ref, memoryKey);
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
