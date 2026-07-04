/**
 * Routing unitaire — GET de lecture conversation exclus du bucket MESSAGING
 *
 * Vérifie que smartRateLimit achemine les GET de lecture annexe d'une
 * conversation (membres, invitations en attente, recherche d'utilisateurs)
 * vers next() directement — ils sont protégés par le conversationReadLimiter
 * dédié per-userId sur la route. Le bucket MESSAGING partagé par IP
 * (10 req/min) déclenchait des 429 en navigation normale (« Membres (0) »
 * à l'ouverture d'une conversation, observé en QA le 2026-07-04).
 *
 * Les écritures (POST/PATCH/DELETE) restent routées vers le bucket MESSAGING.
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { NextFunction, Request, Response } from 'express';
import { rateLimiters, smartRateLimit } from '../enhanced-rate-limit';

function mockReq(path: string, method = 'GET', ip = '10.0.0.1'): Request {
  return {
    path,
    method,
    canonicalIp: ip,
    socket: { remoteAddress: ip },
    get: jest.fn(() => undefined),
  } as unknown as Request;
}

function mockRes(): Response {
  return {} as Response;
}

describe('smartRateLimit — routage lectures conversation (fix 429 members)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let messagingSpy: jest.Mock<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let savedMessaging: any;

  beforeEach(() => {
    messagingSpy = jest.fn((_req: Request, _res: Response, next: NextFunction) => next());
    savedMessaging = rateLimiters.messaging;
    rateLimiters.messaging = messagingSpy;
  });

  afterEach(() => {
    rateLimiters.messaging = savedMessaging;
  });

  // ─── GET de lecture — exclusion bucket MESSAGING ──────────────────────────

  it('GET /conversations/:id/members → next() direct, bucket MESSAGING non consommé', () => {
    const next = jest.fn() as jest.MockedFunction<NextFunction>;
    smartRateLimit(mockReq('/conversations/3d381038-cf94-4ac7-a77b-fda7138eaac7/members'), mockRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(messagingSpy).not.toHaveBeenCalled();
  });

  it('GET /conversations/invitations/pending → next() direct', () => {
    const next = jest.fn() as jest.MockedFunction<NextFunction>;
    smartRateLimit(mockReq('/conversations/invitations/pending'), mockRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(messagingSpy).not.toHaveBeenCalled();
  });

  it('GET /conversations/users/search → next() direct', () => {
    const next = jest.fn() as jest.MockedFunction<NextFunction>;
    smartRateLimit(mockReq('/conversations/users/search'), mockRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(messagingSpy).not.toHaveBeenCalled();
  });

  // ─── Écritures — toujours protégées par le bucket MESSAGING ───────────────

  it('POST /conversations/:id/members → bucket MESSAGING activé (écriture non exclue)', () => {
    const next = jest.fn() as jest.MockedFunction<NextFunction>;
    smartRateLimit(mockReq('/conversations/abc/members', 'POST'), mockRes(), next);
    expect(messagingSpy).toHaveBeenCalledTimes(1);
  });

  it('POST /conversations/:id/unmatch → bucket MESSAGING activé', () => {
    const next = jest.fn() as jest.MockedFunction<NextFunction>;
    smartRateLimit(mockReq('/conversations/abc/unmatch', 'POST'), mockRes(), next);
    expect(messagingSpy).toHaveBeenCalledTimes(1);
  });

  it('PATCH /conversations/:id/archive → bucket MESSAGING activé', () => {
    const next = jest.fn() as jest.MockedFunction<NextFunction>;
    smartRateLimit(mockReq('/conversations/abc/archive', 'PATCH'), mockRes(), next);
    expect(messagingSpy).toHaveBeenCalledTimes(1);
  });

  it('DELETE /conversations/:id/members/:userId → bucket MESSAGING activé', () => {
    const next = jest.fn() as jest.MockedFunction<NextFunction>;
    smartRateLimit(mockReq('/conversations/abc/members/def', 'DELETE'), mockRes(), next);
    expect(messagingSpy).toHaveBeenCalledTimes(1);
  });

  // ─── Un sous-chemin imbriqué ne matche pas la regex members ───────────────

  it('GET /conversations/:id/members/extra → non exempté (regex stricte)', () => {
    const next = jest.fn() as jest.MockedFunction<NextFunction>;
    smartRateLimit(mockReq('/conversations/abc/members/extra'), mockRes(), next);
    expect(messagingSpy).toHaveBeenCalledTimes(1);
  });
});
