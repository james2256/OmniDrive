import { describe, it, expect } from 'vitest';
import {
  AppError,
  NotFoundError,
  ForbiddenError,
  ConflictError,
  ValidationError,
  AuthError,
  UpstreamError,
} from '../src/lib/errors';

describe('AppError', () => {
  it('carries the given status and message', () => {
    const err = new AppError(418, "I'm a teapot");
    expect(err.status).toBe(418);
    expect(err.message).toBe("I'm a teapot");
  });

  it('has name "AppError"', () => {
    expect(new AppError(500, 'boom').name).toBe('AppError');
  });

  it('extends Error', () => {
    const err = new AppError(400, 'bad');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AppError);
  });

  it('toString renders the name + message', () => {
    const err = new AppError(500, 'kaboom');
    expect(err.toString()).toContain('AppError');
    expect(err.toString()).toContain('kaboom');
  });
});

describe('NotFoundError', () => {
  it('defaults to status 404 and message "Not found"', () => {
    const err = new NotFoundError();
    expect(err.status).toBe(404);
    expect(err.message).toBe('Not found');
    expect(err.name).toBe('NotFoundError');
  });

  it('accepts a custom message', () => {
    const err = new NotFoundError('File not found');
    expect(err.message).toBe('File not found');
    expect(err.status).toBe(404);
  });

  it('extends AppError', () => {
    expect(new NotFoundError()).toBeInstanceOf(AppError);
  });
});

describe('ForbiddenError', () => {
  it('defaults to status 403 and message "Forbidden"', () => {
    const err = new ForbiddenError();
    expect(err.status).toBe(403);
    expect(err.message).toBe('Forbidden');
    expect(err.name).toBe('ForbiddenError');
  });

  it('accepts a custom message', () => {
    expect(new ForbiddenError('nope').message).toBe('nope');
  });
});

describe('ConflictError', () => {
  it('defaults to status 409 and message "Conflict"', () => {
    const err = new ConflictError();
    expect(err.status).toBe(409);
    expect(err.message).toBe('Conflict');
    expect(err.name).toBe('ConflictError');
  });

  it('extends AppError', () => {
    expect(new ConflictError()).toBeInstanceOf(AppError);
  });

  it('accepts a custom message while keeping 409', () => {
    const err = new ConflictError('Email already registered');
    expect(err.message).toBe('Email already registered');
    expect(err.status).toBe(409);
  });
});

describe('ValidationError', () => {
  it('defaults to status 400 and message "Validation failed"', () => {
    const err = new ValidationError();
    expect(err.status).toBe(400);
    expect(err.message).toBe('Validation failed');
    expect(err.name).toBe('ValidationError');
  });

  it('extends AppError', () => {
    expect(new ValidationError()).toBeInstanceOf(AppError);
  });
});

describe('AuthError', () => {
  it('defaults to status 401 and message "Unauthorized"', () => {
    const err = new AuthError();
    expect(err.status).toBe(401);
    expect(err.message).toBe('Unauthorized');
    expect(err.name).toBe('AuthError');
  });

  it('extends AppError', () => {
    expect(new AuthError()).toBeInstanceOf(AppError);
  });

  it('accepts a custom message', () => {
    expect(new AuthError('Token expired').message).toBe('Token expired');
  });
});

describe('UpstreamError', () => {
  it('always uses status 502', () => {
    const err = new UpstreamError('Drive 500');
    expect(err.status).toBe(502);
    expect(err.message).toBe('Drive 500');
    expect(err.name).toBe('UpstreamError');
  });

  it('does NOT take a custom status (always 502)', () => {
    expect(new UpstreamError('fail').status).toBe(502);
    expect(new UpstreamError('other').status).toBe(502);
  });

  it('extends AppError', () => {
    expect(new UpstreamError('x')).toBeInstanceOf(AppError);
  });
});

describe('error hierarchy', () => {
  it('every subclass extends AppError and Error', () => {
    for (const err of [
      new NotFoundError(),
      new ForbiddenError(),
      new ConflictError(),
      new ValidationError(),
      new AuthError(),
      new UpstreamError('x'),
    ]) {
      expect(err).toBeInstanceOf(AppError);
      expect(err).toBeInstanceOf(Error);
    }
  });
});
