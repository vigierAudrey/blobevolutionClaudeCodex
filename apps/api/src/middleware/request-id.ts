/**
 * Request ID Middleware
 *
 * Stamps every request with a unique ID for log correlation.
 *
 * Behavior:
 * - Accepts x-request-id header from client ONLY if it is a valid UUID v4
 *   (prevents arbitrary injection into audit logs)
 * - Otherwise generates a fresh randomUUID()
 * - Echoes the final requestId back via x-request-id response header
 * - Attaches to req.requestId (available downstream in handlers and audit middleware)
 */

import { randomUUID } from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import { updateLogContext } from '../observability/log-context';

// Strict UUID v4: version nibble = 4, variant nibble = 8/9/a/b
const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const inbound = req.get('x-request-id');
  const requestId = inbound && UUID_V4_REGEX.test(inbound) ? inbound : randomUUID();
  (req as any).requestId = requestId;
  updateLogContext({ requestId });
  res.set('x-request-id', requestId);
  next();
}
