import http from 'http';
import { createApp } from './app';
import { env } from './config/env';
import { initIO } from './sockets/io';
import { logger } from './utils/logger';
import { isFcmConfigured } from './modules/notifications/notifications.service';
import { subscriptionsService } from './modules/subscriptions/subscriptions.service';

async function main() {
  const app = createApp();
  const server = http.createServer(app);
  initIO(server);

  server.listen(env.port, '0.0.0.0', () => {
    logger.info('Server started', {
      port: env.port,
      env: env.nodeEnv,
      fcmConfigured: isFcmConfigured(),
      fcmProjectId: env.firebase.projectId || null,
      billingMockEnabled: env.billing.allowMock,
      googlePlayValidationConfigured: Boolean(
        env.googlePlay.serviceAccountJson && env.googlePlay.packageName,
      ),
    });
    if (!isFcmConfigured()) {
      logger.warn(
        'FCM not configured at startup — chat push will not work until FIREBASE_* is set in Backend/.env and the process is restarted (pm2 restart mallorca-api)',
      );
    }
  });

  // Lightweight scheduler for subscription expiry. In production prefer a
  // dedicated worker / external cron, but this guarantees premium revocation
  // happens even in single-instance deployments (Railway / Render / DO).
  setInterval(async () => {
    try {
      const expired = await subscriptionsService.expireDue();
      if (expired > 0) logger.info('Subscriptions expired', { count: expired });
    } catch (e) {
      logger.error('Subscription expiry job failed', {
        err: e instanceof Error ? e.message : String(e),
      });
    }
  }, 60 * 60 * 1000);

  const shutdown = (signal: string) => {
    logger.info('Shutting down', { signal });
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.error('Fatal startup error', {
    err: err instanceof Error ? { message: err.message, stack: err.stack } : err,
  });
  process.exit(1);
});
