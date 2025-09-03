Sécurité Auth – Checklist

Tokens
- Access: 15 min, Refresh: 30 j
- Secrets forts, rotation possible
- Blacklist/invalidations sur logout

Routes sensibles
- Rate limit (login/register/refresh/reset)
- Brute force protégé

Données & RGPD
- Passwords hashés (bcrypt ≥ 12)
- Consentement, export, suppression (soft delete + purge)
- Logs anonymisés ≤ 30 j

Protections
- CSRF (si cookies), headers (CSP, HSTS)
- Validation Zod sur tous inputs
