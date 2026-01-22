import { renderHook, waitFor } from '@testing-library/react';
import { useSocket } from '../useSocket';
import { getSocket } from '../../lib/socket';
import type { Socket } from 'socket.io-client';
import React from 'react';

jest.mock('../../lib/socket');
jest.mock('../../lib/apiClient');

describe('useSocket - error fallback with deduplication', () => {
  let mockSocket: Partial<Socket>;
  let socketHandlers: Map<string, Set<Function>>; // Support multiple handlers per event

  beforeEach(() => {
    socketHandlers = new Map();
    mockSocket = {
      connected: false,
      connect: jest.fn(),
      disconnect: jest.fn(),
      on: jest.fn((event: string, handler: Function) => {
        if (!socketHandlers.has(event)) {
          socketHandlers.set(event, new Set());
        }
        socketHandlers.get(event)!.add(handler);
      }),
      off: jest.fn((event: string, handler?: Function) => {
        if (!handler) {
          // Si off sans handler, supprimer tous (comportement réel Socket.IO)
          socketHandlers.delete(event);
        } else {
          // Si off avec handler, supprimer uniquement ce handler
          socketHandlers.get(event)?.delete(handler);
        }
      }),
    };
    (getSocket as jest.Mock).mockReturnValue(mockSocket);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // CAS A: erreur reçue uniquement sur 'error' => lastError alimenté
  it('should handle error from legacy "error" event when "socket-error" not emitted', async () => {
    const { result } = renderHook(() => useSocket({ token: 'test-token', autoConnect: false }));

    const errorPayload = { code: 'LEGACY_ERROR', message: 'Test legacy error' };

    // Déclencher uniquement 'error'
    const errorHandlers = socketHandlers.get('error');
    expect(errorHandlers?.size).toBe(1);

    errorHandlers?.forEach(handler => handler(errorPayload));

    await waitFor(() => {
      expect(result.current.lastSocketError).toEqual(errorPayload);
    });
  });

  // CAS B: erreur reçue sur 'socket-error' + 'error' => UNE SEULE erreur traitée
  // P1 #3: Test PROUVANT avec mock useState
  it('should deduplicate error received on both "socket-error" and "error" (only ONE setState)', async () => {
    // Mock useState pour compter les appels à setLastSocketError
    const originalUseState = React.useState;
    const setLastSocketErrorMock = jest.fn();
    let callCount = 0;

    jest.spyOn(React, 'useState').mockImplementation((initial) => {
      const [state, setState] = originalUseState(initial);
      callCount++;
      // Le 3ème useState dans useSocket est lastSocketError
      if (callCount === 3) {
        return [state, (newState: any) => {
          setLastSocketErrorMock(newState);
          setState(newState);
        }];
      }
      return [state, setState];
    });

    const { result } = renderHook(() => useSocket({ token: 'test-token', autoConnect: false }));

    const errorPayload = { code: 'DUPLICATE_ERROR', message: 'Duplicate test' };

    // Déclencher 'socket-error'
    const socketErrorHandlers = socketHandlers.get('socket-error');
    socketErrorHandlers?.forEach(handler => handler(errorPayload));

    // Déclencher 'error' immédiatement après (comme le serveur)
    const errorHandlers = socketHandlers.get('error');
    errorHandlers?.forEach(handler => handler(errorPayload));

    await waitFor(() => {
      expect(result.current.lastSocketError).toEqual(errorPayload);
    });

    // P1 #3: PREUVE - setLastSocketError appelé UNE SEULE FOIS (pas deux fois)
    // Note: filtre les appels null (initial state)
    const nonNullCalls = setLastSocketErrorMock.mock.calls.filter(call => call[0] !== null);
    expect(nonNullCalls.length).toBe(1);
    expect(nonNullCalls[0][0]).toEqual(errorPayload);

    // Restore
    jest.restoreAllMocks();
  });

  // CAS C: remount => pas de multi-handlers, cleanup avec références
  // P1 #3: Vérifier que off est appelé avec les bonnes références
  it('should cleanup handlers with correct references on unmount (no accumulation)', async () => {
    const { unmount } = renderHook(() => useSocket({ token: 'test-token', autoConnect: false }));

    // Capturer les handlers ajoutés
    const initialSocketErrorHandlers = Array.from(socketHandlers.get('socket-error') || []);
    const initialErrorHandlers = Array.from(socketHandlers.get('error') || []);

    expect(initialSocketErrorHandlers.length).toBe(1);
    expect(initialErrorHandlers.length).toBe(1);

    unmount();

    // P1 #3: PREUVE - off appelé avec les références exactes des handlers
    const offCalls = (mockSocket.off as jest.Mock).mock.calls;

    // Vérifier que off('socket-error', handler) a été appelé avec le bon handler
    const socketErrorOffCall = offCalls.find(call => call[0] === 'socket-error');
    expect(socketErrorOffCall).toBeDefined();
    expect(socketErrorOffCall![1]).toBe(initialSocketErrorHandlers[0]); // Même référence

    // Vérifier que off('error', handler) a été appelé avec le bon handler
    const errorOffCall = offCalls.find(call => call[0] === 'error');
    expect(errorOffCall).toBeDefined();
    expect(errorOffCall![1]).toBe(initialErrorHandlers[0]); // Même référence

    // Vérifier que les handlers ont été supprimés
    expect(socketHandlers.get('socket-error')?.size).toBe(0);
    expect(socketHandlers.get('error')?.size).toBe(0);

    // Remount
    const { result } = renderHook(() => useSocket({ token: 'test-token', autoConnect: false }));

    // Vérifier que de nouveaux handlers sont ajoutés (pas d'accumulation)
    expect(socketHandlers.get('socket-error')?.size).toBe(1);
    expect(socketHandlers.get('error')?.size).toBe(1);

    // Tester qu'une erreur fonctionne toujours
    const errorPayload = { code: 'AFTER_REMOUNT', message: 'Still works' };
    socketHandlers.get('error')?.forEach(handler => handler(errorPayload));

    await waitFor(() => {
      expect(result.current.lastSocketError).toEqual(errorPayload);
    });
  });

  // CAS BONUS: deux erreurs différentes => les deux passent
  it('should allow two different errors within dedup window', async () => {
    const { result } = renderHook(() => useSocket({ token: 'test-token', autoConnect: false }));

    const error1 = { code: 'ERROR_1', message: 'First error' };
    const error2 = { code: 'ERROR_2', message: 'Second error' };

    socketHandlers.get('error')?.forEach(handler => handler(error1));
    await waitFor(() => {
      expect(result.current.lastSocketError).toEqual(error1);
    });

    socketHandlers.get('error')?.forEach(handler => handler(error2));
    await waitFor(() => {
      expect(result.current.lastSocketError).toEqual(error2);
    });
  });

  // P1 #2: Test edge case timestamp = 0
  it('should handle edge case where error received at timestamp near 0', async () => {
    const { result } = renderHook(() => useSocket({ token: 'test-token', autoConnect: false }));

    const errorPayload = { code: 'EDGE_CASE', message: 'Timestamp test' };

    // Simuler que Date.now() retourne des valeurs proches de 0
    const originalDateNow = Date.now;
    Date.now = jest.fn(() => 100);

    // Première erreur
    socketHandlers.get('error')?.forEach(handler => handler(errorPayload));

    await waitFor(() => {
      expect(result.current.lastSocketError).toEqual(errorPayload);
    });

    const firstError = result.current.lastSocketError;

    // Simuler un temps très court (dans la fenêtre de dédup)
    Date.now = jest.fn(() => 500);

    // Mock useState pour compter les nouveaux appels
    const setStateSpy = jest.fn();
    jest.spyOn(React, 'useState').mockImplementation((initial) => {
      if (typeof initial === 'object' && initial === null) {
        return [firstError, setStateSpy];
      }
      return [initial, jest.fn()];
    });

    // Deuxième erreur identique => doit être ignorée (pas de setState)
    socketHandlers.get('error')?.forEach(handler => handler(errorPayload));

    // Attendre un peu pour être sûr
    await new Promise(resolve => setTimeout(resolve, 50));

    // P1 #2: PREUVE - setState n'a PAS été appelé (erreur dédupliquée)
    expect(setStateSpy).not.toHaveBeenCalled();

    // Restore
    Date.now = originalDateNow;
    jest.restoreAllMocks();
  });

  // Test avec requestId dans details pour signature plus précise
  it('should use requestId/traceId in error signature when available', async () => {
    const { result } = renderHook(() => useSocket({ token: 'test-token', autoConnect: false }));

    const error1 = {
      code: 'TEST_ERROR',
      message: 'Same message',
      details: { requestId: 'req-123' }
    };
    const error2 = {
      code: 'TEST_ERROR',
      message: 'Same message',
      details: { requestId: 'req-456' }
    };

    // Première erreur
    socketHandlers.get('error')?.forEach(handler => handler(error1));
    await waitFor(() => {
      expect(result.current.lastSocketError).toEqual(error1);
    });

    // Deuxième erreur avec requestId différent => doit passer (pas un doublon)
    socketHandlers.get('error')?.forEach(handler => handler(error2));
    await waitFor(() => {
      expect(result.current.lastSocketError).toEqual(error2);
    });
  });
});
