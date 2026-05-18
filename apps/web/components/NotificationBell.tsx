'use client';

import { useCallback, useRef, useState } from 'react';
import { Bell, X, CheckCheck } from 'lucide-react';
import Link from 'next/link';
import { useNotifications, type NotificationItem } from '../hooks/useNotifications';

const TYPE_ICON: Record<string, string> = {
  NEW_MESSAGE: '💬',
  NEW_MATCH: '🎯',
  GROUP_INVITATION: '👥',
  SYSTEM: 'ℹ️',
};

function NotificationRow({
  item,
  onRead,
}: {
  item: NotificationItem;
  onRead: (id: string) => void;
}) {
  const icon = TYPE_ICON[item.type] ?? '🔔';
  const isUnread = item.readAt === null;

  const content = (
    <div
      className={`flex gap-3 px-4 py-3 hover:bg-muted/50 transition-colors cursor-pointer ${isUnread ? 'bg-blue-50/60 dark:bg-blue-950/20' : ''}`}
      onClick={() => { if (isUnread) onRead(item.id); }}
    >
      <span className="text-xl mt-0.5 shrink-0">{icon}</span>
      <div className="flex-1 min-w-0">
        <p className={`text-sm truncate ${isUnread ? 'font-semibold' : 'font-normal'}`}>
          {item.title}
        </p>
        <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{item.body}</p>
      </div>
      {isUnread && (
        <span className="mt-1.5 shrink-0 w-2 h-2 rounded-full bg-blue-500" />
      )}
    </div>
  );

  return item.url ? (
    <Link href={item.url} onClick={() => { if (isUnread) onRead(item.id); }} className="block">
      {content}
    </Link>
  ) : (
    <div>{content}</div>
  );
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const { unreadCount, notifications, loading, markRead, markAllRead, refresh, loadMore, nextCursor } = useNotifications();

  const toggle = useCallback(async () => {
    if (!open) await refresh();
    setOpen((v) => !v);
  }, [open, refresh]);

  const handleMarkAllRead = useCallback(async () => {
    await markAllRead();
  }, [markAllRead]);

  return (
    <div className="relative" ref={panelRef}>
      {/* Bell button */}
      <button
        type="button"
        onClick={toggle}
        aria-label={`Notifications${unreadCount > 0 ? ` — ${unreadCount} non lues` : ''}`}
        className="relative p-2 rounded-xl hover:bg-muted/60 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Bell className="w-5 h-5 text-foreground" />
        {unreadCount > 0 && (
          <span
            className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-blue-600 text-white text-[10px] font-bold px-1 tabular-nums"
            aria-hidden
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown panel */}
      {open && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40"
            aria-hidden
            onClick={() => setOpen(false)}
          />

          {/* Panel */}
          <div
            role="dialog"
            aria-label="Notifications"
            className="absolute right-0 top-full mt-2 z-50 w-80 sm:w-96 rounded-2xl border-2 bg-background shadow-xl overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/30">
              <h2 className="text-sm font-semibold">Notifications</h2>
              <div className="flex items-center gap-2">
                {unreadCount > 0 && (
                  <button
                    type="button"
                    onClick={handleMarkAllRead}
                    className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
                    title="Tout marquer comme lu"
                  >
                    <CheckCheck className="w-3.5 h-3.5" />
                    Tout lire
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="p-1 rounded-lg hover:bg-muted transition-colors"
                  aria-label="Fermer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* List */}
            <div className="max-h-[60vh] overflow-y-auto divide-y divide-border/50">
              {loading ? (
                <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                  Chargement…
                </div>
              ) : notifications.length === 0 ? (
                <div className="px-4 py-8 text-center">
                  <Bell className="w-8 h-8 mx-auto mb-2 text-muted-foreground/40" />
                  <p className="text-sm text-muted-foreground">Aucune notification</p>
                </div>
              ) : (
                <>
                  {notifications.map((n) => (
                    <NotificationRow
                      key={n.id}
                      item={n}
                      onRead={markRead}
                    />
                  ))}
                  {nextCursor && (
                    <button
                      type="button"
                      onClick={loadMore}
                      className="w-full py-3 text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      Voir plus
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
