import '@testing-library/jest-dom';
import { TextEncoder, TextDecoder } from 'util';
import { webcrypto } from 'crypto';

if (!global.TextEncoder) {
  global.TextEncoder = TextEncoder;
}
if (!global.TextDecoder) {
  global.TextDecoder = TextDecoder;
}
const cryptoImpl = webcrypto;
Object.defineProperty(global, 'crypto', {
  value: cryptoImpl,
  configurable: true,
});
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'crypto', {
    value: cryptoImpl,
    configurable: true,
  });
}

// next-intl : fallback français quand un composant traduit est rendu sans
// NextIntlClientProvider. Les tests qui montent un provider explicite
// (ex. rendu de la home en anglais) gardent le comportement réel.
jest.mock('next-intl', () => {
  const actual = jest.requireActual('next-intl');
  const frMessages = jest.requireActual('./messages/fr.json');

  return {
    ...actual,
    useTranslations: (namespace) => {
      try {
        return actual.useTranslations(namespace);
      } catch {
        return actual.createTranslator({ locale: 'fr', messages: frMessages, namespace });
      }
    },
    useLocale: () => {
      try {
        return actual.useLocale();
      } catch {
        return 'fr';
      }
    },
  };
});

// Mock Next.js router
const createRouter = () => ({
  push: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
  forward: jest.fn(),
  refresh: jest.fn(),
  prefetch: jest.fn(),
});

const createSearchParams = () => ({
  get: jest.fn(),
  getAll: jest.fn(),
  has: jest.fn(),
  keys: jest.fn(),
  values: jest.fn(),
  entries: jest.fn(),
  forEach: jest.fn(),
  toString: jest.fn(),
  append: jest.fn(),
  delete: jest.fn(),
  set: jest.fn(),
  sort: jest.fn(),
  size: 0,
  [Symbol.iterator]: jest.fn(),
});

const mockUseRouter = jest.fn().mockImplementation(createRouter);
const mockUseSearchParams = jest.fn().mockImplementation(createSearchParams);

jest.mock('next/navigation', () => ({
  useRouter: mockUseRouter,
  useSearchParams: mockUseSearchParams,
  usePathname: jest.fn(() => '/'),
}));

beforeEach(() => {
  mockUseRouter.mockImplementation(createRouter);
  mockUseSearchParams.mockImplementation(createSearchParams);
});

// Mock API client
jest.mock('./lib/apiClient', () => ({
  apiClient: {
    getTokens: jest.fn(),
    me: jest.fn(),
    getProfile: jest.fn(),
    getDisciplines: jest.fn(),
    searchMatching: jest.fn(),
    listConversations: jest.fn(),
    matchDecisions: jest.fn(),
    reportProfile: jest.fn(),
    getProProfile: jest.fn(),
  },
}));

// Mock window.prompt
Object.defineProperty(window, 'prompt', {
  writable: true,
  value: jest.fn(),
});

// Mock document.visibilityState
Object.defineProperty(document, 'visibilityState', {
  writable: true,
  value: 'visible',
});

// Mock IntersectionObserver
global.IntersectionObserver = class IntersectionObserver {
  constructor() {}
  disconnect() {}
  observe() {}
  unobserve() {}
};

// Mock ResizeObserver
global.ResizeObserver = class ResizeObserver {
  constructor() {}
  disconnect() {}
  observe() {}
  unobserve() {}
};

// Mock PerformanceObserver
global.PerformanceObserver = class PerformanceObserver {
  constructor(callback) {
    this.callback = callback;
  }

  disconnect() {}
  observe() {}
  takeRecords() {
    return [];
  }
};

// Suppress act() warnings for async state updates in setTimeout/promises
// These are expected in our toast/dialog components
const originalError = console.error;
const suppressedDomProps = new Set([
  'maxZoom',
  'tileSize',
  'pathOptions',
  'detectRetina',
  'updateWhenIdle',
  'maxBounds',
  'keepBuffer',
  'scrollWheelZoom',
  'wheelPxPerZoomLevel',
]);

beforeAll(() => {
  console.error = (...args) => {
    const [message] = args;
    if (typeof message === 'string') {
      const isActWarning =
        message.includes('An update to') && message.includes('was not wrapped in act');
      const isLeafletDomWarning =
        message.startsWith('Warning: React does not recognize the `%s` prop on a DOM element.') &&
        args.length > 1 &&
        typeof args[1] === 'string' &&
        suppressedDomProps.has(args[1]);

      if (isActWarning || isLeafletDomWarning) {
        return;
      }
    }
    originalError.call(console, ...args);
  };
});

afterAll(() => {
  console.error = originalError;
});
