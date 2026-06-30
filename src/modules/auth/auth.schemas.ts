import { z } from 'zod';

export const registerSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8).max(128),
  // Backwards compat: older clients send `acceptedTerms`. New clients send the
  // two separate checkboxes — both required.
  acceptedTerms: z
    .literal(true, {
      errorMap: () => ({ message: 'You must accept the Terms and Conditions' }),
    })
    .optional(),
  acceptedPrivacy: z
    .literal(true, {
      errorMap: () => ({ message: 'You must accept the Privacy Policy' }),
    })
    .optional(),
  language: z.enum(['en', 'es']).optional(),
}).refine(
  (v) =>
    // At least one of the legacy / new flags must be true. The two-checkbox
    // contract requires both new fields; legacy clients must keep sending
    // `acceptedTerms`.
    (v.acceptedTerms === true && v.acceptedPrivacy === true) ||
    (v.acceptedTerms === true && v.acceptedPrivacy === undefined),
  {
    message: 'You must accept the Terms and the Privacy Policy',
    path: ['acceptedPrivacy'],
  },
);

export const loginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(128),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(10),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email().max(254),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(10),
  password: z.string().min(8).max(128),
});

export const verifyEmailSchema = z.object({
  token: z.string().min(10),
});

export const resendVerificationSchema = z.object({
  email: z.string().email().max(254),
});

export const googleLoginSchema = z.object({
  idToken: z.string().min(10),
  acceptedTerms: z.literal(true).optional(),
  acceptedPrivacy: z.literal(true).optional(),
  language: z.enum(['en', 'es']).optional(),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;
export type ResendVerificationInput = z.infer<typeof resendVerificationSchema>;
export type GoogleLoginInput = z.infer<typeof googleLoginSchema>;
