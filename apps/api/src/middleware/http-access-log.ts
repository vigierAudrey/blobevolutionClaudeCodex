import type { Request, Response, NextFunction } from 'express';
import { secureLogger } from '../utils/secure-logger';
import { getActorRef, sanitizeHttpPath } from '../observability/log-context';
import { isExcludedPath } from '../lib/http-metrics';

/**
 * HTTP access log — loggué sur 'finish' (après envoi de la réponse).
 *
 * Champs loggués : method, path (sans query), status, duration_ms,
 *   request_id, actor_ref (userId hashé HMAC — jamais email brut),
 *   content_length (si présent dans la réponse).
 *
 * Champs JAMAIS loggués : body, query params, cookies, tokens,
 *   Authorization, email brut, IP brute.
 *
 * Les paths exclus (health, metrics, etc.) sont ignorés pour ne pas
 * inflater les logs avec des probes monitoring.
 */
export function httpAccessLog(req: Request, res: Response, next: NextFunction): void {
  if (isExcludedPath(req.path)) {
    return next();
  }

  const start = Date.now();

  res.on('finish', () => {
    const durationMs = Date.now() - start;
    const requestId = (req as Request & { requestId?: string }).requestId;
    const actorRef = getActorRef();
    const rawContentLength = res.get('content-length');
    const contentLength = rawContentLength !== undefined ? parseInt(rawContentLength, 10) : undefined;

    secureLogger.info('HTTP_ACCESS', {
      method: req.method,
      path: sanitizeHttpPath(req.path),
      status: res.statusCode,
      duration_ms: durationMs,
      ...(requestId !== undefined ? { request_id: requestId } : {}),
      ...(actorRef !== 'anonymous' ? { actor_ref: actorRef } : {}),
      ...(contentLength !== undefined && !isNaN(contentLength) ? { content_length: contentLength } : {}),
    });
  });

  next();
}
