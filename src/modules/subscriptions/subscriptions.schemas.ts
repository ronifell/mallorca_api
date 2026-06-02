import { z } from 'zod';

export const validatePurchaseSchema = z.object({
  platform: z.enum(['google_play', 'app_store']),
  productId: z.string().min(1).max(120),
  purchaseToken: z.string().min(1),
});
