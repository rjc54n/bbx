"use client";

import { useActionState } from "react";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/password";
import { updatePassword } from "./actions";
import { initialUpdatePasswordState } from "./state";

export function UpdatePasswordForm() {
  const [state, action, pending] = useActionState(
    updatePassword,
    initialUpdatePasswordState,
  );

  return (
    <form action={action} className="space-y-4">
      <div>
        <label htmlFor="password" className="mb-1 block text-sm font-medium">
          New password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          required
          className="w-full rounded border border-border px-3 py-2 outline-none focus:border-accent"
        />
        <p className="mt-1 text-xs text-ink-muted">
          Use at least {MIN_PASSWORD_LENGTH} characters. A password manager is recommended.
        </p>
      </div>
      <div>
        <label
          htmlFor="password_confirmation"
          className="mb-1 block text-sm font-medium"
        >
          Confirm new password
        </label>
        <input
          id="password_confirmation"
          name="password_confirmation"
          type="password"
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
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
        {pending ? "Saving…" : "Save password"}
      </button>
    </form>
  );
}
