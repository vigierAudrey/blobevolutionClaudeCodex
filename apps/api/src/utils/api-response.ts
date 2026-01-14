import type { Request, Response } from 'express';
import { Prisma } from '@blobinfini/database';
import { ZodError } from 'zod';
import { ERROR_CODES, type ErrorCode } from './error-codes';

export type ApiSuccessEnvelope<T> = { ok: true; data: T };
export type ApiErrorBody = { code: string; message: string; details?: unknown };
export type ApiErrorEnvelope = { ok: false; error: ApiErrorBody };

export const sendOk = <T>(res: Response, status: number, data: T) =>
  res.status(status).json({ ok: true, data } satisfies ApiSuccessEnvelope<T>);

export const sendError = (
  res: Response,
  status: number,
  code: string,
  message: string,
  details?: unknown
) =>
  res
    .status(status)
    .json({ ok: false, error: { code, message, ...(details !== undefined ? { details } : {}) } } satisfies ApiErrorEnvelope);

export const wantsEnvelope = (req: Request): boolean => {
  const header = req.headers['x-api-envelope'];
  if (Array.isArray(header)) return header[0]?.trim() === '1';
  if (typeof header === 'string') return header.trim() === '1';
  return false;
};

export type MappedError = {
  status: number;
  code: ErrorCode | string;
  message: string;
  details?: unknown;
};

const isPrismaKnownRequestError = (error: unknown): error is Prisma.PrismaClientKnownRequestError =>
  error instanceof Prisma.PrismaClientKnownRequestError;

export const mapErrorToApiError = (error: unknown): MappedError => {
  if (error instanceof ZodError) {
    return { status: 400, code: 'VALIDATION_ERROR', message: 'Invalid input', details: error.errors };
  }

  if (isPrismaKnownRequestError(error)) {
    if (error.code === 'P2002') {
      return {
        status: 409,
        code: 'UNIQUE_CONSTRAINT',
        message: 'Resource already exists',
        details: { target: (error.meta as { target?: string[] } | undefined)?.target },
      };
    }
  }

  if (error && typeof error === 'object' && 'status' in error && typeof (error as any).status === 'number') {
    const status = (error as any).status as number;
    const message = (error as any).message ?? 'Error';
    return { status, code: 'APPLICATION_ERROR', message };
  }

  const fallbackMessage = error instanceof Error ? error.message : 'Internal error';
  return { status: 500, code: ERROR_CODES.INTERNAL_ERROR, message: fallbackMessage };
};
