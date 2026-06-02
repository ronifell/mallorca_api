import { NextFunction, Request, Response } from 'express';
import { ZodSchema } from 'zod';

type Source = 'body' | 'query' | 'params';

export const validate =
  (schema: ZodSchema, source: Source = 'body') =>
  (req: Request, _res: Response, next: NextFunction) => {
    const parsed = schema.parse(req[source]);
    // Replace request value with parsed/typed version
    (req as unknown as Record<Source, unknown>)[source] = parsed;
    next();
  };
