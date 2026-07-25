import { Suspense, type ReactNode } from "react";
import { logout } from "@/app/login/actions";
import { PrimaryNavigation } from "./PrimaryNavigation";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-border bg-background px-4 py-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-accent">
            BBX
          </p>
          <p className="text-sm text-ink-muted">Catalogue and cellar</p>
        </div>
        <form action={logout}>
          <button
            type="submit"
            className="text-sm text-ink-muted underline-offset-2 hover:text-accent hover:underline"
          >
            Sign out
          </button>
        </form>
      </header>
      <Suspense
        fallback={<div className="h-10 shrink-0 border-b border-border bg-background" />}
      >
        <PrimaryNavigation />
      </Suspense>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
