import { safeReturnPath } from "@/lib/auth/routing";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";

type LoginPageProps = {
  searchParams: Promise<{
    password_updated?: string;
    recovery_error?: string;
    denied?: string;
    next?: string;
  }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const query = await searchParams;

  return (
    <main className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-accent-soft px-4 py-10">
      <section className="w-full max-w-md rounded-lg border border-border bg-background p-6 shadow-sm">
        <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-accent">
          My BBR cellar
        </p>
        <h1 className="text-2xl font-semibold">Owner sign in</h1>
        <p className="mb-6 mt-2 text-sm text-ink-muted">
          BBX is a private single-owner application. There is no registration flow.
        </p>
        {query.password_updated === "1" && (
          <p
            className="mb-4 rounded border border-accent/30 bg-accent-soft px-3 py-2 text-sm text-accent"
            role="status"
          >
            Your password has been saved. Sign in with it below.
          </p>
        )}
        {query.denied === "1" && (
          <p
            className="mb-4 rounded border border-accent/30 bg-accent-soft px-3 py-2 text-sm text-accent"
            role="alert"
          >
            Sign in with the owner account to continue.
          </p>
        )}
        {query.recovery_error === "1" && (
          <p
            className="mb-4 rounded border border-accent/30 bg-accent-soft px-3 py-2 text-sm text-accent"
            role="alert"
          >
            That password link is invalid or has expired. Request a new link.
          </p>
        )}
        <LoginForm returnPath={safeReturnPath(query.next)} />
      </section>
    </main>
  );
}
