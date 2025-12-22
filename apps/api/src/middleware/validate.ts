import type { Request, Response, NextFunction } from 'express';
import type { ZodTypeAny } from 'zod';
import { secureLogger } from '../utils/secure-logger';

/**
 * Wraps a Zod schema into an Express middleware.
 * Returns 400 with the validation errors when parsing fails.
 */
export const validate =
  (schema: ZodTypeAny) =>
  (req: Request, res: Response, next: NextFunction) => {
    try {
      req.body = schema.parse(req.body);
      return next();
    } catch (error: any) {
      if (error?.name === 'ZodError') {
        secureLogger.warn('VALIDATION_ERROR', {
          path: req.path,
          errorCount: error.errors?.length
        });
        return res.status(400).json({ error: 'Invalid input', details: error.errors });
      }
      secureLogger.error('UNKNOWN_VALIDATION_ERROR', {
        path: req.path,
        error: error?.message
      });
      return res.status(400).json({ error: 'Invalid input' });
    }
  };
