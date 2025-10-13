import type { Request, Response, NextFunction } from 'express';
import type { ZodSchema } from 'zod';

/**
 * Wraps a Zod schema into an Express middleware.
 * Returns 400 with the validation errors when parsing fails.
 */
export const validate =
  <T>(schema: ZodSchema<T>) =>
  (req: Request, res: Response, next: NextFunction) => {
    try {
      req.body = schema.parse(req.body);
      return next();
    } catch (error: any) {
      if (error?.name === 'ZodError') {
        return res.status(400).json({ error: 'Invalid input', details: error.errors });
      }
      return res.status(400).json({ error: 'Invalid input' });
    }
  };
