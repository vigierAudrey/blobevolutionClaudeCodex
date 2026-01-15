/**
 * Micro-test pour requestStrictWithStatus
 * Vérifie que l'enveloppe est respectée et que status + data sont corrects
 */

import { requestStrictWithStatus } from '../requestStrict';
import { z } from 'zod';

// Mock fetch globally
global.fetch = jest.fn();

describe('requestStrictWithStatus', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should return { data, status } when envelope response is ok:true', async () => {
    const mockData = { id: 'msg-123', content: 'Hello' };
    const mockResponse = {
      ok: true,
      status: 201,
      url: 'http://localhost:4000/test',
      text: async () => JSON.stringify({ ok: true, data: mockData }),
    };

    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse);

    const schema = z.object({ id: z.string(), content: z.string() });
    const result = await requestStrictWithStatus('/test', { method: 'POST' }, schema);

    expect(result).toEqual({
      data: mockData,
      status: 201,
    });

    // Verify X-API-ENVELOPE header was set
    const callArgs = (global.fetch as jest.Mock).mock.calls[0];
    const headers = new Headers(callArgs[1].headers);
    expect(headers.get('X-API-ENVELOPE')).toBe('1');
  });

  it('should throw when envelope response is ok:false', async () => {
    const mockError = {
      ok: false,
      status: 403,
      url: 'http://localhost:4000/test',
      text: async () => JSON.stringify({
        ok: false,
        error: {
          code: 'FORBIDDEN',
          message: 'Access denied',
          details: { reason: 'insufficient permissions' }
        }
      }),
    };

    (global.fetch as jest.Mock).mockResolvedValueOnce(mockError);

    const schema = z.object({ id: z.string() });

    await expect(
      requestStrictWithStatus('/test', { method: 'POST' }, schema)
    ).rejects.toMatchObject({
      message: 'Access denied',
      code: 'FORBIDDEN',
      status: 403,
      details: { reason: 'insufficient permissions' }
    });
  });

  it('should throw when envelope is malformed', async () => {
    const mockResponse = {
      ok: true,
      status: 200,
      url: 'http://localhost:4000/test',
      text: async () => JSON.stringify({ unexpected: 'format' }),
    };

    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse);

    const schema = z.object({ id: z.string() });

    await expect(
      requestStrictWithStatus('/test', { method: 'GET' }, schema)
    ).rejects.toMatchObject({
      code: 'INVALID_ENVELOPE',
      message: 'Invalid enveloped response',
      status: 200
    });
  });
});
