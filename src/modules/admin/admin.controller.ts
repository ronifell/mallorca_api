import { Request, Response } from 'express';
import { z } from 'zod';
import { BadRequest } from '../../utils/errors';
import { adminService } from './admin.service';

const uuidParam = z.object({ id: z.string().uuid() });

export const adminController = {
  async stats(_req: Request, res: Response) {
    res.json(await adminService.stats());
  },

  async listUsers(req: Request, res: Response) {
    const schema = z.object({
      q: z.string().trim().optional(),
      status: z.enum(['active', 'suspended', 'banned', 'deleted']).optional(),
      premium: z.enum(['true', 'false']).optional(),
      role: z.enum(['user', 'admin']).optional(),
      sort: z.enum(['recent', 'oldest', 'active']).optional(),
      page: z.coerce.number().int().min(1).optional(),
      pageSize: z.coerce.number().int().min(1).max(100).optional(),
    });
    const parsed = schema.parse(req.query);
    res.json(
      await adminService.listUsers({
        ...parsed,
        premium: parsed.premium === undefined ? undefined : parsed.premium === 'true',
      }),
    );
  },

  async userDetail(req: Request, res: Response) {
    const { id } = uuidParam.parse(req.params);
    res.json(await adminService.userDetail(id));
  },

  async setPremium(req: Request, res: Response) {
    const { id } = uuidParam.parse(req.params);
    const schema = z.object({
      grant: z.boolean(),
      days: z.number().int().min(1).max(3650).nullable().optional(),
    });
    const parsed = schema.parse(req.body);
    await adminService.setPremium(id, parsed.grant, parsed.days ?? null);
    res.status(204).send();
  },

  async setRole(req: Request, res: Response) {
    const { id } = uuidParam.parse(req.params);
    const schema = z.object({ role: z.enum(['user', 'admin']) });
    const { role } = schema.parse(req.body);
    await adminService.setRole(id, role);
    res.status(204).send();
  },

  async hardDelete(req: Request, res: Response) {
    const { id } = uuidParam.parse(req.params);
    if (req.user?.sub === id) throw BadRequest('You cannot delete your own admin account');
    await adminService.hardDelete(id);
    res.status(204).send();
  },

  async listSubscriptions(req: Request, res: Response) {
    const schema = z.object({
      status: z.enum(['active', 'expired', 'cancelled', 'grace']).optional(),
      page: z.coerce.number().int().min(1).optional(),
      pageSize: z.coerce.number().int().min(1).max(100).optional(),
    });
    const parsed = schema.parse(req.query);
    res.json(await adminService.listSubscriptions(parsed));
  },

  async me(req: Request, res: Response) {
    // Small helper endpoint used by the panel to validate an admin session.
    if (!req.user) return res.status(401).json({ error: { message: 'Unauthorized' } });
    res.json({
      id: req.user.sub,
      email: req.user.email,
      role: req.user.role,
    });
  },
};
