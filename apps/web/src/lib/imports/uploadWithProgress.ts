/**
 * Uploads a file directly to a Supabase Storage signed upload URL using XHR,
 * so real upload-progress events are available (fetch-based upload methods,
 * including the storage-js client, do not expose upload progress).
 */
export function uploadFileWithProgress(
  signedUrl: string,
  file: File,
  onProgress: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", signedUrl, true);
    xhr.setRequestHeader("x-upsert", "false");
    xhr.setRequestHeader("cache-control", "3600");
    xhr.setRequestHeader("content-type", file.type || "text/csv");
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (anonKey) xhr.setRequestHeader("apikey", anonKey);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(1);
        resolve();
      } else {
        reject(new Error(`The upload failed (status ${xhr.status}).`));
      }
    };
    xhr.onerror = () => reject(new Error("The upload failed."));
    xhr.onabort = () => reject(new Error("The upload was cancelled."));

    xhr.send(file);
  });
}
