import http from 'http';
import { Server, Socket } from 'socket.io';
import { env } from '../config/env';
import { chatService } from '../modules/chat/chat.service';
import { logger } from '../utils/logger';
import { AccessTokenPayload, verifyAccessToken } from '../utils/jwt';

let io: Server | null = null;

export function getIO(): Server {
  if (!io) throw new Error('Socket.io not initialised. Call initIO(server) first.');
  return io;
}

interface AuthedSocket extends Socket {
  user?: AccessTokenPayload;
}

export function initIO(server: http.Server): Server {
  io = new Server(server, {
    cors: { origin: env.corsOrigin, credentials: true },
    pingInterval: 25_000,
    pingTimeout: 60_000,
  });

  io.use((socket: AuthedSocket, next) => {
    try {
      const token =
        (socket.handshake.auth?.token as string | undefined) ??
        (socket.handshake.headers.authorization?.startsWith('Bearer ')
          ? socket.handshake.headers.authorization.slice(7)
          : undefined);
      if (!token) return next(new Error('Missing auth token'));
      const payload = verifyAccessToken(token);
      socket.user = payload;
      next();
    } catch (e) {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket: AuthedSocket) => {
    const userId = socket.user?.sub;
    if (!userId) return socket.disconnect(true);

    socket.join(`user:${userId}`);
    logger.info('Socket connected', { userId, socketId: socket.id });

    socket.on('conversation:join', async (conversationId: string) => {
      const ctx = await chatService.loadConversation(conversationId);
      if (!ctx) return;
      if (!ctx.participants.includes(userId)) return;
      socket.join(`conversation:${conversationId}`);
      await chatService.markDelivered(userId, conversationId).catch(() => undefined);
    });

    socket.on('conversation:leave', (conversationId: string) => {
      socket.leave(`conversation:${conversationId}`);
    });

    socket.on(
      'typing',
      (payload: { conversationId: string; typing: boolean }) => {
        if (!payload?.conversationId) return;
        socket.to(`conversation:${payload.conversationId}`).emit('typing', {
          conversationId: payload.conversationId,
          userId,
          typing: !!payload.typing,
        });
      },
    );

    socket.on(
      'message:read',
      async (payload: { conversationId: string }) => {
        if (!payload?.conversationId) return;
        await chatService.markRead(userId, payload.conversationId).catch(() => undefined);
        socket.to(`conversation:${payload.conversationId}`).emit('message:read', {
          conversationId: payload.conversationId,
          readerId: userId,
        });
      },
    );

    socket.on('disconnect', (reason) => {
      logger.debug('Socket disconnected', { userId, socketId: socket.id, reason });
    });
  });

  return io;
}
