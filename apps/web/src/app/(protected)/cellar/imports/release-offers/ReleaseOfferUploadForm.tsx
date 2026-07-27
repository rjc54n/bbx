"use client";

import { createClientSupabaseClient } from "@/lib/supabase/client";
import { ImportUploadForm, type ProgressSnapshot } from "@/components/imports/ImportUploadForm";
import { RELEASE_OFFER_MAX_FILE_BYTES } from "@/lib/releaseOffers/parser";
import { createReleaseOfferUploadTarget, processReleaseOfferUpload } from "./actions";

async function pollReleaseOfferProgress(importId: string): Promise<ProgressSnapshot> {
  const supabase = createClientSupabaseClient();
  const [{ count: rowCount }, { count: priceCount }] = await Promise.all([
    supabase
      .from("release_offer_source_rows")
      .select("*", { count: "exact", head: true })
      .eq("import_id", importId),
    supabase
      .from("release_offer_prices")
      .select("*", { count: "exact", head: true })
      .eq("import_id", importId),
  ]);
  const rows = rowCount ?? 0;
  const prices = priceCount ?? 0;
  if (rows === 0 && prices === 0) return { label: "Starting…" };
  return {
    label: `${rows.toLocaleString()} rows staged · ${prices.toLocaleString()} price fragments staged`,
  };
}

export function ReleaseOfferUploadForm() {
  return (
    <ImportUploadForm
      heading="Historic release-offer CSV"
      description="Upload the historic BBR offers file. Prices are split by format and remain pending unless the product, format and in-bond basis are exact."
      fieldId="release-offer-file"
      fieldLabel="Historic release-offer CSV"
      accept=".csv,text/csv"
      maxBytes={RELEASE_OFFER_MAX_FILE_BYTES}
      maxBytesLabel="10 MB"
      hint="Expected columns: Date, Wine, Case Price, JSON_Data, parent_sku, BBR_URL (the legacy 4-column form is also accepted). Maximum 10 MB."
      createTarget={createReleaseOfferUploadTarget}
      processUpload={processReleaseOfferUpload}
      onPoll={pollReleaseOfferProgress}
    />
  );
}
