/**
 * Tests de régression pour entrées sales dans emitWithAck
 * Garantit que le système gère proprement les ACK malformés
 * sans crasher ni compromettre la sécurité des types
 */

import { emitWithAck, type SocketEmitter } from '../emitWithAck';
import { z } from 'zod';

describe('emitWithAck - dirty inputs regression tests', () => {
  const successSchema = z.object({
    ok: z.literal(true),
    data: z.object({ id: z.string() }),
  });

  it('devrait rejeter avec CLIENT_TIMEOUT si ACK est manquant (timeout)', async () => {
    const mockSocket: SocketEmitter = {
      emit: jest.fn((_event, _payload, _callback) => {
        // Ne jamais appeler callback = ACK jamais reçu
      }),
    };

    await expect(
      emitWithAck(mockSocket, 'test-event', {}, successSchema, { timeoutMs: 100 })
    ).rejects.toMatchObject({
      code: 'CLIENT_TIMEOUT',
      message: expect.stringContaining('timeout'),
    });
  });

  it('devrait rejeter avec INTERNAL_ERROR si ACK a format invalide (Zod error)', async () => {
    const mockSocket: SocketEmitter = {
      emit: jest.fn((event, payload, callback) => {
        // Retourner un ACK invalide (ni error ni success)
        callback({ invalid: 'response' });
      }),
    };

    await expect(
      emitWithAck(mockSocket, 'test-event', {}, successSchema)
    ).rejects.toMatchObject({
      code: 'INTERNAL_ERROR', // Zod parse error => traité comme invalid ACK
      message: expect.any(String),
    });
  });

  it('devrait gérer ACK avec ok:false (error payload)', async () => {
    const mockSocket: SocketEmitter = {
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
    };

    await expect(
      emitWithAck(mockSocket, 'test-event', {}, successSchema)
    ).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'Server error',
      details: { reason: 'DB timeout' },
    });
  });

  it('devrait gérer ACK avec ok:false mais error object incomplet', async () => {
    const mockSocket: SocketEmitter = {
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
    };

    await expect(
      emitWithAck(mockSocket, 'test-event', {}, successSchema)
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'Bad request',
      details: undefined,
    });
  });

  it('devrait gérer ACK null/undefined sans crasher', async () => {
    const mockSocket: SocketEmitter = {
      emit: jest.fn((event, payload, callback) => {
        callback(null);
      }),
    };

    await expect(
      emitWithAck(mockSocket, 'test-event', {}, successSchema)
    ).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
      message: expect.any(String),
    });
  });

  it('devrait gérer ACK qui est une string au lieu d\'un object', async () => {
    const mockSocket: SocketEmitter = {
      emit: jest.fn((event, payload, callback) => {
        callback('Unexpected string response');
      }),
    };

    await expect(
      emitWithAck(mockSocket, 'test-event', {}, successSchema)
    ).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
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
    const mockSocket: SocketEmitter = {
      emit: jest.fn((event, payload, callback) => {
        callback({
          ok: true,
          data: { id: 'msg-123' },
        });
      }),
    };

    const result = await emitWithAck(mockSocket, 'test-event', {}, successSchema);
    expect(result).toEqual({ id: 'msg-123' });
  });

  it('devrait ignorer late ACK qui arrive après timeout (pas de re-resolve/re-reject)', async () => {
    let capturedCallback: ((...args: unknown[]) => void) | null = null;

    const mockSocket: SocketEmitter = {
      emit: jest.fn((event, payload, callback) => {
        capturedCallback = callback;
        // Ne pas appeler callback immédiatement = simuler un timeout
      }),
    };

    const promise = emitWithAck(mockSocket, 'test-event', {}, successSchema, { timeoutMs: 50 });

    // Attendre que le timeout se déclenche
    await expect(promise).rejects.toMatchObject({
      code: 'CLIENT_TIMEOUT',
      message: expect.stringContaining('timeout'),
    });

    // Maintenant appeler le callback tardivement avec un ACK valide
    expect(capturedCallback).not.toBeNull();
    expect(() => {
      capturedCallback!({
        ok: true,
        data: { id: 'late-msg' },
      });
    }).not.toThrow(); // Ne doit pas crasher

    // La promesse doit rester rejetée avec CLIENT_TIMEOUT (pas de re-resolve)
    await expect(promise).rejects.toMatchObject({
      code: 'CLIENT_TIMEOUT',
    });
  });

  it('devrait gérer ACK avec getter qui throw sans crasher', async () => {
    const mockSocket: SocketEmitter = {
      emit: jest.fn((event, payload, callback) => {
        const poisonedAck = {
          get ok() {
            throw new Error('Getter boom!');
          },
        };
        callback(poisonedAck);
      }),
    };

    await expect(
      emitWithAck(mockSocket, 'test-event', {}, successSchema)
    ).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
      message: expect.stringContaining('Getter boom!'),
    });
  });

  it('devrait gérer multi-args ACK en préférant l\'objet ack-like', async () => {
    const mockSocket: SocketEmitter = {
      emit: jest.fn((event, payload, callback) => {
        // Appeler callback avec 2 args : premier est ack-like
        callback({ ok: true, data: { id: 'multi-123' } }, 'extra-arg');
      }),
    };

    const result = await emitWithAck(mockSocket, 'test-event', {}, successSchema);
    expect(result).toEqual({ id: 'multi-123' });
  });

  it('devrait gérer multi-args ACK sans objet ack-like (rejeter avec INTERNAL_ERROR)', async () => {
    const mockSocket: SocketEmitter = {
      emit: jest.fn((event, payload, callback) => {
        // Appeler callback avec 2 args non-ack-like
        callback('arg1', 'arg2');
      }),
    };

    await expect(
      emitWithAck(mockSocket, 'test-event', {}, successSchema)
    ).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
      message: expect.any(String),
    });
  });
});
