export type PasswordResetRequestState = {
  error: string | null;
  sent: boolean;
};

export const initialPasswordResetRequestState: PasswordResetRequestState = {
  error: null,
  sent: false,
};
