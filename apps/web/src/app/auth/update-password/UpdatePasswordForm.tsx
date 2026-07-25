"use client";

import Link from "next/link";
import { type FormEvent, useEffect, useState } from "react";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/password";
import { validateNewPassword } from "@/lib/auth/password";
import { supabase } from "@/lib/supabase";

type RecoveryStatus = "checking" | "ready" | "invalid" | "saving";

export function UpdatePasswordForm() {
  const [status, setStatus] = useState<RecoveryStatus>("checking");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    void supabase.auth.getUser().then(({ data, error: userError }) => {
      if (!active) return;
      setStatus(!userError && data.user ? "ready" : "invalid");
    });

    return () => {
      active = false;
    };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const formData = new FormData(event.currentTarget);
    const validation = validateNewPassword(
      formData.get("password"),
      formData.get("password_confirmation"),
    );
    if (validation.password === null) {
      setError(validation.error);
      return;
    }

    setStatus("saving");
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      setStatus("invalid");
      return;
    }

    const { error: updateError } = await supabase.auth.updateUser({
      password: validation.password,
    });
    if (updateError) {
      setError("The password could not be changed. Request a new link and try again.");
      setStatus("ready");
      return;
    }

    await supabase.auth.signOut();
    window.location.assign("/login?password_updated=1");
  }

  if (status === "checking") {
    return (
      <p className="text-sm text-ink-muted" role="status">
        Checking the password link…
      </p>
    );
  }

  if (status === "invalid") {
    return (
      <div className="space-y-4">
        <p
          className="rounded border border-accent/30 bg-accent-soft px-3 py-2 text-sm text-accent"
          role="alert"
        >
          This browser does not have an active password recovery session. Request
          another link and open it in the same browser.
        </p>
        <Link
          href="/forgot-password"
          className="block text-center text-sm text-accent underline-offset-2 hover:underline"
        >
          Request another password link
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
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
      {error && (
        <p
          className="rounded border border-accent/30 bg-accent-soft px-3 py-2 text-sm text-accent"
          role="alert"
        >
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={status === "saving"}
        className="w-full rounded bg-accent px-4 py-2 font-medium text-accent-ink disabled:opacity-50"
      >
        {status === "saving" ? "Saving…" : "Save password"}
      </button>
    </form>
  );
}
