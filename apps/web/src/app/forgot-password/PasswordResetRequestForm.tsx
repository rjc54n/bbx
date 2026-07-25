"use client";

import Link from "next/link";
import { useActionState } from "react";
import { requestPasswordReset } from "./actions";
import { initialPasswordResetRequestState } from "./state";

export function PasswordResetRequestForm() {
  const [state, action, pending] = useActionState(
    requestPasswordReset,
    initialPasswordResetRequestState,
  );

  if (state.sent) {
    return (
      <div className="space-y-4">
        <p
          className="rounded border border-accent/30 bg-accent-soft px-3 py-2 text-sm text-accent"
          role="status"
        >
          Check your email for a password link. The link can be used once and may
          take a minute to arrive.
        </p>
        <Link
          href="/login"
          className="block text-center text-sm text-accent underline-offset-2 hover:underline"
        >
          Return to owner sign in
        </Link>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4">
      <div>
        <label htmlFor="email" className="mb-1 block text-sm font-medium">
          Email address
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          className="w-full rounded border border-border px-3 py-2 outline-none focus:border-accent"
        />
      </div>
      {state.error && (
        <p
          className="rounded border border-accent/30 bg-accent-soft px-3 py-2 text-sm text-accent"
          role="alert"
        >
          {state.error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded bg-accent px-4 py-2 font-medium text-accent-ink disabled:opacity-50"
      >
        {pending ? "Sending…" : "Send password link"}
      </button>
    </form>
  );
}
