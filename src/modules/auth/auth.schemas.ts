import { z } from 'zod';

export const registerSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8).max(128),
  acceptedTerms: z.literal(true, {
    errorMap: () => ({ message: 'You must accept Terms and Privacy Policy (GDPR)' }),
  }),
  language: z.enum(['en', 'es']).optional(),
});

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

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
