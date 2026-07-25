type RecoveryError = {
  code?: string;
  status?: number;
};

const EMAIL_RATE_LIMIT_CODES = new Set([
  "email_rate_limit_exceeded",
  "over_email_send_rate_limit",
]);

export function passwordRecoveryErrorMessage(error: RecoveryError): string {
  if (
    error.status === 429
    || (error.code !== undefined && EMAIL_RATE_LIMIT_CODES.has(error.code))
  ) {
    return "The authentication email limit has been reached. Wait one hour after the most recent email before trying again.";
  }

  return "The password email could not be sent. Check the address and try again later.";
}
