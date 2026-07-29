"use client";
import { ImportUploadForm } from "@/components/imports/ImportUploadForm";
import { CELLARTRACKER_MAX_FILE_BYTES } from "@/lib/cellar/cellartrackerParser";
import { createCellarTrackerUploadTarget, processCellarTrackerUpload } from "./actions";
export function CellarTrackerUploadForm(){return <ImportUploadForm heading="Upload CellarTracker" description="Upload the complete My Cellar report. Review it before accepting the next active snapshot." fieldId="cellartracker-file" fieldLabel="CellarTracker CSV" accept=".csv,text/csv,application/csv" maxBytes={CELLARTRACKER_MAX_FILE_BYTES} maxBytesLabel="4 MB" hint="Windows-1252 My Cellar CSV, up to 10,000 rows. Stored privately." createTarget={createCellarTrackerUploadTarget} processUpload={processCellarTrackerUpload}/>}
