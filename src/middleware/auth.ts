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
    throw Unauthorized('Falta la cabecera de autorización o tiene un formato incorrecto.');
  }
  const token = header.slice('Bearer '.length).trim();
  try {
    const payload = verifyAccessToken(token);
    req.user = payload;
    next();
  } catch {
    throw Unauthorized('Tu sesión ha caducado. Inicia sesión de nuevo.');
  }
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) throw Unauthorized();
  if (req.user.role !== 'admin') throw Forbidden('Se requieren permisos de administrador.');
  next();
}

export function requirePremium(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) throw Unauthorized();
  if (!req.user.premium) throw Forbidden('Se necesita una suscripción Premium.');
  next();
}
