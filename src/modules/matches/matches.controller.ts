import { Request, Response } from 'express';
import { Unauthorized } from '../../utils/errors';
import { matchesService } from './matches.service';

function userId(req: Request): string {
  if (!req.user) throw Unauthorized();
  return req.user.sub;
}

export const matchesController = {
  async list(req: Request, res: Response) {
    res.json({ matches: await matchesService.list(userId(req)) });
  },
  async unmatch(req: Request, res: Response) {
    await matchesService.unmatch(userId(req), req.params.id);
    res.status(204).send();
  },
};
