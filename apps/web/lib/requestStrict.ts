import { z } from 'zod';
import { ERROR_CODES } from './socketAck';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

export const envelopeErrorSchema = z
  .object({
    ok: z.literal(false),
    error: z.object({
      code: z.nativeEnum(ERROR_CODES),
      message: z.string(),
      details: z.unknown().optional(),
    }),
  })
  .strict();

export const envelopeSuccessSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z
    .object({
      ok: z.literal(true),
      data: dataSchema,
      meta: z.unknown().optional(),
    })
    .strict();

export type StrictHttpError = Error & {
  code?: string;
  details?: unknown;
  status?: number;
  url?: string;
  body?: unknown;
};

const makeError = (params: { code?: string; message: string; details?: unknown; status?: number; url?: string; body?: unknown }): StrictHttpError => {
  const err: StrictHttpError = new Error(params.message);
  err.code = params.code;
  err.details = params.details;
  err.status = params.status;
  err.url = params.url;
  err.body = params.body;
  return err;
};

export async function requestStrict<T>(
  path: string,
  init: RequestInit,
  dataSchema: z.ZodType<T>
): Promise<T> {
  // Guardrail: les writes P0 ne doivent pas bypasser requestStrict (pas de fetch direct ni de fallback legacy).
  const headers = new Headers(init.headers || {});
  headers.set('X-API-ENVELOPE', '1');

  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers,
    credentials: init.credentials ?? 'include',
    cache: init.cache ?? 'no-store',
  });

  const url = res.url || `${API_URL}${path}`;

  let text: string;
  try {
    text = await res.text();
  } catch (err) {
    throw makeError({
      code: 'INVALID_RESPONSE',
      message: 'Failed to read response body',
      details: err,
      status: res.status,
      url,
    });
  }

  if (!text || text.trim() === '') {
    throw makeError({
      code: 'INVALID_ENVELOPE',
      message: 'Missing enveloped response body',
      status: res.status,
      url,
    });
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (err) {
    throw makeError({
      code: 'INVALID_JSON',
      message: 'Response is not valid JSON',
      details: err,
      status: res.status,
      url,
    });
  }

  const parsedError = envelopeErrorSchema.safeParse(json);
  if (parsedError.success) {
    const { code, message, details } = parsedError.data.error;
    throw makeError({
      code,
      message,
      details,
      status: res.status,
      url,
      body: json,
    });
  }

  const parsedSuccess = envelopeSuccessSchema(dataSchema).safeParse(json);
  if (parsedSuccess.success) {
    return parsedSuccess.data.data as T;
  }

  throw makeError({
    code: 'INVALID_ENVELOPE',
    message: 'Invalid enveloped response',
    details: parsedSuccess.error.flatten(),
    status: res.status,
    url,
    body: json,
  });
}
