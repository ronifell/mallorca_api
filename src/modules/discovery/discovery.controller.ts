import { Request, Response } from 'express';
import { Unauthorized } from '../../utils/errors';
import { feedQuerySchema, likeParamsSchema } from './discovery.schemas';
import { discoveryService } from './discovery.service';
import { notificationsService } from '../notifications/notifications.service';

function userId(req: Request): string {
  if (!req.user) throw Unauthorized();
  return req.user.sub;
}

export const discoveryController = {
  async feed(req: Request, res: Response) {
    const { limit } = feedQuerySchema.parse(req.query);
    const users = await discoveryService.getFeed(userId(req), limit);
    res.json({ users });
  },

  async like(req: Request, res: Response) {
    const { id } = likeParamsSchema.parse(req.params);
    const result = await discoveryService.like(userId(req), id);
    if (result.matched) {
      // Fire & forget: notify both users. We do not await to keep latency low.
      void notificationsService.notifyNewMatch(userId(req), id);
    }
    res.json(result);
  },

  async pass(req: Request, res: Response) {
    const { id } = likeParamsSchema.parse(req.params);
    await discoveryService.pass(userId(req), id);
    res.status(204).send();
  },

  async resetFeed(req: Request, res: Response) {
    await discoveryService.resetFeed(userId(req));
    res.status(204).send();
  },
};
