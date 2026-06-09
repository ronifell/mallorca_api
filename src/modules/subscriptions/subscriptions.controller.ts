import { Request, Response } from 'express';
import { Unauthorized } from '../../utils/errors';
import { validatePurchaseSchema } from './subscriptions.schemas';
import { subscriptionsService } from './subscriptions.service';

function userId(req: Request): string {
  if (!req.user) throw Unauthorized();
  return req.user.sub;
}

export const subscriptionsController = {
  async plans(_req: Request, res: Response) {
    res.json({
      plans: [
        {
          id: 'monthly_premium',
          name: 'Premium Mensual',
          description: 'Suscripción mensual auto-renovable.',
          price: '€4.99',
          period: 'month',
          autoRenewing: true,
          managedBy: 'google_play',
        },
        {
          id: 'annual_premium',
          name: 'Premium Anual',
          description: 'Suscripción anual auto-renovable.',
          price: '€29.99',
          period: 'year',
          autoRenewing: true,
          managedBy: 'google_play',
        },
      ],
    });
  },

  async status(req: Request, res: Response) {
    res.json(await subscriptionsService.getStatus(userId(req)));
  },

  async validatePurchase(req: Request, res: Response) {
    const data = validatePurchaseSchema.parse(req.body);
    const result = await subscriptionsService.validateAndActivate(userId(req), data);
    res.status(201).json(result);
  },
};
