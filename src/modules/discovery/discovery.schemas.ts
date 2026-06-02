import { z } from 'zod';

export const feedQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const likeParamsSchema = z.object({
  id: z.string().uuid(),
});
