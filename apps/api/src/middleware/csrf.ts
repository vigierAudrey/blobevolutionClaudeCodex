import { Request, Response, NextFunction } from 'express';
import csrf from 'csrf';

// Create CSRF instance with secure configuration
const csrfTokens = new csrf();

// CSRF protection middleware
export function csrfProtection(req: Request, res: Response, next: NextFunction) {
  // Skip CSRF for safe methods (GET, HEAD, OPTIONS)
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }

  // Skip CSRF for health check endpoint
  if (req.path === '/health') {
    return next();
  }

  // Get the secret from session (created when user first accesses the app)
  const secret = req.session?.csrfSecret;

  if (!secret) {
    return res.status(403).json({
      error: 'CSRF_NO_SECRET',
      message: 'CSRF secret not found. Please refresh the page.'
    });
  }

  // Get token from various sources
  const token =
    req.headers['x-csrf-token'] as string ||
    req.headers['x-xsrf-token'] as string ||
    req.body?._csrf ||
    req.query._csrf as string;

  if (!token) {
    return res.status(403).json({
      error: 'CSRF_NO_TOKEN',
      message: 'CSRF token missing. Include X-CSRF-Token header or _csrf field.'
    });
  }

  // Verify the token
  if (!csrfTokens.verify(secret, token)) {
    return res.status(403).json({
      error: 'CSRF_INVALID_TOKEN',
      message: 'CSRF token is invalid or expired.'
    });
  }

  next();
}

// Middleware to generate and attach CSRF token to session
export function setupCSRF(req: Request, res: Response, next: NextFunction) {
  const hasSecret = Boolean(req.session?.csrfSecret);
  const isSafeMethod = ['GET', 'HEAD', 'OPTIONS'].includes(req.method);
  const shouldBootstrapSecret = !hasSecret && (isSafeMethod || req.path === '/csrf-token');

  if (shouldBootstrapSecret) {
    req.session = req.session || {};
    req.session.csrfSecret = csrfTokens.secretSync();
  }

  if (req.session?.csrfSecret) {
    res.locals.csrfToken = () => csrfTokens.create(req.session!.csrfSecret!);
  }

  next();
}

// Endpoint to get CSRF token for frontend
export function getCSRFToken(req: Request, res: Response) {
  if (!req.session?.csrfSecret) {
    req.session = req.session || {};
    req.session.csrfSecret = csrfTokens.secretSync();
  }

  const token = csrfTokens.create(req.session.csrfSecret!);

  res.json({
    csrfToken: token,
    expires: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours
  });
}

// Type augmentation for session
declare module 'express-session' {
  interface SessionData {
    csrfSecret?: string;
  }
}
