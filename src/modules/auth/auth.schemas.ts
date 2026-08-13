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
    en: 'You must agree to both the Terms of Service and the Privacy Policy.',
    es: 'Debes aceptar tanto los Términos de Servicio como la Política de Privacidad.',
  },
  resetCode: {
    en: 'The code must be 6 digits.',
    es: 'El código debe tener 6 dígitos.',
  },
  invalidEmail: {
    en: 'Invalid email',
    es: 'Introduce un correo electrónico válido.',
  },
  passwordMin: {
    en: 'String must contain at least 8 character(s)',
    es: 'La contraseña debe tener al menos 8 caracteres.',
  },
  passwordRequired: {
    en: 'String must contain at least 1 character(s)',
    es: 'Introduce tu contraseña.',
  },
} as const;

/** Zod field helpers — English kept as Zod-stable keys that the app maps via i18n. */
const emailField = z
  .string({ required_error: CONSENT.invalidEmail.en })
  .email({ message: CONSENT.invalidEmail.en })
  .max(254);
const passwordMin8 = z
  .string({ required_error: CONSENT.passwordMin.en })
  .min(8, { message: CONSENT.passwordMin.en })
  .max(128);
const passwordRequired = z
  .string({ required_error: CONSENT.passwordRequired.en })
  .min(1, { message: CONSENT.passwordRequired.en })
  .max(128);

export const registerSchema = z
  .object({
    email: emailField,
    password: passwordMin8,
    // Backwards compat: older clients send `acceptedTerms`. New clients send the
    // two separate checkboxes — both required.
    acceptedTerms: z.boolean().optional(),
    acceptedPrivacy: z.boolean().optional(),
    language: appLanguageSchema,
  })
  .superRefine((v, ctx) => {
    const lang = resolveLang(v.language);
    const hasBoth = v.acceptedTerms === true && v.acceptedPrivacy === true;
    if (hasBoth) return;

    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: CONSENT.both[lang],
      path: ['acceptedPrivacy'],
    });
  });

export const loginSchema = z.object({
  email: emailField,
  password: passwordRequired,
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(10),
});

export const forgotPasswordSchema = z.object({
  email: emailField,
});

export const resetPasswordSchema = z.object({
  email: emailField,
  code: z.string().regex(/^\d{6}$/, CONSENT.resetCode.en),
  password: passwordMin8,
});

export const verifyEmailSchema = z.object({
  token: z.string().min(10),
});

export const resendVerificationSchema = z.object({
  email: emailField,
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
