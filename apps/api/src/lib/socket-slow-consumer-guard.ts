import type { Socket } from 'socket.io';
import { secureLogger } from '../utils/secure-logger';

const SLOW_CONSUMER_MODE = String(process.env.WS_SLOW_CONSUMER_GUARD || 'off').toLowerCase();
const SLOW_CONSUMER_GUARD_ENABLED = SLOW_CONSUMER_MODE === 'on' || SLOW_CONSUMER_MODE === 'true';
const SLOW_CONSUMER_CHECK_INTERVAL_MS = Number(process.env.WS_SLOW_CONSUMER_CHECK_INTERVAL_MS || '1000');
const SLOW_CONSUMER_MAX_STREAK = Number(process.env.WS_SLOW_CONSUMER_MAX_STREAK || '5');
const SLOW_CONSUMER_MAX_BUFFERED_PACKETS = Number(process.env.WS_SLOW_CONSUMER_MAX_BUFFERED_PACKETS || '128');

type BackpressureSnapshot = {
  writable: boolean | null;
  bufferedPackets: number | null;
};

type SlowConsumerMetrics = {
  enabled: boolean;
  checks: number;
  overLimit: number;
  disconnectCount: number;
  typingDropped: number;
  maxBufferedPacketsObserved: number;
};

const metrics: SlowConsumerMetrics = {
  enabled: SLOW_CONSUMER_GUARD_ENABLED,
  checks: 0,
  overLimit: 0,
  disconnectCount: 0,
  typingDropped: 0,
  maxBufferedPacketsObserved: 0
};

function readBackpressureSnapshot(socket: Socket): BackpressureSnapshot {
  const conn = (socket as any).conn;
  const writable = typeof conn?.transport?.writable === 'boolean' ? conn.transport.writable : null;
  const bufferedPackets = Array.isArray(conn?.writeBuffer) ? conn.writeBuffer.length : null;
  return { writable, bufferedPackets };
}

export function isSocketCongested(socket: Socket): boolean {
  if (!SLOW_CONSUMER_GUARD_ENABLED) return false;
  const snapshot = readBackpressureSnapshot(socket);
  const packetPressure = snapshot.bufferedPackets !== null && snapshot.bufferedPackets > SLOW_CONSUMER_MAX_BUFFERED_PACKETS;
  return snapshot.writable === false || packetPressure;
}

export function registerTypingDrop(): void {
  metrics.typingDropped += 1;
}

export function attachSlowConsumerGuard(socket: Socket): void {
  if (!SLOW_CONSUMER_GUARD_ENABLED) return;

  let overLimitStreak = 0;

  const timer = setInterval(() => {
    const snapshot = readBackpressureSnapshot(socket);
    metrics.checks += 1;

    if (typeof snapshot.bufferedPackets === 'number') {
      metrics.maxBufferedPacketsObserved = Math.max(metrics.maxBufferedPacketsObserved, snapshot.bufferedPackets);
    }

    const overPackets =
      typeof snapshot.bufferedPackets === 'number' && snapshot.bufferedPackets > SLOW_CONSUMER_MAX_BUFFERED_PACKETS;
    const overLimit = snapshot.writable === false || overPackets;

    if (!overLimit) {
      overLimitStreak = 0;
      return;
    }

    overLimitStreak += 1;
    metrics.overLimit += 1;

    if (overLimitStreak < SLOW_CONSUMER_MAX_STREAK) {
      return;
    }

    metrics.disconnectCount += 1;
    secureLogger.warn('WS_SLOW_CONSUMER_DISCONNECTED', {
      socketId: socket.id.length > 8 ? `${socket.id.slice(0, 8)}...` : socket.id,
      overLimitStreak,
      writable: snapshot.writable,
      bufferedPackets: snapshot.bufferedPackets
    });

    socket.emit('socket-error', {
      ok: false,
      error: {
        code: 'RATE_LIMITED',
        message: 'Connection temporarily unavailable'
      }
    });
    socket.disconnect(true);
  }, SLOW_CONSUMER_CHECK_INTERVAL_MS);

  socket.on('disconnect', () => {
    clearInterval(timer);
  });
}

export function getSlowConsumerMetrics(): SlowConsumerMetrics & {
  checkIntervalMs: number;
  maxStreak: number;
  maxBufferedPackets: number;
} {
  return {
    ...metrics,
    checkIntervalMs: SLOW_CONSUMER_CHECK_INTERVAL_MS,
    maxStreak: SLOW_CONSUMER_MAX_STREAK,
    maxBufferedPackets: SLOW_CONSUMER_MAX_BUFFERED_PACKETS
  };
}

export function resetSlowConsumerMetricsForTests(): void {
  metrics.checks = 0;
  metrics.overLimit = 0;
  metrics.disconnectCount = 0;
  metrics.typingDropped = 0;
  metrics.maxBufferedPacketsObserved = 0;
}
