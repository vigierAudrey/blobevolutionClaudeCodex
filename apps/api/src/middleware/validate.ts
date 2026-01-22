import type { Request, Response, NextFunction } from 'express';
import { ZodError, type ZodTypeAny } from 'zod';
import { secureLogger } from '../utils/secure-logger';

// Sécurité (checklist) : support explicite body/query/params pour Zod.
type ValidationSchemaMap = {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
};

// Sécurité : différencier schéma Zod simple vs map de schémas.
const isZodSchema = (value: unknown): value is ZodTypeAny => {
  return !!value && typeof value === 'object' && 'parse' in value &&
    typeof (value as { parse?: unknown }).parse === 'function';
};

// Sécurité : validation explicite des clés supportées.
const isSchemaMap = (value: unknown): value is ValidationSchemaMap => {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return 'body' in record || 'query' in record || 'params' in record;
};

/**
 * Wraps a Zod schema into an Express middleware.
 * Returns 400 with the validation errors when parsing fails.
 */
export const validate =
  (schema: ZodTypeAny | ValidationSchemaMap) =>
  (req: Request, res: Response, next: NextFunction) => {
    try {
      // Sécurité : conserver la compatibilité body-only tout en validant query/params.
      const schemas = isZodSchema(schema) ? { body: schema } : isSchemaMap(schema) ? schema : {};
      if (schemas.body) {
        req.body = schemas.body.parse(req.body);
      }
      if (schemas.query) {
        req.query = schemas.query.parse(req.query);
      }
      if (schemas.params) {
        req.params = schemas.params.parse(req.params);
      }
      return next();
    } catch (error: unknown) {
      if (error instanceof ZodError) {
        secureLogger.warn('VALIDATION_ERROR', {
          path: req.path,
          errorCount: error.errors?.length
        });
        return res.status(400).json({ error: 'Invalid input', details: error.errors });
      }
      const errorCode = 'VALIDATION_UNKNOWN';
      const errorType = error instanceof Error ? error.name : typeof error;
      const rawMessage = error instanceof Error ? error.message : '';
      const errorMessage = process.env.NODE_ENV === 'production'
        ? undefined
        : rawMessage;
      secureLogger.error('UNKNOWN_VALIDATION_ERROR', {
        path: req.path,
        errorCode,
        errorType,
        errorMessage
      });
      return res.status(400).json({ error: 'Invalid input' });
    }
  };
