import { Router } from 'express';
import { requireAuth, requireAdmin, requireVerifiedEmail } from '../auth/auth.guard';

export const securityRouter = Router();

// Toutes les routes security nécessitent une authentification admin
securityRouter.use(requireAuth, requireVerifiedEmail);
securityRouter.use(requireAdmin);

/**
 * GET /api/security/health
 * Retourne l'état de santé de la sécurité de la plateforme
 */
securityRouter.get('/health', async (req, res) => {
  try {
    // Vérifier les secrets de production
    const MIN_SECRET_LENGTH = 64;
    const isProduction = process.env.NODE_ENV === 'production';

    const weakSecrets: string[] = [];
    const REQUIRED_SECRETS = ['SESSION_SECRET', 'JWT_SECRET', 'JWT_REFRESH_SECRET'] as const;

    for (const key of REQUIRED_SECRETS) {
      const value = process.env[key];
      if (!value || value.length < MIN_SECRET_LENGTH) {
        if (isProduction) {
          weakSecrets.push(key);
        }
      }
    }

    // Vérifier CORS
    const corsWhitelist = (process.env.ALLOWED_ORIGINS || '')
      .split(',')
      .map(origin => origin.trim())
      .filter(Boolean);

    const hasCorsConfigured = corsWhitelist.length > 0;

    // Vérifier les headers de sécurité (Helmet)
    const hasHelmet = true; // Helmet est toujours activé dans index.ts

    // Vérifier CSRF protection
    const hasCsrf = process.env.CSRF_ENABLED !== 'false'; // Activé par défaut

    // Vérifier Rate Limiting
    const hasRateLimit = true; // smartRateLimit est activé dans index.ts

    const authRequireVerified = String(
      process.env.AUTH_REQUIRE_VERIFIED ?? (isProduction ? 'true' : 'false')
    ).toLowerCase() === 'true';

    // Déterminer les problèmes
    const issues: string[] = [];

    if (isProduction && weakSecrets.length > 0) {
      issues.push(`Secrets faibles détectés : ${weakSecrets.join(', ')}`);
    }

    if (isProduction && !hasCorsConfigured) {
      issues.push('CORS non configuré en production (ALLOWED_ORIGINS vide)');
    }

    if (!hasCsrf) {
      issues.push('Protection CSRF désactivée');
    }

    if (isProduction && !authRequireVerified) {
      issues.push('AUTH_REQUIRE_VERIFIED doit être positionné à true en production pour bloquer les comptes non vérifiés');
    }

    // Statut global
    const status = issues.length === 0 ? 'SECURE' : 'VULNERABLE';

    return res.json({
      status,
      helmet: hasHelmet,
      csrf: hasCsrf,
      rateLimit: hasRateLimit,
      corsWhitelist: corsWhitelist.length > 0 ? corsWhitelist : ['http://localhost:3000', 'http://localhost:3001'],
      authRequireVerified,
      issues,
      checks: {
        productionSecrets: isProduction ? weakSecrets.length === 0 : true,
        corsConfigured: isProduction ? hasCorsConfigured : true,
        helmetEnabled: hasHelmet,
        csrfEnabled: hasCsrf,
        rateLimitEnabled: hasRateLimit,
        authRequireVerified: authRequireVerified || !isProduction
      },
      environment: process.env.NODE_ENV || 'development',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Security health check error:', error);
    return res.status(500).json({ error: 'Internal error' });
  }
});
