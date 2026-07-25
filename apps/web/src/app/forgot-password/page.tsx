import { PasswordResetRequestForm } from "./PasswordResetRequestForm";

export const dynamic = "force-dynamic";

export default function ForgotPasswordPage() {
  return (
    <main className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-accent-soft px-4 py-10">
      <section className="w-full max-w-md rounded-lg border border-border bg-background p-6 shadow-sm">
        <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-accent">
          My BBR cellar
        </p>
        <h1 className="text-2xl font-semibold">Set or reset your password</h1>
        <p className="mb-6 mt-2 text-sm text-ink-muted">
          Enter the owner email address. Supabase will send a single-use link
          for choosing a password.
        </p>
        <PasswordResetRequestForm />
      </section>
    </main>
  );
}
