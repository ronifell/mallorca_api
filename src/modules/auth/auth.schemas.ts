import { z } from 'zod';

type AppLang = 'en' | 'es';

function resolveLang(language: unknown): AppLang {
  if (typeof language === 'string' && language.toLowerCase().startsWith('en')) return 'en';
  return 'es';
}

/** Accept `en` / `es` / `en-US` etc. and normalize for storage. */
const appLanguageSchema = z
  .string()
  .optional()
  .transform((v): AppLang | undefined => {
    if (!v) return undefined;
    const lower = v.toLowerCase();
    if (lower.startsWith('en')) return 'en';
    if (lower.startsWith('es')) return 'es';
    return undefined;
  });

const CONSENT = {
  terms: {
    en: 'You must accept the Terms and Conditions.',
    es: 'Debes aceptar los Términos y Condiciones.',
  },
  privacy: {
    en: 'You must accept the Privacy Policy.',
    es: 'Debes aceptar la Política de Privacidad.',
  },
  both: {
    en: 'You must accept the Terms and Conditions and Privacy Policy.',
    es: 'Debes aceptar los Términos y la Política de Privacidad.',
  },
  resetCode: {
    en: 'The code must be 6 digits.',
    es: 'El código debe tener 6 dígitos.',
  },
} as const;

export const registerSchema = z
  .object({
    email: z.string().email().max(254),
    password: z.string().min(8).max(128),
    // Backwards compat: older clients send `acceptedTerms`. New clients send the
    // two separate checkboxes — both required.
    acceptedTerms: z.boolean().optional(),
    acceptedPrivacy: z.boolean().optional(),
    language: appLanguageSchema,
  })
  .superRefine((v, ctx) => {
    const lang = resolveLang(v.language);
    const ok =
      (v.acceptedTerms === true && v.acceptedPrivacy === true) ||
      (v.acceptedTerms === true && v.acceptedPrivacy === undefined);
    if (ok) return;

    if (v.acceptedTerms !== true && v.acceptedPrivacy !== true) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: CONSENT.both[lang],
        path: ['acceptedPrivacy'],
      });
      return;
    }
    if (v.acceptedTerms !== true) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: CONSENT.terms[lang],
        path: ['acceptedTerms'],
      });
    }
    if (v.acceptedPrivacy !== true) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: CONSENT.privacy[lang],
        path: ['acceptedPrivacy'],
      });
    }
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
  email: z.string().email().max(254),
  code: z.string().regex(/^\d{6}$/, CONSENT.resetCode.es),
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
  language: appLanguageSchema,
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;
export type ResendVerificationInput = z.infer<typeof resendVerificationSchema>;
export type GoogleLoginInput = z.infer<typeof googleLoginSchema>;
