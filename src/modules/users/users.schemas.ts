import { z } from 'zod';

export const GENDER_VALUES = [
  'male',
  'female',
  'non_binary',
  'gender_fluid',
  'other',
  'prefer_not_to_say',
] as const;

export const INTEREST_SELECTION_VALUES = ['men', 'women', 'everyone'] as const;

export const RELATIONSHIP_GOAL_VALUES = [
  'love',
  'friendship',
  'chat',
  'casual',
  'serious',
  'long_term',
] as const;

export const updateProfileSchema = z
  .object({
    firstName: z.string().min(1).max(50).optional(),
    birthDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
      .optional(),
    gender: z.enum(GENDER_VALUES).optional(),
    /** Legacy single-value preference (kept for backwards compat). */
    interestedIn: z.enum(['men', 'women', 'both']).optional(),
    /** New multi-select preference: "Men", "Women", "Everyone". */
    interestSelections: z
      .array(z.enum(INTEREST_SELECTION_VALUES))
      .min(1)
      .max(3)
      .optional(),
    /** Multi-select relationship goal preference. */
    relationshipGoals: z
      .array(z.enum(RELATIONSHIP_GOAL_VALUES))
      .max(RELATIONSHIP_GOAL_VALUES.length)
      .optional(),
    minAge: z.number().int().min(18).max(99).optional(),
    maxAge: z.number().int().min(18).max(99).optional(),
    city: z.string().min(1).max(80).optional(),
    bio: z.string().max(500).optional(),
    languages: z.array(z.string().min(2).max(40)).max(20).optional(),
    appLanguage: z.enum(['en', 'es']).optional(),
  })
  .refine(
    (v) => v.minAge === undefined || v.maxAge === undefined || v.minAge <= v.maxAge,
    { message: 'minAge must be <= maxAge' },
  );

export const reorderPhotosSchema = z.object({
  order: z.array(z.string().uuid()).min(1).max(6),
});

export const updateFcmTokenSchema = z.object({
  fcmToken: z.string().min(10).max(500),
});

export const updateNotificationSettingsSchema = z.object({
  matchesEnabled: z.boolean().optional(),
  messagesEnabled: z.boolean().optional(),
  subscriptionEnabled: z.boolean().optional(),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
