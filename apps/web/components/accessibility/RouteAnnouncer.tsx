"use client";

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

export function RouteAnnouncer() {
  const pathname = usePathname();
  const [message, setMessage] = useState('Navigation en cours');

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const readablePath = pathname === '/' ? 'Accueil' : pathname?.replace(/-/g, ' ').replace(/\//g, ' / ');
    const pageTitle = document.title || readablePath || 'Nouvelle page';
    setMessage(`Navigation vers ${pageTitle}`);
  }, [pathname]);

  return (
    <p
      role="status"
      aria-live="assertive"
      aria-atomic="true"
      className="sr-only"
      data-testid="route-announcer"
    >
      {message}
    </p>
  );
}
