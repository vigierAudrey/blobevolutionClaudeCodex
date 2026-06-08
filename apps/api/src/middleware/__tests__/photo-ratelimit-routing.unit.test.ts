/**
 * Routing unitaire — POST /photo/finalize exclu du bucket UPLOAD global
 *
 * Vérifie que smartRateLimit achemine POST /photo/finalize vers next() directement
 * (protégé par le finalizeRateLimiter dédié per-userId sur la route), et non vers
 * le bucket UPLOAD partagé par IP, qui causerait des 429 spurieux en production.
 *
 * Stratégie : patch en-place de rateLimiters.upload et rateLimiters.apiStandard
 * avec des spies jest — smartRateLimit lit ces propriétés à l'appel, le patch est
 * transparent pour la logique de routage.
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { NextFunction, Request, Response } from 'express';
import { rateLimiters, smartRateLimit } from '../enhanced-rate-limit';

/** Construit un Request minimal lisible par smartRateLimit. */
function mockReq(path: string, method = 'POST', ip = '10.0.0.1'): Request {
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

describe('smartRateLimit — routage endpoints photo (fix 429 finalize)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let uploadSpy: jest.Mock<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let apiStandardSpy: jest.Mock<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let savedUpload: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let savedApiStandard: any;

  beforeEach(() => {
    uploadSpy = jest.fn((_req: Request, _res: Response, next: NextFunction) => next());
    apiStandardSpy = jest.fn((_req: Request, _res: Response, next: NextFunction) => next());
    savedUpload = rateLimiters.upload;
    savedApiStandard = rateLimiters.apiStandard;
    rateLimiters.upload = uploadSpy;
    rateLimiters.apiStandard = apiStandardSpy;
  });

  afterEach(() => {
    rateLimiters.upload = savedUpload;
    rateLimiters.apiStandard = savedApiStandard;
  });

  // ─── /photo/finalize — exclusion bucket UPLOAD ────────────────────────────

  it('POST /profile/photo/finalize → next() direct, bucket UPLOAD non consommé', () => {
    const next = jest.fn() as jest.MockedFunction<NextFunction>;
    smartRateLimit(mockReq('/profile/photo/finalize'), mockRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(uploadSpy).not.toHaveBeenCalled();
  });

  it('POST /pro/photo/finalize → next() direct, bucket UPLOAD non consommé', () => {
    const next = jest.fn() as jest.MockedFunction<NextFunction>;
    smartRateLimit(mockReq('/pro/photo/finalize'), mockRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(uploadSpy).not.toHaveBeenCalled();
  });

  // ─── /photo/upload-url — comportement inchangé (apiStandard) ─────────────

  it('POST /profile/photo/upload-url → apiStandard, bucket UPLOAD non consommé', () => {
    const next = jest.fn() as jest.MockedFunction<NextFunction>;
    smartRateLimit(mockReq('/profile/photo/upload-url'), mockRes(), next);
    expect(apiStandardSpy).toHaveBeenCalledTimes(1);
    expect(uploadSpy).not.toHaveBeenCalled();
  });

  it('POST /pro/photo/upload-url → apiStandard, bucket UPLOAD non consommé', () => {
    const next = jest.fn() as jest.MockedFunction<NextFunction>;
    smartRateLimit(mockReq('/pro/photo/upload-url'), mockRes(), next);
    expect(apiStandardSpy).toHaveBeenCalledTimes(1);
    expect(uploadSpy).not.toHaveBeenCalled();
  });

  // ─── Autres endpoints upload — toujours protégés par le bucket UPLOAD ─────

  it('POST /photo/other-endpoint → bucket UPLOAD activé (non exclu)', () => {
    const next = jest.fn() as jest.MockedFunction<NextFunction>;
    smartRateLimit(mockReq('/photo/other-endpoint'), mockRes(), next);
    expect(uploadSpy).toHaveBeenCalledTimes(1);
    expect(apiStandardSpy).not.toHaveBeenCalled();
  });

  it('GET /profile/upload/something → bucket UPLOAD activé (path includes /upload)', () => {
    const next = jest.fn() as jest.MockedFunction<NextFunction>;
    smartRateLimit(mockReq('/profile/upload/something', 'GET'), mockRes(), next);
    expect(uploadSpy).toHaveBeenCalledTimes(1);
  });

  // ─── Pas de fuite de comportement entre limiter upload-url et finalize ────

  it('deux appels successifs — upload-url puis finalize — chacun bien routé', () => {
    const next1 = jest.fn() as jest.MockedFunction<NextFunction>;
    const next2 = jest.fn() as jest.MockedFunction<NextFunction>;
    smartRateLimit(mockReq('/profile/photo/upload-url'), mockRes(), next1);
    smartRateLimit(mockReq('/profile/photo/finalize'), mockRes(), next2);
    // upload-url → apiStandard
    expect(apiStandardSpy).toHaveBeenCalledTimes(1);
    // finalize → next direct
    expect(next2).toHaveBeenCalledTimes(1);
    // bucket UPLOAD jamais consommé
    expect(uploadSpy).not.toHaveBeenCalled();
  });
});
