"use client";

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';

function formatPathname(pathname: string | null) {
  if (!pathname || pathname === '/') {
    return 'Accueil';
  }

  return pathname
    .split('/')
    .filter(Boolean)
    .map((segment) => {
      try {
        return decodeURIComponent(segment).replace(/[-_]+/g, ' ');
      } catch {
        return segment.replace(/[-_]+/g, ' ');
      }
    })
    .join(' / ');
}

export function RouteAnnouncer() {
  const pathname = usePathname();
  const previousPathname = useRef<string | null>(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (previousPathname.current === null) {
      previousPathname.current = pathname;
      return;
    }

    if (previousPathname.current === pathname) {
      return;
    }

    previousPathname.current = pathname;
    setMessage(`Page chargée : ${formatPathname(pathname)}`);
  }, [pathname]);

  return (
    <p
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="sr-only"
      data-testid="route-announcer"
    >
      {message}
    </p>
  );
}
