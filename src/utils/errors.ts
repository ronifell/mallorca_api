export class AppError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

export const BadRequest = (msg = 'Bad request', details?: unknown) =>
  new AppError(400, 'BAD_REQUEST', msg, details);

/**
 * Raised when user-authored text is rejected by the content filter. The
 * `category` is carried in `details` so clients can localise the message.
 */
export const ContentBlocked = (msg: string, category: string, field?: string) =>
  new AppError(400, 'CONTENT_BLOCKED', msg, { category, field });

export const Unauthorized = (msg = 'Unauthorized') =>
  new AppError(401, 'UNAUTHORIZED', msg);

export const Forbidden = (msg = 'Forbidden') =>
  new AppError(403, 'FORBIDDEN', msg);

export const NotFound = (msg = 'Not found') =>
  new AppError(404, 'NOT_FOUND', msg);

export const Conflict = (msg = 'Conflict') =>
  new AppError(409, 'CONFLICT', msg);

export const TooMany = (msg = 'Too many requests') =>
  new AppError(429, 'TOO_MANY_REQUESTS', msg);

export const ServerError = (msg = 'Internal server error') =>
  new AppError(500, 'SERVER_ERROR', msg);
