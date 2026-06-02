import { NextFunction, Request, Response } from 'express';
import { Forbidden, Unauthorized } from '../utils/errors';
import { AccessTokenPayload, verifyAccessToken } from '../utils/jwt';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AccessTokenPayload;
    }
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    throw Unauthorized('Missing or malformed Authorization header');
  }
  const token = header.slice('Bearer '.length).trim();
  try {
    const payload = verifyAccessToken(token);
    req.user = payload;
    next();
  } catch {
    throw Unauthorized('Invalid or expired access token');
  }
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) throw Unauthorized();
  if (req.user.role !== 'admin') throw Forbidden('Admin access required');
  next();
}

export function requirePremium(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) throw Unauthorized();
  if (!req.user.premium) throw Forbidden('Premium subscription required');
  next();
}
