import { Request, Response } from 'express';
import { env } from '../../config/env';
import { Unauthorized } from '../../utils/errors';
import { validatePurchaseSchema } from './subscriptions.schemas';
import { subscriptionsService } from './subscriptions.service';

function userId(req: Request): string {
  if (!req.user) throw Unauthorized();
  return req.user.sub;
}

export const subscriptionsController = {
  /**
   * Public billing configuration for the mobile app. When `mockEnabled` is
   * true the app should skip the native store purchase sheet and complete
   * the flow with a mock token — the backend validator will accept it as
   * long as `BILLING_ALLOW_MOCK=true`. This lets the whole Premium flow be
   * exercised end-to-end without a real Google Play charge.
   */
  async config(_req: Request, res: Response) {
    const googlePlayConfigured = Boolean(
      env.googlePlay.serviceAccountJson && env.googlePlay.packageName,
    );
    res.json({
      mockEnabled: env.billing.allowMock,
      googlePlayConfigured,
    });
  },

  async plans(_req: Request, res: Response) {
    res.json({
      plans: [
        {
          id: 'monthly_premium',
          name: 'Premium Mensual',
          description: 'Suscripción mensual auto-renovable.',
          price: '€5.99',
          period: 'month',
          autoRenewing: true,
          managedBy: 'google_play',
        },
        {
          id: 'annual_premium',
          name: 'Premium Anual',
          description: 'Suscripción anual auto-renovable.',
          price: '€35.99',
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
