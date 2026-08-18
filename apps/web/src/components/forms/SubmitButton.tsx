"use client";

import { useFormStatus } from "react-dom";

// A submit button that reflects its form's action state. Because the match
// actions end in redirect(), useFormStatus stays pending across the DB write
// AND the ensuing page re-render — the whole window the user perceives as a
// pause — so the click is acknowledged immediately and can't be double-fired.
export function SubmitButton({
  children,
  pendingLabel,
  className = "",
}: {
  children: React.ReactNode;
  pendingLabel?: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={`inline-flex items-center justify-center gap-1.5 transition-opacity disabled:cursor-progress disabled:opacity-60 ${className}`}
    >
      {pending && (
        <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
        </svg>
      )}
      {pending ? pendingLabel ?? children : children}
    </button>
  );
}
