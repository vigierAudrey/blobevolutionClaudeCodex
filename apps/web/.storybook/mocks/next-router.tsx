/**
 * Mock de next/router pour Storybook
 * Fournit des implémentations par défaut des hooks et objets du routeur Next.js
 */

interface Router {
  route: string;
  pathname: string;
  query: Record<string, string | string[]>;
  asPath: string;
  basePath: string;
  locale?: string;
  locales?: string[];
  defaultLocale?: string;
  isReady: boolean;
  isPreview: boolean;
  isFallback: boolean;
  isLocaleDomain: boolean;
  push: (url: string, as?: string, options?: { shallow?: boolean }) => Promise<boolean>;
  replace: (url: string, as?: string, options?: { shallow?: boolean }) => Promise<boolean>;
  reload: () => void;
  back: () => void;
  prefetch: (url: string, asPath?: string, options?: { locale?: string }) => Promise<void>;
  beforePopState: (cb: (state: any) => boolean) => void;
  events: {
    on: (event: string, handler: (...args: any[]) => void) => void;
    off: (event: string, handler: (...args: any[]) => void) => void;
    emit: (event: string, ...args: any[]) => void;
  };
}

const mockRouter: Router = {
  route: '/',
  pathname: '/',
  query: {},
  asPath: '/',
  basePath: '',
  locale: undefined,
  locales: undefined,
  defaultLocale: undefined,
  isReady: true,
  isPreview: false,
  isFallback: false,
  isLocaleDomain: false,
  push: async () => true,
  replace: async () => true,
  reload: () => {},
  back: () => {},
  prefetch: async () => {},
  beforePopState: () => {},
  events: {
    on: () => {},
    off: () => {},
    emit: () => {},
  },
};

export function useRouter(): Router {
  return mockRouter;
}

export default mockRouter;
