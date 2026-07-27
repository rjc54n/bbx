"use client";

import { ImportUploadForm } from "@/components/imports/ImportUploadForm";
import { BBR_MAX_FILE_BYTES } from "@/lib/cellar/bbrParser";
import { createBbrUploadTarget, processBbrUpload } from "./actions";

export function BbrUploadForm() {
  return (
    <ImportUploadForm
      heading="Upload BBR holdings"
      description="Upload the unmodified My Cellar CSV. Nothing changes in the accepted cellar until you review and accept it."
      fieldId="bbr-file"
      fieldLabel="BBR CSV"
      accept=".csv,text/csv,application/csv,application/vnd.ms-excel"
      maxBytes={BBR_MAX_FILE_BYTES}
      maxBytesLabel="4 MB"
      hint="Maximum 4 MB and 10,000 data rows. The source file is stored in the private cellar-imports bucket."
      createTarget={createBbrUploadTarget}
      processUpload={processBbrUpload}
    />
  );
}
