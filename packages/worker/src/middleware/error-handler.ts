import type { Context, Next } from 'hono';

export async function errorHandler(c: Context, next: Next) {
  try {
    await next();
  } catch (err) {
    console.error('Unhandled error:', err);

    const status = err instanceof AppError ? err.status : 500;
    const message = err instanceof AppError ? err.message : 'Internal server error';

    return c.json({ error: message }, status as any);
  }
}

export class AppError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
    this.name = 'AppError';
  }
}
