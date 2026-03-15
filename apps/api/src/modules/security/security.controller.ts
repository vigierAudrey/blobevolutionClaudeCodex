import { Router } from 'express';
import { secureLogger } from '../../utils/secure-logger';
import { requireSecurityReadAccess } from './security.access';
import { buildSecurityHealthResponse } from './security.health';
import { buildSecurityObservabilityResponse } from './security.observability';

export const securityRouter = Router();

/**
 * GET /security/health
 * Retourne la posture de sécurité canonique de la plateforme
 */
securityRouter.get('/health', requireSecurityReadAccess, async (req, res) => {
  try {
    const response = await buildSecurityHealthResponse();
    secureLogger.security('SECURITY_HEALTH_CHECK_ACCESSED', {
      accessMode: req.get('x-security-monitor-token') ? 'monitor-token' : 'admin',
    });
    return res.json(response);
  } catch (error) {
    secureLogger.error('SECURITY_HEALTH_CHECK_FAILED', { error });
    return res.status(500).json({ error: 'Internal error' });
  }
});

securityRouter.get('/observability', requireSecurityReadAccess, (req, res) => {
  try {
    const response = buildSecurityObservabilityResponse();
    secureLogger.security('SECURITY_OBSERVABILITY_ACCESSED', {
      accessMode: req.get('x-security-monitor-token') ? 'monitor-token' : 'admin',
    });
    return res.json(response);
  } catch (error) {
    secureLogger.error('SECURITY_OBSERVABILITY_FAILED', { error });
    return res.status(500).json({ error: 'Internal error' });
  }
});
