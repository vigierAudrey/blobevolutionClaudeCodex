'use client';

import { useCallback, useRef, useState } from 'react';
import { Bell, X, CheckCheck } from 'lucide-react';
import Link from 'next/link';
import { useNotifications, type NotificationItem } from '../hooks/useNotifications';
import { BlobBadge, BlobButton, BlobEmptyState } from './blob';

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
      className={`flex cursor-pointer gap-3 px-4 py-3 transition-colors hover:bg-blob-sand dark:hover:bg-white/6 ${isUnread ? 'bg-blob-yellow/15' : ''}`}
      onClick={() => { if (isUnread) onRead(item.id); }}
    >
      <span className="mt-0.5 shrink-0 text-xl">{icon}</span>
      <div className="flex-1 min-w-0">
        <p className={`truncate text-sm ${isUnread ? 'font-black' : 'font-medium'}`}>
          {item.title}
        </p>
        <p className="mt-0.5 line-clamp-2 text-xs text-blob-black/56 dark:text-white/55">{item.body}</p>
      </div>
      {isUnread && (
        <span className="mt-1.5 h-2 w-2 shrink-0 rounded-sm bg-blob-yellow" />
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
        className="relative rounded-sm border-2 border-transparent p-2 transition-colors hover:border-blob-black hover:bg-white dark:hover:border-white/40 dark:hover:bg-white/8 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blob-yellow"
      >
        <Bell className="h-5 w-5 text-blob-black dark:text-white" />
        {unreadCount > 0 && (
          <span className="absolute -right-2 -top-2" aria-hidden>
            <BlobBadge variant="yellow">{unreadCount > 99 ? '99+' : unreadCount}</BlobBadge>
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
            className="absolute right-0 top-full z-50 mt-2 w-80 overflow-hidden rounded-sm border-2 border-blob-black dark:border-white/20 bg-white dark:bg-[hsl(220_14%_12%)] text-blob-black dark:text-white shadow-xl sm:w-96"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b-2 border-blob-sand-deep dark:border-white/10 bg-blob-sand dark:bg-[hsl(220_14%_16%)] px-4 py-3">
              <h2 className="text-sm font-black uppercase tracking-widest">Notifications</h2>
              <div className="flex items-center gap-2">
                {unreadCount > 0 && (
                  <BlobButton type="button" variant="outlineDark" size="sm" onClick={handleMarkAllRead} title="Tout marquer comme lu">
                    <CheckCheck className="w-3.5 h-3.5" />
                    Tout lire
                  </BlobButton>
                )}
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-sm border-2 border-transparent p-1 transition-colors hover:border-blob-black hover:bg-white dark:hover:border-white/30 dark:hover:bg-white/8"
                  aria-label="Fermer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* List */}
            <div className="max-h-[60vh] divide-y-2 divide-blob-sand-deep dark:divide-white/10 overflow-y-auto">
              {loading ? (
                <div className="px-4 py-8 text-center text-sm text-blob-black/56">
                  Chargement…
                </div>
              ) : notifications.length === 0 ? (
                <div className="p-4">
                  <BlobEmptyState title="Aucune notification" />
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
                      className="w-full py-3 text-xs font-black uppercase tracking-widest text-blob-black/64 dark:text-white/55 transition-colors hover:bg-blob-sand hover:text-blob-black dark:hover:bg-white/6 dark:hover:text-white"
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
