import { Request, Response } from 'express';
import { Unauthorized } from '../../utils/errors';
import { requestPublicOrigin } from '../../utils/request';
import {
  reorderPhotosSchema,
  updateFcmTokenSchema,
  updateNotificationSettingsSchema,
  updateProfileSchema,
} from './users.schemas';
import { usersService } from './users.service';

function userId(req: Request): string {
  if (!req.user) throw Unauthorized();
  return req.user.sub;
}

export const usersController = {
  async me(req: Request, res: Response) {
    res.json(await usersService.getMyProfile(userId(req)));
  },

  async updateMe(req: Request, res: Response) {
    const data = updateProfileSchema.parse(req.body);
    res.json(await usersService.updateProfile(userId(req), data));
  },

  async uploadPhoto(req: Request, res: Response) {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'No file uploaded' } });
      return;
    }
    res.status(201).json(
      await usersService.uploadPhoto(
        userId(req),
        file.buffer,
        file.mimetype,
        requestPublicOrigin(req),
      ),
    );
  },

  async deletePhoto(req: Request, res: Response) {
    await usersService.deletePhoto(userId(req), req.params.id);
    res.status(204).send();
  },

  async reorderPhotos(req: Request, res: Response) {
    const data = reorderPhotosSchema.parse(req.body);
    await usersService.reorderPhotos(userId(req), data.order);
    res.status(204).send();
  },

  async deleteAccount(req: Request, res: Response) {
    await usersService.deleteAccount(userId(req));
    res.status(204).send();
  },

  async exportData(req: Request, res: Response) {
    res.json(await usersService.exportData(userId(req)));
  },

  async updateFcm(req: Request, res: Response) {
    const data = updateFcmTokenSchema.parse(req.body);
    await usersService.updateFcmToken(userId(req), data.fcmToken);
    res.status(204).send();
  },

  async updateNotificationSettings(req: Request, res: Response) {
    const data = updateNotificationSettingsSchema.parse(req.body);
    await usersService.updateNotificationSettings(userId(req), data);
    res.status(204).send();
  },
};
