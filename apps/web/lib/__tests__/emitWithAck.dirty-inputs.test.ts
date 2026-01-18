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

  it('devrait rejeter avec INTERNAL_ERROR si emit() throw synchroniquement', async () => {
    const mockSocket: SocketEmitter = {
      emit: jest.fn(() => {
        throw new Error('Transport error: socket closed');
      }),
    };

    await expect(
      emitWithAck(mockSocket, 'test-event', {}, successSchema, { timeoutMs: 100 })
    ).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'Transport error: socket closed',
      details: expect.objectContaining({
        name: 'Error',
        message: 'Transport error: socket closed',
      }),
    });
  });

  it('devrait gérer multi-args avec getter malicieux + ack valide sans crasher', async () => {
    const mockSocket: SocketEmitter = {
      emit: jest.fn((event, payload, callback) => {
        const poisonedArg = {
          get ok() {
            throw new Error('Malicious getter!');
          },
        };
        const validAck = { ok: true, data: { id: 'safe-123' } };
        // Premier arg est poison, second est valide
        callback(poisonedArg, validAck);
      }),
    };

    // Doit préférer le second arg (ack valide) et résoudre
    const result = await emitWithAck(mockSocket, 'test-event', {}, successSchema);
    expect(result).toEqual({ id: 'safe-123' });
  });

  it('devrait gérer details avec objet circulaire sans crasher (safe serialization)', async () => {
    const mockSocket: SocketEmitter = {
      emit: jest.fn((event, payload, callback) => {
        // Simuler une erreur avec objet circulaire dans details
        const circular: Record<string, unknown> = { foo: 'bar' };
        circular.self = circular;

        callback({
          ok: false,
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Circular error',
            details: circular,
          },
        });
      }),
    };

    const error = await emitWithAck(mockSocket, 'test-event', {}, successSchema).catch(e => e);

    expect(error).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'Circular error',
    });

    // details doit être sérialisable (pas de crash JSON.stringify)
    expect(() => JSON.stringify(error.details)).not.toThrow();
  });

  it('devrait gérer proxy malicieux qui throw sur getOwnPropertyDescriptor', async () => {
    const mockSocket: SocketEmitter = {
      emit: jest.fn((event, payload, callback) => {
        // Proxy qui throw lors de la détection de propriété
        const maliciousProxy = new Proxy(
          {},
          {
            getOwnPropertyDescriptor() {
              throw new Error('Proxy trap explosion!');
            },
          }
        );

        const validAck = { ok: true, data: { id: 'proxy-safe-456' } };

        // Premier arg est proxy malicieux, second est valide
        callback(maliciousProxy, validAck);
      }),
    };

    // Doit skipper le proxy malicieux et utiliser le validAck
    const result = await emitWithAck(mockSocket, 'test-event', {}, successSchema);
    expect(result).toEqual({ id: 'proxy-safe-456' });
  });

  it('devrait gérer objet avec propriété inaccessible dans details (getter throw)', async () => {
    const mockSocket: SocketEmitter = {
      emit: jest.fn((event, payload, callback) => {
        // Objet avec getter qui throw
        const nastyObject = Object.defineProperty({}, 'dangerous', {
          get() {
            throw new Error('Access forbidden!');
          },
          enumerable: true,
        });

        callback({
          ok: false,
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Nasty error',
            details: nastyObject,
          },
        });
      }),
    };

    const error = await emitWithAck(mockSocket, 'test-event', {}, successSchema).catch(e => e);

    expect(error).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'Nasty error',
    });

    // details doit être sérialisable sans crasher
    expect(() => JSON.stringify(error.details)).not.toThrow();

    // La propriété inaccessible devrait être marquée
    expect(error.details).toMatchObject({
      dangerous: '<inaccessible>',
    });
  });

  it('devrait gérer Error dans details avec extraction safe (name, message, stack)', async () => {
    const mockSocket: SocketEmitter = {
      emit: jest.fn(() => {
        throw new TypeError('Network failure');
      }),
    };

    const error = await emitWithAck(mockSocket, 'test-event', {}, successSchema).catch(e => e);

    expect(error).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'Network failure',
      details: {
        name: 'TypeError',
        message: 'Network failure',
      },
    });

    // details.stack doit exister et être une string
    expect(error.details).toHaveProperty('stack');
    expect(typeof error.details.stack).toBe('string');
  });

  it('devrait gérer ZodError dans details avec extraction safe (issues)', async () => {
    const mockSocket: SocketEmitter = {
      emit: jest.fn((event, payload, callback) => {
        // Simuler une ZodError dans details
        const zodError = new z.ZodError([
          {
            code: 'invalid_type',
            expected: 'string',
            received: 'number',
            path: ['field'],
            message: 'Expected string, received number',
          },
        ]);

        callback({
          ok: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Schema validation failed',
            details: zodError,
          },
        });
      }),
    };

    const error = await emitWithAck(mockSocket, 'test-event', {}, successSchema).catch(e => e);

    expect(error).toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'Schema validation failed',
      details: {
        issues: expect.arrayContaining([
          expect.objectContaining({
            code: 'invalid_type',
            path: ['field'],
          }),
        ]),
      },
    });
  });
});
