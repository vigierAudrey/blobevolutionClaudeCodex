/**
 * Tests unitaires — requireRole (lib/role-guard.ts)
 *
 * Couvre :
 *  - PRO accepté par requireRole('PRO')
 *  - RIDER refusé par requireRole('PRO')
 *  - RIDER accepté par requireRole('RIDER')
 *  - PRO refusé par requireRole('RIDER')
 *  - JWT stale corrigé par fallback DB
 *  - JWT valide → aucune requête DB
 *  - rôle invalide / UNKNOWN refusé
 *  - utilisateur non authentifié → 401
 *  - aucun email/PII dans les logs sécurité
 *  - matrice d'alertes securityAlertService
 *  - erreur DB → 500
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.mock('@blobinfini/database', () => ({
  clientPrisma: {
    user: {
      findUnique: jest.fn(),
    },
  },
}));

jest.mock('../../services/security-alert.service', () => ({
  securityAlertService: {
    reportRiderToProViolation: jest.fn(async () => {}),
    reportAdminToProViolation: jest.fn(async () => {}),
    reportProToRiderViolation: jest.fn(async () => {}),
    reportInvalidRoleViolation: jest.fn(async () => {}),
  },
}));

jest.mock('../client-ip', () => ({
  getClientIp: jest.fn(() => '127.0.0.1'),
}));

jest.mock('../../utils/secure-logger', () => ({
  secureLogger: {
    security: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}));

import { requireRole } from '../role-guard';
import { clientPrisma as prisma } from '@blobinfini/database';
import { securityAlertService } from '../../services/security-alert.service';
import { secureLogger } from '../../utils/secure-logger';

const mockPrisma = prisma as jest.Mocked<typeof prisma>;
const mockAlerts = securityAlertService as jest.Mocked<typeof securityAlertService>;
const mockLogger = secureLogger as jest.Mocked<typeof secureLogger>;

function makeReq(role: string, userId = 'user-abc') {
  return {
    user: { id: userId, role },
    method: 'GET',
    baseUrl: '/pro',
    path: '/me',
    get: jest.fn((_h: string) => undefined),
  } as any;
}

function makeRes() {
  const json = jest.fn();
  const status = jest.fn(() => ({ json }));
  return { status, json } as any;
}

function makeNext() {
  return jest.fn() as any;
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ── requireRole('PRO') ────────────────────────────────────────────────────────

describe("requireRole('PRO')", () => {
  const guard = requireRole('PRO');

  it('accepte un PRO — fast path JWT, aucune DB', async () => {
    const req = makeReq('PRO');
    const res = makeRes();
    const next = makeNext();

    await guard(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('refuse un RIDER → 403 + alerte reportRiderToProViolation', async () => {
    const req = makeReq('RIDER');
    const res = makeRes();
    const next = makeNext();
    (mockPrisma.user.findUnique as jest.Mock).mockResolvedValueOnce({ role: 'RIDER', email: 'r@test.com' });

    await guard(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockAlerts.reportRiderToProViolation).toHaveBeenCalledTimes(1);
    expect(mockAlerts.reportAdminToProViolation).not.toHaveBeenCalled();
  });

  it('refuse un ADMIN → 403 + alerte reportAdminToProViolation', async () => {
    const req = makeReq('ADMIN');
    const res = makeRes();
    const next = makeNext();
    (mockPrisma.user.findUnique as jest.Mock).mockResolvedValueOnce({ role: 'ADMIN', email: 'a@test.com' });

    await guard(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockAlerts.reportAdminToProViolation).toHaveBeenCalledTimes(1);
  });

  it('refuse un rôle UNKNOWN → 403 + alerte reportInvalidRoleViolation', async () => {
    const req = makeReq('HACKER');
    const res = makeRes();
    const next = makeNext();
    (mockPrisma.user.findUnique as jest.Mock).mockResolvedValueOnce({ role: 'HACKER', email: 'h@test.com' });

    await guard(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockAlerts.reportInvalidRoleViolation).toHaveBeenCalledTimes(1);
  });

  it('JWT stale RIDER → DB dit PRO → next() appelé', async () => {
    const req = makeReq('RIDER');
    const res = makeRes();
    const next = makeNext();
    (mockPrisma.user.findUnique as jest.Mock).mockResolvedValueOnce({ role: 'PRO', email: 'p@test.com' });

    await guard(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user.role).toBe('PRO');
    expect(mockAlerts.reportRiderToProViolation).not.toHaveBeenCalled();
  });
});

// ── requireRole('RIDER') ──────────────────────────────────────────────────────

describe("requireRole('RIDER')", () => {
  const guard = requireRole('RIDER');

  it('accepte un RIDER — fast path JWT, aucune DB', async () => {
    const req = makeReq('RIDER');
    const res = makeRes();
    const next = makeNext();

    await guard(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('refuse un PRO → 403 + alerte reportProToRiderViolation', async () => {
    const req = makeReq('PRO');
    const res = makeRes();
    const next = makeNext();
    (mockPrisma.user.findUnique as jest.Mock).mockResolvedValueOnce({ role: 'PRO', email: 'p@test.com' });

    await guard(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockAlerts.reportProToRiderViolation).toHaveBeenCalledTimes(1);
  });

  it('refuse un ADMIN → 403 + alerte reportInvalidRoleViolation', async () => {
    const req = makeReq('ADMIN');
    const res = makeRes();
    const next = makeNext();
    (mockPrisma.user.findUnique as jest.Mock).mockResolvedValueOnce({ role: 'ADMIN', email: 'a@test.com' });

    await guard(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockAlerts.reportInvalidRoleViolation).toHaveBeenCalledTimes(1);
  });

  it('JWT stale PRO → DB dit RIDER → next() appelé', async () => {
    const req = makeReq('PRO');
    const res = makeRes();
    const next = makeNext();
    (mockPrisma.user.findUnique as jest.Mock).mockResolvedValueOnce({ role: 'RIDER', email: 'r@test.com' });

    await guard(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user.role).toBe('RIDER');
    expect(mockAlerts.reportProToRiderViolation).not.toHaveBeenCalled();
  });
});

// ── Comportements communs ────────────────────────────────────────────────────

describe('comportements communs', () => {
  it('utilisateur non authentifié → 401 sans DB', async () => {
    const guard = requireRole('PRO');
    const req = { user: undefined, method: 'GET', baseUrl: '/pro', path: '/me', get: jest.fn() } as any;
    const res = makeRes();
    const next = makeNext();

    await guard(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('user.id absent → 401', async () => {
    const guard = requireRole('RIDER');
    const req = { user: { id: '', role: 'RIDER' }, method: 'GET', baseUrl: '/profile', path: '/me', get: jest.fn() } as any;
    const res = makeRes();
    const next = makeNext();

    await guard(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('erreur DB → 500 sans alerte ni next', async () => {
    const guard = requireRole('PRO');
    const req = makeReq('RIDER');
    const res = makeRes();
    const next = makeNext();
    (mockPrisma.user.findUnique as jest.Mock).mockRejectedValueOnce(new Error('DB unreachable'));

    await guard(req, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(next).not.toHaveBeenCalled();
    expect(mockAlerts.reportRiderToProViolation).not.toHaveBeenCalled();
    expect(mockLogger.error).toHaveBeenCalledWith('ROLE_GUARD_DB_FAILED', expect.anything());
  });

  it('log sécurité sans PII — email absent de secureLogger.security', async () => {
    const guard = requireRole('PRO');
    const req = makeReq('RIDER');
    const res = makeRes();
    const next = makeNext();
    (mockPrisma.user.findUnique as jest.Mock).mockResolvedValueOnce({ role: 'RIDER', email: 'secret@test.com' });

    await guard(req, res, next);

    expect(mockLogger.security).toHaveBeenCalledTimes(1);
    const [, logPayload] = (mockLogger.security as jest.Mock).mock.calls[0];
    expect(JSON.stringify(logPayload)).not.toContain('secret@test.com');
    expect(JSON.stringify(logPayload)).not.toContain('@test.com');
  });

  it('message 403 neutre — ne révèle pas le rôle attendu', async () => {
    const guard = requireRole('PRO');
    const req = makeReq('RIDER');
    const res = makeRes();
    const next = makeNext();
    (mockPrisma.user.findUnique as jest.Mock).mockResolvedValueOnce({ role: 'RIDER', email: 'r@test.com' });

    await guard(req, res, next);

    const jsonArgs = (res.status('403') as any).json.mock?.calls ?? (res as any)._jsonCalls;
    const [statusCode] = (res.status as jest.Mock).mock.calls[0];
    expect(statusCode).toBe(403);
  });

  it('alerte DB null → reportInvalidRoleViolation avec UNKNOWN', async () => {
    const guard = requireRole('PRO');
    const req = makeReq('RIDER');
    const res = makeRes();
    const next = makeNext();
    (mockPrisma.user.findUnique as jest.Mock).mockResolvedValueOnce(null);

    await guard(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    const [[callUserId, callRole]] = (mockAlerts.reportInvalidRoleViolation as jest.Mock).mock.calls;
    expect(callUserId).toBe('user-abc');
    expect(callRole).toBe('UNKNOWN');
  });
});
