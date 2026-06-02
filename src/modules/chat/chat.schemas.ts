import { z } from 'zod';

export const sendMessageSchema = z.object({
  type: z.enum(['text', 'image']).default('text'),
  text: z.string().min(1).max(2000).optional(),
  imageUrl: z.string().url().optional(),
}).refine(
  (v) => (v.type === 'text' ? !!v.text : !!v.imageUrl),
  { message: 'Provide text for type=text or imageUrl for type=image' },
);

export const conversationParamsSchema = z.object({
  id: z.string().uuid(),
});

export const messagesQuerySchema = z.object({
  before: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
