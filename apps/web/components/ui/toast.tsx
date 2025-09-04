"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

type ToastType = 'success' | 'error' | 'info';
type Toast = { id: string; type: ToastType; message: string; timeout: number };

type ToastCtx = {
  toast: (message: string, type?: ToastType, timeoutMs?: number) => void;
};

const ToastContext = createContext<ToastCtx | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((message: string, type: ToastType = 'info', timeoutMs = 3000) => {
    const id = crypto.randomUUID();
    setToasts((t) => [...t, { id, type, message, timeout: timeoutMs }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), timeoutMs);
  }, []);

  const ctx = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={ctx}>
      {children}
      <Toaster toasts={toasts} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx.toast;
}

export function Toaster({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="pointer-events-none fixed inset-0 z-50 flex items-start justify-end p-4 sm:p-6">
      <div className="flex w-full max-w-sm flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={
              'pointer-events-auto rounded-md border px-4 py-3 shadow-md text-sm animate-in fade-in slide-in-from-top-2 ' +
              (t.type === 'success'
                ? 'bg-green-50 text-green-900 border-green-200'
                : t.type === 'error'
                ? 'bg-red-50 text-red-900 border-red-200'
                : 'bg-popover text-popover-foreground border-border')
            }
          >
            {t.message}
          </div>
        ))}
      </div>
    </div>
  );
}

