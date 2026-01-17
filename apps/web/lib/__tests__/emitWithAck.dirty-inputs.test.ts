/**
 * Tests de régression pour entrées sales dans emitWithAck
 * Garantit que le système gère proprement les ACK malformés
 * sans crasher ni compromettre la sécurité des types
 */

import { emitWithAck } from '../emitWithAck';
import { z } from 'zod';
import type { Socket } from 'socket.io-client';

describe('emitWithAck - dirty inputs regression tests', () => {
  const successSchema = z.object({
    ok: z.literal(true),
    data: z.object({ id: z.string() }),
  });

  it('devrait rejeter avec CLIENT_TIMEOUT si ACK est manquant (timeout)', async () => {
    const mockSocket = {
      emit: jest.fn((_event, _payload, _callback) => {
        // Ne jamais appeler callback = ACK jamais reçu
      }),
    } as unknown as Socket;

    await expect(
      emitWithAck(mockSocket, 'test-event', {}, successSchema, { timeoutMs: 100 })
    ).rejects.toMatchObject({
      code: 'CLIENT_TIMEOUT',
      message: expect.stringContaining('timeout'),
    });
  });

  it('devrait rejeter avec CLIENT_TIMEOUT si ACK a format invalide (Zod error)', async () => {
    const mockSocket = {
      emit: jest.fn((event, payload, callback) => {
        // Retourner un ACK invalide (ni error ni success)
        callback({ invalid: 'response' });
      }),
    } as unknown as Socket;

    await expect(
      emitWithAck(mockSocket, 'test-event', {}, successSchema)
    ).rejects.toMatchObject({
      code: 'CLIENT_TIMEOUT', // Zod parse error => traité comme invalid ACK
      message: expect.any(String),
    });
  });

  it('devrait gérer ACK avec ok:false (error payload)', async () => {
    const mockSocket = {
      emit: jest.fn((event, payload, callback) => {
        callback({
          ok: false,
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Server error',
            details: { reason: 'DB timeout' },
          },
        });
      }),
    } as unknown as Socket;

    await expect(
      emitWithAck(mockSocket, 'test-event', {}, successSchema)
    ).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'Server error',
      details: { reason: 'DB timeout' },
    });
  });

  it('devrait gérer ACK avec ok:false mais error object incomplet', async () => {
    const mockSocket = {
      emit: jest.fn((event, payload, callback) => {
        callback({
          ok: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Bad request',
            // details manque
          },
        });
      }),
    } as unknown as Socket;

    await expect(
      emitWithAck(mockSocket, 'test-event', {}, successSchema)
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'Bad request',
      details: undefined,
    });
  });

  it('devrait gérer ACK null/undefined sans crasher', async () => {
    const mockSocket = {
      emit: jest.fn((event, payload, callback) => {
        callback(null);
      }),
    } as unknown as Socket;

    await expect(
      emitWithAck(mockSocket, 'test-event', {}, successSchema)
    ).rejects.toMatchObject({
      code: 'CLIENT_TIMEOUT',
      message: expect.any(String),
    });
  });

  it('devrait gérer ACK qui est une string au lieu d\'un object', async () => {
    const mockSocket = {
      emit: jest.fn((event, payload, callback) => {
        callback('Unexpected string response');
      }),
    } as unknown as Socket;

    await expect(
      emitWithAck(mockSocket, 'test-event', {}, successSchema)
    ).rejects.toMatchObject({
      code: 'CLIENT_TIMEOUT',
      message: expect.any(String),
    });
  });

  it('devrait gérer socket null sans crasher', async () => {
    await expect(
      emitWithAck(null, 'test-event', {}, successSchema)
    ).rejects.toMatchObject({
      code: 'CLIENT_TIMEOUT',
      message: 'Socket not connected',
    });
  });

  it('devrait résoudre correctement un ACK valide avec ok:true', async () => {
    const mockSocket = {
      emit: jest.fn((event, payload, callback) => {
        callback({
          ok: true,
          data: { id: 'msg-123' },
        });
      }),
    } as unknown as Socket;

    const result = await emitWithAck(mockSocket, 'test-event', {}, successSchema);
    expect(result).toEqual({ id: 'msg-123' });
  });
});
