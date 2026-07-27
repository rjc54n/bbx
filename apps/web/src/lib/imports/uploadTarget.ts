import "server-only";
import type { OwnerContext } from "@/lib/auth/owner";

export type UploadTarget = {
  importId: string;
  objectPath: string;
  signedUrl: string;
  token: string;
};

/**
 * Creates a signed Storage upload URL scoped to `${userId}/${importId}/${filename}`
 * in the private cellar-imports bucket, so the browser can upload the file
 * directly to Storage instead of through the server action request body.
 */
export async function createSignedUploadTarget(
  supabase: OwnerContext["supabase"],
  userId: string,
  importId: string,
  filename: string,
): Promise<{ target: UploadTarget } | { error: string }> {
  const objectPath = `${userId}/${importId}/${filename}`;
  const { data, error } = await supabase.storage
    .from("cellar-imports")
    .createSignedUploadUrl(objectPath);
  if (error || !data) {
    return { error: "The upload could not be prepared. Try again." };
  }
  return {
    target: { importId, objectPath, signedUrl: data.signedUrl, token: data.token },
  };
}
