import type { Request, Response, NextFunction } from 'express';
import type { ZodTypeAny } from 'zod';

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
        console.error('❌ Zod validation error:', JSON.stringify(error.errors, null, 2));
        console.error('📦 Request body was:', JSON.stringify(req.body, null, 2));
        return res.status(400).json({ error: 'Invalid input', details: error.errors });
      }
      console.error('❌ Unknown validation error:', error);
      return res.status(400).json({ error: 'Invalid input' });
    }
  };
