import cors from 'cors';
import express, { Application } from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import path from 'path';
import { env, isProd } from './config/env';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { globalLimiter } from './middleware/rateLimit';

import authRoutes from './modules/auth/auth.routes';
import chatRoutes from './modules/chat/chat.routes';
import discoveryRoutes from './modules/discovery/discovery.routes';
import matchesRoutes from './modules/matches/matches.routes';
import moderationRoutes, { adminRouter } from './modules/moderation/moderation.routes';
import subscriptionsRoutes from './modules/subscriptions/subscriptions.routes';
import usersRoutes from './modules/users/users.routes';

export function createApp(): Application {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cors({ origin: env.corsOrigin, credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  app.use(morgan(isProd ? 'combined' : 'dev'));

  // Local-only uploads served as static for dev/storage fallback.
  app.use('/uploads', express.static(path.join(process.cwd(), 'uploads'), {
    maxAge: '7d',
    setHeaders: (res) => res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin'),
  }));

  app.get('/health', (_req, res) => {
    res.json({ ok: true, env: env.nodeEnv, time: new Date().toISOString() });
  });

  app.use(globalLimiter);

  app.use('/api/auth', authRoutes);
  app.use('/api/users', usersRoutes);
  app.use('/api/discovery', discoveryRoutes);
  app.use('/api/matches', matchesRoutes);
  app.use('/api/chat', chatRoutes);
  app.use('/api/subscriptions', subscriptionsRoutes);
  app.use('/api/moderation', moderationRoutes);
  app.use('/api/admin', adminRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
