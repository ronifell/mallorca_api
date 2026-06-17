import { Request, Response } from 'express';
import { Unauthorized } from '../../utils/errors';
import { feedQuerySchema, likeParamsSchema } from './discovery.schemas';
import { discoveryService } from './discovery.service';
import { emitMatchEvents } from '../matches/matches.realtime';
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
    if (result.matched && result.matchId) {
      // Fire & forget: push notification + real-time socket emit. Neither
      // blocks the HTTP response so latency stays tight.
      void notificationsService.notifyNewMatch(userId(req), id);
      void emitMatchEvents(userId(req), id, result.matchId);
    }
    res.json(result);
  },

  async pass(req: Request, res: Response) {
    const { id } = likeParamsSchema.parse(req.params);
    await discoveryService.pass(userId(req), id);
    res.status(204).send();
  },

  async sentLikes(req: Request, res: Response) {
    const users = await discoveryService.getSentLikes(userId(req));
    res.json({ users });
  },

  async receivedLikes(req: Request, res: Response) {
    const users = await discoveryService.getReceivedLikes(userId(req));
    res.json({ users });
  },

  async unlike(req: Request, res: Response) {
    const { id } = likeParamsSchema.parse(req.params);
    await discoveryService.unlike(userId(req), id);
    res.status(204).send();
  },

  async resetFeed(req: Request, res: Response) {
    await discoveryService.resetFeed(userId(req));
    res.status(204).send();
  },
};
