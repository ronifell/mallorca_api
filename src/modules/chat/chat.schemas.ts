import { z } from 'zod';

export const sendMessageSchema = z.object({
  type: z.enum(['text', 'image', 'audio']).default('text'),
  text: z.string().min(1).max(2000).optional(),
  imageUrl: z.string().url().optional(),
  audioUrl: z.string().url().optional(),
  audioDuration: z.number().positive().max(60 * 5).optional(),
}).refine(
  (v) => {
    if (v.type === 'text') return !!v.text;
    if (v.type === 'image') return !!v.imageUrl;
    if (v.type === 'audio') return !!v.audioUrl;
    return false;
  },
  { message: 'Provide text/imageUrl/audioUrl that matches the message type' },
);

export const conversationParamsSchema = z.object({
  id: z.string().uuid(),
});

export const messagesQuerySchema = z.object({
  before: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
