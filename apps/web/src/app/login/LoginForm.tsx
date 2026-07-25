"use client";

import Link from "next/link";
import { useActionState } from "react";
import { login } from "./actions";
import { initialLoginState } from "./state";

export function LoginForm({ returnPath }: { returnPath: string }) {
  const [state, action, pending] = useActionState(login, initialLoginState);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={returnPath} />
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
      <div>
        <label htmlFor="password" className="mb-1 block text-sm font-medium">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="w-full rounded border border-border px-3 py-2 outline-none focus:border-accent"
        />
      </div>
      {state.error && (
        <p className="rounded border border-accent/30 bg-accent-soft px-3 py-2 text-sm text-accent" role="alert">
          {state.error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded bg-accent px-4 py-2 font-medium text-accent-ink disabled:opacity-50"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
      <Link
        href="/forgot-password"
        className="block text-center text-sm text-accent underline-offset-2 hover:underline"
      >
        Set or reset password
      </Link>
    </form>
  );
}
