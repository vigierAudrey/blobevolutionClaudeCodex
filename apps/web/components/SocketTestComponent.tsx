'use client';

import { useState, useEffect } from 'react';
import { useSocket } from '../hooks/useSocket';

/**
 * Composant de test pour vérifier la connexion WebSocket
 *
 * Usage: Ajouter ce composant dans une page protégée pour tester
 */
export function SocketTestComponent({ token }: { token: string }) {
  const { socket, connected, connect, disconnect, emit, on } = useSocket({ token });
  const [status, setStatus] = useState<string>('Déconnecté');
  const [testMessage, setTestMessage] = useState<string>('');

  useEffect(() => {
    if (connected) {
      setStatus('✅ Connecté au WebSocket');
    } else {
      setStatus('❌ Déconnecté');
    }
  }, [connected]);

  const handleConnect = () => {
    connect();
  };

  const handleDisconnect = () => {
    disconnect();
  };

  const handleSendTest = () => {
    emit('test-event', { message: testMessage });
    setTestMessage('');
  };

  return (
    <div style={{
      padding: '20px',
      border: '2px solid #ccc',
      borderRadius: '8px',
      margin: '20px',
      backgroundColor: '#f9f9f9'
    }}>
      <h3 style={{ marginTop: 0 }}>🧪 Test WebSocket</h3>

      <div style={{ marginBottom: '15px' }}>
        <strong>Statut:</strong> <span>{status}</span>
      </div>

      <div style={{ marginBottom: '15px', display: 'flex', gap: '10px' }}>
        <button
          onClick={handleConnect}
          disabled={connected}
          style={{
            padding: '8px 16px',
            backgroundColor: connected ? '#ccc' : '#4CAF50',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: connected ? 'not-allowed' : 'pointer'
          }}
        >
          Se connecter
        </button>

        <button
          onClick={handleDisconnect}
          disabled={!connected}
          style={{
            padding: '8px 16px',
            backgroundColor: !connected ? '#ccc' : '#f44336',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: !connected ? 'not-allowed' : 'pointer'
          }}
        >
          Se déconnecter
        </button>
      </div>

      {connected && (
        <div style={{ marginTop: '15px' }}>
          <p><strong>✅ WebSocket fonctionne !</strong></p>
          <p>Socket ID: {socket?.id}</p>
          <p style={{ fontSize: '12px', color: '#666' }}>
            Tu peux maintenant utiliser le chat temps réel dans ton application.
          </p>
        </div>
      )}

      {!connected && (
        <div style={{ marginTop: '15px' }}>
          <p style={{ color: '#666' }}>
            Clique sur "Se connecter" pour établir la connexion WebSocket.
          </p>
        </div>
      )}
    </div>
  );
}
