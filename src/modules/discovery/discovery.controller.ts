import { Request, Response } from 'express';
import { Unauthorized } from '../../utils/errors';
import { feedQuerySchema, likeParamsSchema } from './discovery.schemas';
import { discoveryService } from './discovery.service';
import { emitLikeEvent, emitMatchEvents, emitSuperLikeEvent } from '../matches/matches.realtime';
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
    const senderId = userId(req);
    const { id: targetId } = likeParamsSchema.parse(req.params);
    const result = await discoveryService.like(senderId, targetId);
    if (result.matched && result.matchId) {
      // Fire & forget: push notification + real-time socket emit. Neither
      // blocks the HTTP response so latency stays tight.
      void notificationsService.notifyNewMatch(senderId, targetId);
      void emitMatchEvents(senderId, targetId, result.matchId);
    } else if (result.isNewLike) {
      void notificationsService.notifyNewLike(targetId, senderId);
      void emitLikeEvent(targetId, senderId);
    }
    res.json(result);
  },

  async superLike(req: Request, res: Response) {
    const senderId = userId(req);
    const { id: targetId } = likeParamsSchema.parse(req.params);
    const result = await discoveryService.superLike(senderId, targetId);
    if (result.matched && result.matchId) {
      void notificationsService.notifyNewMatch(senderId, targetId);
      void emitMatchEvents(senderId, targetId, result.matchId);
    } else if (result.isNewSuperLike) {
      void notificationsService.notifySuperLike(targetId, senderId);
      void emitSuperLikeEvent(targetId, senderId);
    }
    res.json(result);
  },

  async superLikeQuota(req: Request, res: Response) {
    const quota = await discoveryService.getSuperLikeQuota(userId(req));
    res.json(quota);
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
