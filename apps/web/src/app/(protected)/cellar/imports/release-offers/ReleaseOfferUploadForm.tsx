export function ReleaseOfferUploadForm({ error }: { error?: string }) {
  return (
    <form
      action="/cellar/imports/release-offers/upload"
      method="post"
      encType="multipart/form-data"
      className="space-y-4 rounded-lg border border-border bg-background p-5"
    >
      <div>
        <label htmlFor="release-offer-file" className="block text-sm font-medium">
          Historic release-offer CSV
        </label>
        <input
          id="release-offer-file"
          name="file"
          type="file"
          accept=".csv,text/csv"
          required
          className="mt-2 block w-full text-sm"
        />
        <p className="mt-2 text-xs text-ink-muted">
          Expected columns: Date, Wine, Case Price and JSON_Data. Maximum 4 MB.
        </p>
      </div>
      {error && <p role="alert" className="text-sm text-accent">{error}</p>}
      <button
        type="submit"
        className="rounded bg-accent px-4 py-2 text-sm font-medium text-accent-ink"
      >
        Upload and preview
      </button>
    </form>
  );
}
