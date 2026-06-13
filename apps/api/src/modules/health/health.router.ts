/**
 * Health router — sondes publiques pour orchestrateur / load balancer / monitoring.
 *
 * Monté TRÈS tôt dans la chaîne Express (avant session, rate-limit, CSRF) afin que :
 *  - la liveness ne dépende d'aucune infrastructure (y.c. store de session Redis) ;
 *  - les sondes ne soient jamais rate-limitées (un LB poll fréquemment) ;
 *  - le coût par requête reste minimal.
 *
 * Toutes les réponses sont `no-store` : aucune mise en cache CDN/proxy d'un état santé.
 */

import { Router } from 'express';
import { secureLogger } from '../../utils/secure-logger';
import { buildLiveness, buildReadiness } from './health.checks';

export const healthRouter = Router();

function noStore(res: import('express').Response): void {
  res.setHeader('Cache-Control', 'no-store');
}

/**
 * GET /health — compat héritée (Docker healthcheck legacy, tests existants).
 * Réponse plate volontairement minimale.
 */
healthRouter.get('/', (_req, res) => {
  noStore(res);
  res.json({ status: 'ok' });
});

/**
 * GET /health/live — liveness.
 * Indique uniquement que le process API est vivant. Ne touche AUCUNE dépendance.
 */
healthRouter.get('/live', (_req, res) => {
  noStore(res);
  res.json(buildLiveness());
});

/**
 * GET /health/ready — readiness.
 * Indique si l'API est prête à servir le trafic. Vérifie PostgreSQL (dur),
 * Redis et le stockage (souples). 503 uniquement si `critical`.
 */
healthRouter.get('/ready', async (_req, res) => {
  noStore(res);
  try {
    const result = await buildReadiness();
    const httpStatus = result.status === 'critical' ? 503 : 200;
    return res.status(httpStatus).json(result);
  } catch (error) {
    // Filet de sécurité : buildReadiness ne devrait jamais throw, mais on ne
    // laisse fuiter aucun détail. Réponse neutre + 503.
    secureLogger.error('HEALTH_READY_UNEXPECTED_ERROR', { error });
    return res.status(503).json({
      status: 'critical',
      checks: { database: 'critical', redis: 'critical', storage: 'critical' },
      timestamp: new Date().toISOString(),
    });
  }
});
