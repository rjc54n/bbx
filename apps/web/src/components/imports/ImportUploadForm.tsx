"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { uploadFileWithProgress } from "@/lib/imports/uploadWithProgress";

export type UploadTarget = {
  importId: string;
  objectPath: string;
  signedUrl: string;
  token: string;
};

export type CreateTargetResult = UploadTarget | { error: string };
export type ProcessResult = { redirectTo: string } | { error: string };
export type ProcessInput = { importId: string; objectPath: string; originalFilename: string };
export type ProgressSnapshot = { label: string };

type Phase = "idle" | "uploading" | "processing" | "error";

type ImportUploadFormProps = {
  heading: string;
  description: string;
  fieldId: string;
  fieldLabel: string;
  accept: string;
  maxBytes: number;
  maxBytesLabel: string;
  hint: string;
  createTarget: (fileName: string, fileSize: number) => Promise<CreateTargetResult>;
  processUpload: (input: ProcessInput) => Promise<ProcessResult>;
  onPoll?: (importId: string) => Promise<ProgressSnapshot>;
};

export function ImportUploadForm({
  heading,
  description,
  fieldId,
  fieldLabel,
  accept,
  maxBytes,
  maxBytesLabel,
  hint,
  createTarget,
  processUpload,
  onPoll,
}: ImportUploadFormProps) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [uploadFraction, setUploadFraction] = useState(0);
  const [progress, setProgress] = useState<ProgressSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  const busy = phase === "uploading" || phase === "processing";

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = fileInputRef.current?.files?.[0];
    if (!file || file.size === 0) {
      setError(`Choose a non-empty ${fieldLabel.toLowerCase()} file.`);
      setPhase("error");
      return;
    }
    if (file.size > maxBytes) {
      setError(`The file exceeds the ${maxBytesLabel} import limit.`);
      setPhase("error");
      return;
    }
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setError("Choose a CSV file.");
      setPhase("error");
      return;
    }

    setError(null);
    setPhase("uploading");
    setUploadFraction(0);

    const target = await createTarget(file.name, file.size);
    if ("error" in target) {
      setError(target.error);
      setPhase("error");
      return;
    }

    try {
      await uploadFileWithProgress(target.signedUrl, file, setUploadFraction);
    } catch {
      setError("The file could not be uploaded. Try again.");
      setPhase("error");
      return;
    }

    setPhase("processing");
    setProgress(null);

    let polling = true;
    const poll = async () => {
      if (!polling || !onPoll) return;
      const snapshot = await onPoll(target.importId).catch(() => null);
      if (polling && snapshot) setProgress(snapshot);
    };
    const interval = onPoll ? setInterval(poll, 1500) : null;
    if (onPoll) void poll();

    const result = await processUpload({
      importId: target.importId,
      objectPath: target.objectPath,
      originalFilename: file.name,
    });

    polling = false;
    if (interval) clearInterval(interval);

    if ("error" in result) {
      setError(result.error);
      setPhase("error");
      return;
    }
    router.push(result.redirectTo);
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4 rounded-lg border border-border bg-background p-5"
    >
      <div>
        <h2 className="text-lg font-semibold">{heading}</h2>
        <p className="mt-1 text-sm text-ink-muted">{description}</p>
      </div>
      <div>
        <label htmlFor={fieldId} className="block text-sm font-medium">
          {fieldLabel}
        </label>
        <input
          ref={fileInputRef}
          id={fieldId}
          name="file"
          type="file"
          accept={accept}
          required
          disabled={busy}
          className="mt-2 block w-full text-sm disabled:opacity-50"
        />
        <p className="mt-2 text-xs text-ink-muted">{hint}</p>
      </div>

      {phase === "uploading" && (
        <div role="status" aria-live="polite">
          <div className="h-2 overflow-hidden rounded-full bg-accent-soft">
            <div
              className="h-full rounded-full bg-accent transition-[width]"
              style={{ width: `${Math.round(uploadFraction * 100)}%` }}
            />
          </div>
          <p className="mt-1 text-xs text-ink-muted">Uploading… {Math.round(uploadFraction * 100)}%</p>
        </div>
      )}

      {phase === "processing" && (
        <p role="status" aria-live="polite" className="text-sm text-ink-muted">
          {progress?.label ?? "Processing…"}
        </p>
      )}

      {error && (
        <p role="alert" className="text-sm text-accent">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={busy}
        className="rounded bg-accent px-4 py-2 text-sm font-medium text-accent-ink disabled:opacity-50"
      >
        {phase === "uploading" ? "Uploading…" : phase === "processing" ? "Processing…" : "Upload and preview"}
      </button>
    </form>
  );
}
