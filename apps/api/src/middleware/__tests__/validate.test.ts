import { validate } from '../validate';
import { z, type ZodTypeAny } from 'zod';
import type { Request, Response, NextFunction } from 'express';
import { secureLogger } from '../../utils/secure-logger';

describe('validate middleware', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let nextFunction: NextFunction;

  beforeEach(() => {
    mockRequest = {
      body: {},
      // Sécurité : préparer query/params pour la validation étendue.
      query: {},
      params: {},
      path: '/test',
    };
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    nextFunction = jest.fn();
  });

  describe('successful validation', () => {
    it('should call next() when body is valid', () => {
      const schema = z.object({
        name: z.string(),
        age: z.number(),
      });

      mockRequest.body = { name: 'John', age: 30 };

      const middleware = validate(schema);
      middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
      expect(mockResponse.status).not.toHaveBeenCalled();
      expect(mockResponse.json).not.toHaveBeenCalled();
    });

    it('should transform data according to schema', () => {
      const schema = z.object({
        age: z.string().transform((val) => parseInt(val, 10)),
      });

      mockRequest.body = { age: '25' };

      const middleware = validate(schema);
      middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(mockRequest.body).toEqual({ age: 25 });
      expect(nextFunction).toHaveBeenCalled();
    });

    it('should handle optional fields correctly', () => {
      const schema = z.object({
        name: z.string(),
        nickname: z.string().optional(),
      });

      mockRequest.body = { name: 'Jane' };

      const middleware = validate(schema);
      middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
      expect(mockRequest.body).toEqual({ name: 'Jane' });
    });
  });

  describe('validation errors', () => {
    it('should return 400 with error details when validation fails', () => {
      const schema = z.object({
        email: z.string().email(),
      });

      mockRequest.body = { email: 'invalid-email' };

      const middleware = validate(schema);
      middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Invalid input',
        details: expect.arrayContaining([
          expect.objectContaining({
            code: expect.any(String),
            path: expect.any(Array),
          }),
        ]),
      });
      expect(nextFunction).not.toHaveBeenCalled();
    });

    it('should return 400 when required field is missing', () => {
      const schema = z.object({
        name: z.string(),
        age: z.number(),
      });

      mockRequest.body = { name: 'John' };

      const middleware = validate(schema);
      middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Invalid input',
        details: expect.any(Array),
      });
      expect(nextFunction).not.toHaveBeenCalled();
    });

    it('should return 400 when field type is wrong', () => {
      const schema = z.object({
        age: z.number(),
      });

      mockRequest.body = { age: 'not-a-number' };

      const middleware = validate(schema);
      middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Invalid input',
          details: expect.any(Array),
        })
      );
      expect(nextFunction).not.toHaveBeenCalled();
    });

    it('should handle multiple validation errors', () => {
      const schema = z.object({
        email: z.string().email(),
        age: z.number().min(18),
        name: z.string().min(2),
      });

      mockRequest.body = {
        email: 'invalid',
        age: 10,
        name: 'A',
      };

      const middleware = validate(schema);
      middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      const jsonCall = (mockResponse.json as jest.Mock).mock.calls[0][0];
      expect(jsonCall.details).toHaveLength(3);
      expect(nextFunction).not.toHaveBeenCalled();
    });
  });

  describe('unknown errors', () => {
    it('should return 400 for non-Zod errors', () => {
      const schema = {
        parse: () => {
          throw new Error('Unexpected error');
        },
      } as unknown as ZodTypeAny;

      const middleware = validate(schema);
      middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Invalid input',
      });
      expect(nextFunction).not.toHaveBeenCalled();
    });
  });

  describe('production logging', () => {
    const originalNodeEnv = process.env.NODE_ENV;

    beforeEach(() => {
      process.env.NODE_ENV = 'production';
    });

    afterEach(() => {
      process.env.NODE_ENV = originalNodeEnv;
      jest.restoreAllMocks();
    });

    it('should log code + type without message in production', () => {
      const longMessage = 'x'.repeat(200);
      const schema = {
        parse: () => {
          throw new Error(longMessage);
        },
      } as unknown as ZodTypeAny;

      const errorSpy = jest.spyOn(secureLogger, 'error').mockImplementation(() => undefined);

      const middleware = validate(schema);
      middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      const payload = (errorSpy.mock.calls[0]?.[1] ?? {}) as {
        errorCode?: string;
        errorType?: string;
        errorMessage?: string;
      };

      expect(payload.errorCode).toBe('VALIDATION_UNKNOWN');
      expect(payload.errorType).toBe('Error');
      expect(payload.errorMessage).toBeUndefined();
    });
  });

  describe('edge cases', () => {
    it('should handle empty object when schema expects fields', () => {
      const schema = z.object({
        name: z.string(),
      });

      mockRequest.body = {};

      const middleware = validate(schema);
      middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(nextFunction).not.toHaveBeenCalled();
    });

    it('should handle null body', () => {
      const schema = z.object({
        name: z.string(),
      });

      mockRequest.body = null as any;

      const middleware = validate(schema);
      middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(nextFunction).not.toHaveBeenCalled();
    });

    it('should strip unknown fields when using strict schema', () => {
      const schema = z
        .object({
          name: z.string(),
        })
        .strict();

      mockRequest.body = { name: 'John', extraField: 'should fail' };

      const middleware = validate(schema);
      middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(nextFunction).not.toHaveBeenCalled();
    });

    it('should allow unknown fields when not using strict schema', () => {
      const schema = z.object({
        name: z.string(),
      });

      mockRequest.body = { name: 'John', extraField: 'ignored' };

      const middleware = validate(schema);
      middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
      // Zod strips extra fields by default
      expect(mockRequest.body).toEqual({ name: 'John' });
    });
  });

  // Sécurité : garde-fou sur query/params (régression).
  describe('query & params validation', () => {
    it('should parse query and params when schemas are provided', () => {
      const schema = {
        query: z.object({ page: z.coerce.number().int().min(1) }),
        params: z.object({ id: z.string().uuid() }),
      };

      mockRequest.query = { page: '2' };
      mockRequest.params = { id: '3f2504e0-4f89-11d3-9a0c-0305e82c3301' };

      const middleware = validate(schema);
      middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(mockRequest.query).toEqual({ page: 2 });
      expect(mockRequest.params).toEqual({ id: '3f2504e0-4f89-11d3-9a0c-0305e82c3301' });
      expect(nextFunction).toHaveBeenCalled();
    });

    it('should return 400 when query validation fails', () => {
      const schema = {
        query: z.object({ page: z.coerce.number().int().min(1) }),
      };

      mockRequest.query = { page: '0' };

      const middleware = validate(schema);
      middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Invalid input',
          details: expect.any(Array),
        })
      );
      expect(nextFunction).not.toHaveBeenCalled();
    });
  });
});
