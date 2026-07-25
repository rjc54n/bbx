import Link from "next/link";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <main className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-accent-soft px-4 py-10">
      <section className="w-full max-w-md rounded-lg border border-border bg-background p-6 shadow-sm">
        <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-accent">
          My BBR cellar
        </p>
        <h1 className="text-2xl font-semibold">Owner sign in</h1>
        <p className="mb-6 mt-2 text-sm text-ink-muted">
          Cellar uploads and holdings are private. There is no registration flow.
        </p>
        <LoginForm />
        <Link href="/" className="mt-5 block text-center text-sm text-accent underline-offset-2 hover:underline">
          Return to the catalogue
        </Link>
      </section>
    </main>
  );
}
