import { Request, Response } from 'express';
import { Unauthorized } from '../../utils/errors';
import { reportUserSchema, userIdParams } from './moderation.schemas';
import { adminModerationService, moderationService } from './moderation.service';

function userId(req: Request): string {
  if (!req.user) throw Unauthorized();
  return req.user.sub;
}

export const moderationController = {
  async block(req: Request, res: Response) {
    const { id } = userIdParams.parse(req.params);
    await moderationService.block(userId(req), id);
    res.status(204).send();
  },

  async unblock(req: Request, res: Response) {
    const { id } = userIdParams.parse(req.params);
    await moderationService.unblock(userId(req), id);
    res.status(204).send();
  },

  async listBlocks(req: Request, res: Response) {
    res.json({ blocks: await moderationService.listBlocks(userId(req)) });
  },

  async report(req: Request, res: Response) {
    const { id } = userIdParams.parse(req.params);
    const data = reportUserSchema.parse(req.body);
    await moderationService.report(userId(req), id, data);
    res.status(201).json({ ok: true });
  },
};

export const adminController = {
  async listReports(req: Request, res: Response) {
    const resolved = req.query.resolved === 'true'
      ? true
      : req.query.resolved === 'false'
        ? false
        : undefined;
    res.json({ reports: await adminModerationService.listReports({ resolved }) });
  },
  async resolveReport(req: Request, res: Response) {
    await adminModerationService.resolveReport(req.params.id);
    res.status(204).send();
  },
  async suspend(req: Request, res: Response) {
    await adminModerationService.setUserStatus(req.params.id, 'suspended');
    res.status(204).send();
  },
  async ban(req: Request, res: Response) {
    await adminModerationService.setUserStatus(req.params.id, 'banned');
    res.status(204).send();
  },
  async reinstate(req: Request, res: Response) {
    await adminModerationService.setUserStatus(req.params.id, 'active');
    res.status(204).send();
  },
};
