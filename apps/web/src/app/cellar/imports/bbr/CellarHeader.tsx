import Link from "next/link";
import { logout } from "@/app/login/actions";

export function CellarHeader() {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-background px-5 py-3">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-accent">
          My BBR cellar
        </p>
        <h1 className="text-xl font-semibold">BBR holdings imports</h1>
      </div>
      <nav className="flex items-center gap-4 text-sm">
        <Link href="/" className="text-accent underline-offset-2 hover:underline">
          Catalogue
        </Link>
        <form action={logout}>
          <button type="submit" className="text-ink-muted underline-offset-2 hover:text-accent hover:underline">
            Sign out
          </button>
        </form>
      </nav>
    </header>
  );
}
