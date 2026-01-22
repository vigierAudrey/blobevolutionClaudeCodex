# Security Documentation

This repository uses a **structured security documentation** approach:

---

## 📁 Security Documentation by Component

### Database Security
**File**: [`packages/database/SECURITY.md`](packages/database/SECURITY.md)

**Scope**: Prisma database operations, `db push` guards, schema migration safety

**Key topics**:
- 🚨 `prisma db push --accept-data-loss` protection (P0 Critical)
- Triple-layer defense (runtime wrapper + Jest guard + CI check)
- Authorization requirements (double-key: `ALLOW_ACCEPT_DATA_LOSS` + test context)
- Deny-by-default policy (whitelist: test environments only)

**Quick answer**: "Can I run `db push`?" → Read this in 30 seconds.

---

### API Security
**File**: [`apps/api/SECURITY.md`](apps/api/SECURITY.md)

**Scope**: Express API security, authentication, authorization, monitoring

**Key topics**:
- Helmet, CSRF, CORS, rate limiting
- Session security, JWT secrets, trust proxy configuration
- RBAC admin permissions, 2FA, email verification enforcement
- `/security/health` monitoring endpoint
- GDPR compliance, audit logging
- Production deployment checklist

**Quick answer**: "How to secure the API?" → Read this for API hardening.

---

## 📊 Historical Security Audits

The following files contain **historical audits and reports** (read-only, do not modify):

- `SECURITY_AUDIT_PRO_MODULE.md` – Pro module security audit
- `SECURITY_AUDIT_RIDER_ISOLATION_2025-12-08.md` – Rider isolation audit
- `SECURITY_AUDIT_ROLE_ISOLATION_2025-12-08.md` – Role isolation audit
- `SECURITY_EXECUTIVE_SUMMARY_2025-12-08.md` – Executive summary (Dec 2025)
- `SECURITY_FIXES_RIDER_SUMMARY.md` – Rider fixes summary
- `SECURITY_FIXES_SUMMARY.md` – General fixes summary
- `SECURITY_HARDENING_REPORT.md` – Hardening report
- `SECURITY_ALERT_SYSTEM.md` – Alert system documentation

---

## 🔒 Quick Security Checklist

### Database Operations
- [ ] Never run `prisma db push --accept-data-loss` in production
- [ ] Always use `prisma migrate deploy` for production schema updates
- [ ] Run `npm run guard:accept-data-loss` to verify no unprotected usage

### API Deployment
- [ ] Configure `ALLOWED_ORIGINS` (CORS whitelist)
- [ ] Generate strong secrets via `scripts/generate-secrets.sh`
- [ ] Set `TRUSTED_PROXY_IPS` for reverse proxy
- [ ] Enable `AUTH_REQUIRE_VERIFIED=true` in production
- [ ] Test `/security/health` endpoint before deployment

---

## 🛠️ Security Tools

| Tool | Purpose | Command |
|------|---------|---------|
| **Database guard check** | Scan for unprotected `--accept-data-loss` | `npm run guard:accept-data-loss` |
| **Database guard tests** | Proof tests (11 scenarios) | `node packages/database/scripts/__tests__/safe-db-push.test.mjs` |
| **Secret generation** | Generate secure secrets | `bash scripts/generate-secrets.sh` |
| **Security health** | API security status | `GET /security/health` (admin token required) |
| **No raw IP check** | Verify no raw IP storage | `npm run test:security` |

---

## 📖 Additional Resources

- **ROADMAP.md** – Security roadmap and production readiness
- **apps/api/CSRF_PROTECTION.md** – CSRF implementation details
- **ai/SECURITY_AGENT_GUIDE.md** – Security agent guidelines

---

**Last updated**: 2026-01-20
**Maintainers**: Security Team + SRE
