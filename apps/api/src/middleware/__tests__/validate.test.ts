import { validate } from '../validate';
import { z } from 'zod';
import type { Request, Response, NextFunction } from 'express';

describe('validate middleware', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let nextFunction: NextFunction;

  beforeEach(() => {
    mockRequest = {
      body: {},
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
      } as any;

      const middleware = validate(schema);
      middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Invalid input',
      });
      expect(nextFunction).not.toHaveBeenCalled();
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
});
