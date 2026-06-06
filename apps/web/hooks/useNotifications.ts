'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiRequest } from '../lib/csrf';
import { getSocket } from '../lib/socket';

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string;
  url: string | null;
  readAt: string | null;
  createdAt: string;
}

interface UseNotificationsOptions {
  pollIntervalMs?: number;
}

interface UseNotificationsResult {
  unreadCount: number;
  notifications: NotificationItem[];
  nextCursor: string | null;
  loading: boolean;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  loadMore: () => Promise<void>;
  refresh: () => Promise<void>;
}

const DEFAULT_POLL_MS = 30_000;

export function useNotifications(options: UseNotificationsOptions = {}): UseNotificationsResult {
  const pollMs = options.pollIntervalMs ?? DEFAULT_POLL_MS;

  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  const fetchUnreadCount = useCallback(async () => {
    try {
      const res = await apiRequest('/notifications/unread-count', { method: 'GET' });
      if (!res.ok || !mountedRef.current) return;
      const data = await res.json() as { count: number };
      setUnreadCount(data.count);
    } catch {
      // silently ignore polling errors
    }
  }, []);

  const fetchList = useCallback(async (cursor?: string) => {
    try {
      const url = cursor
        ? `/notifications?cursor=${encodeURIComponent(cursor)}&limit=20`
        : '/notifications?limit=20';
      const res = await apiRequest(url, { method: 'GET' });
      if (!res.ok || !mountedRef.current) return;
      const data = await res.json() as { items: NotificationItem[]; nextCursor: string | null };
      if (cursor) {
        setNotifications((prev) => [...prev, ...data.items]);
      } else {
        setNotifications(data.items);
      }
      setNextCursor(data.nextCursor);
      const unreadInPage = data.items.filter((n) => n.readAt === null).length;
      setUnreadCount((prev) => unreadInPage + (cursor ? prev : 0));
    } catch {
      // silently ignore
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    await fetchList();
    await fetchUnreadCount();
  }, [fetchList, fetchUnreadCount]);

  const loadMore = useCallback(async () => {
    if (!nextCursor) return;
    await fetchList(nextCursor);
  }, [nextCursor, fetchList]);

  const markRead = useCallback(async (id: string) => {
    try {
      await apiRequest(`/notifications/${id}/read`, { method: 'PATCH' });
      if (!mountedRef.current) return;
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n))
      );
      setUnreadCount((c) => Math.max(0, c - 1));
    } catch {
      // silently ignore
    }
  }, []);

  const markAllRead = useCallback(async () => {
    try {
      await apiRequest('/notifications/read-all', { method: 'POST' });
      if (!mountedRef.current) return;
      const now = new Date().toISOString();
      setNotifications((prev) => prev.map((n) => ({ ...n, readAt: n.readAt ?? now })));
      setUnreadCount(0);
    } catch {
      // silently ignore
    }
  }, []);

  // Initial load
  useEffect(() => {
    mountedRef.current = true;
    void refresh();
    return () => { mountedRef.current = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Polling — pauses when tab is hidden
  useEffect(() => {
    const start = () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = setInterval(() => {
        if (!document.hidden) void fetchUnreadCount();
      }, pollMs);
    };
    const stop = () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
    const onVisibility = () => {
      if (document.hidden) { stop(); } else { void fetchUnreadCount(); start(); }
    };

    start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [pollMs, fetchUnreadCount]);

  // WebSocket listener for real-time notification events
  useEffect(() => {
    let active = true;
    const socket = getSocket();
    if (!socket) return;

    const handler = () => {
      if (!active) return;
      // Refresh the unread count; full list refresh happens on panel open
      void fetchUnreadCount();
    };
    socket.on('notification', handler);
    return () => {
      active = false;
      socket.off('notification', handler);
    };
  }, [fetchUnreadCount]);

  return {
    unreadCount,
    notifications,
    nextCursor,
    loading,
    markRead,
    markAllRead,
    loadMore,
    refresh,
  };
}
