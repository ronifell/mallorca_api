import rateLimit from 'express-rate-limit';
import type { Request } from 'express';
import { env } from '../config/env';

/** Session teardown endpoints should not consume the global rate-limit budget. */
function isSessionTeardownRequest(req: Request): boolean {
  const path = req.originalUrl.split('?')[0];
  return (
    (req.method === 'DELETE' && path === '/api/users/me/fcm-token') ||
    (req.method === 'POST' && path === '/api/auth/logout')
  );
}

export const globalLimiter = rateLimit({
  windowMs: env.rateLimit.windowMs,
  max: env.rateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  skip: isSessionTeardownRequest,
  message: {
    error: {
      code: 'TOO_MANY_REQUESTS',
      message: 'Has hecho demasiadas peticiones. Inténtalo más tarde.',
    },
  },
});

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      code: 'TOO_MANY_REQUESTS',
      message: 'Demasiados intentos de inicio de sesión. Espera unos minutos e inténtalo de nuevo.',
    },
  },
});
