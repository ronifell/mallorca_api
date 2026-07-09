import { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../utils/errors';
import { logger } from '../utils/logger';

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
) {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid request payload',
        details: err.flatten(),
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
        message: 'Your session is no longer valid. Please sign out and sign in again.',
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
    error: { code: 'SERVER_ERROR', message: 'Internal server error' },
  });
}
