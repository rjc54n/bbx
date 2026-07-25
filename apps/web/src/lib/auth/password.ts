export const MIN_PASSWORD_LENGTH = 14;
const MAX_PASSWORD_LENGTH = 256;

export type PasswordValidation =
  | { password: string; error: null }
  | { password: null; error: string };

export function validateNewPassword(
  passwordValue: FormDataEntryValue | null,
  confirmationValue: FormDataEntryValue | null,
): PasswordValidation {
  if (typeof passwordValue !== "string" || typeof confirmationValue !== "string") {
    return { password: null, error: "Enter and confirm the new password." };
  }
  if (passwordValue.length < MIN_PASSWORD_LENGTH) {
    return {
      password: null,
      error: `Use at least ${MIN_PASSWORD_LENGTH} characters.`,
    };
  }
  if (passwordValue.length > MAX_PASSWORD_LENGTH) {
    return {
      password: null,
      error: `Use no more than ${MAX_PASSWORD_LENGTH} characters.`,
    };
  }
  if (passwordValue !== confirmationValue) {
    return { password: null, error: "The passwords do not match." };
  }

  return { password: passwordValue, error: null };
}
