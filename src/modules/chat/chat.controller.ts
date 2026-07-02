import { Request, Response } from 'express';
import { requestPublicOrigin } from '../../utils/request';
import { Unauthorized } from '../../utils/errors';
import { notificationsService } from '../notifications/notifications.service';
import {
  conversationParamsSchema,
  messagesQuerySchema,
  sendMessageSchema,
} from './chat.schemas';
import { chatService } from './chat.service';
import { getIO } from '../../sockets/io';
import { query } from '../../config/database';

function userId(req: Request): string {
  if (!req.user) throw Unauthorized();
  return req.user.sub;
}

export const chatController = {
  async createForMatch(req: Request, res: Response) {
    const result = await chatService.getOrCreateConversationForMatch(
      userId(req),
      req.params.matchId,
    );
    res.status(201).json(result);
  },

  async send(req: Request, res: Response) {
    const { id } = conversationParamsSchema.parse(req.params);
    const data = sendMessageSchema.parse(req.body);
    const msg = await chatService.sendMessage(userId(req), id, data);

    // Real-time delivery to connected clients in the conversation room.
    getIO().to(`conversation:${id}`).emit('message:new', msg);
    // Push the message to both participants' user rooms (covers clients not in the room).
    getIO().to(`user:${msg.receiverId}`).emit('message:new', msg);
    getIO().to(`user:${msg.senderId}`).emit('message:new', msg);

    // Fire & forget push notification.
    const nameR = await query<{ first_name: string | null }>(
      'SELECT first_name FROM users WHERE id = $1',
      [msg.senderId],
    );
    void notificationsService.notifyNewMessage(
      msg.receiverId,
      nameR.rows[0]?.first_name ?? 'Citas Mallorca',
      msg.conversationId,
    );

    res.status(201).json(msg);
  },

  async list(req: Request, res: Response) {
    const { id } = conversationParamsSchema.parse(req.params);
    const q = messagesQuerySchema.parse(req.query);
    res.json({ messages: await chatService.listMessages(userId(req), id, q) });
  },

  async uploadImage(req: Request, res: Response) {
    if (!req.file) {
      res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'No file uploaded' } });
      return;
    }
    const { id } = conversationParamsSchema.parse(req.params);
    const result = await chatService.uploadImage(
      userId(req),
      id,
      req.file.buffer,
      req.file.mimetype,
      requestPublicOrigin(req),
    );
    res.status(201).json(result);
  },

  async uploadAudio(req: Request, res: Response) {
    if (!req.file) {
      res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'No file uploaded' } });
      return;
    }
    const { id } = conversationParamsSchema.parse(req.params);
    const result = await chatService.uploadAudio(
      userId(req),
      id,
      req.file.buffer,
      req.file.mimetype,
      requestPublicOrigin(req),
    );
    res.status(201).json(result);
  },

  async markRead(req: Request, res: Response) {
    const { id } = conversationParamsSchema.parse(req.params);
    await chatService.markRead(userId(req), id);
    getIO().to(`conversation:${id}`).emit('message:read', { conversationId: id, readerId: userId(req) });
    res.status(204).send();
  },
};
