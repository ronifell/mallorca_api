import { z } from 'zod';

export const reportUserSchema = z.object({
  reason: z.enum(['fake_profile', 'harassment', 'inappropriate_content', 'spam', 'other']),
  details: z.string().max(1000).optional(),
});

export const userIdParams = z.object({
  id: z.string().uuid(),
});
