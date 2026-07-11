import { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../utils/errors';
import { logger } from '../utils/logger';

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Ruta no encontrada.' } });
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
) {
  if (err instanceof ZodError) {
    // Surface the first field-specific message when possible so users see a
    // friendly Spanish string instead of a generic "invalid payload".
    const flat = err.flatten();
    const firstFieldMessage =
      Object.values(flat.fieldErrors).flat().find((m): m is string => typeof m === 'string' && m.length > 0) ??
      flat.formErrors[0] ??
      'La solicitud no es válida. Revisa los datos e inténtalo de nuevo.';
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: firstFieldMessage,
        details: flat,
      },
    });
    return;
  }

  if (err instanceof AppError) {
    res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details },
    });
    return;
  }

  const pgCode = (err as { code?: string }).code;
  if (pgCode === '23503') {
    res.status(401).json({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Tu sesión ya no es válida. Cierra sesión y vuelve a iniciarla.',
      },
    });
    return;
  }

  logger.error('Unhandled error', {
    path: req.path,
    method: req.method,
    err: err instanceof Error ? { message: err.message, stack: err.stack } : err,
  });

  res.status(500).json({
    error: { code: 'SERVER_ERROR', message: 'Se ha producido un error interno en el servidor.' },
  });
}
