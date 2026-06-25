/**
 * Tests for the per-browser push subscription wiring.
 *
 * Invariants asserted:
 *  - subscribe hits /push/subscribe, unsubscribe hits /push/unregister.
 *  - the front never sends a userId (identity is server-side, anti-IDOR).
 *  - no token / userId is ever written to localStorage.
 *  - no permission prompt is triggered on module load.
 *  - neutral logging: the FCM token never reaches the console.
 */

const mockGetToken = jest.fn();
const mockOnMessage = jest.fn(() => () => {});
const mockApiRequest = jest.fn();

jest.mock('firebase/app', () => ({
  initializeApp: jest.fn(() => ({ name: '[DEFAULT]' })),
}));

jest.mock('firebase/messaging', () => ({
  getMessaging: jest.fn(() => ({})),
  getToken: (...args: unknown[]) => mockGetToken(...args),
  onMessage: (...args: unknown[]) => mockOnMessage(...args),
}));

jest.mock('../csrf', () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
}));

const FCM_TOKEN = 'fcm-secret-token-abcdef0123456789';

const mockRequestPermission = jest.fn().mockResolvedValue('granted');

// Non-demo public Firebase config so the fail-closed guard lets the FCM path run.
const FIREBASE_ENV_KEYS = [
  'NEXT_PUBLIC_FIREBASE_API_KEY',
  'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN',
  'NEXT_PUBLIC_FIREBASE_PROJECT_ID',
  'NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET',
  'NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
  'NEXT_PUBLIC_FIREBASE_APP_ID',
  'NEXT_PUBLIC_FIREBASE_VAPID_KEY',
] as const;

function setRealFirebaseEnv() {
  process.env.NEXT_PUBLIC_FIREBASE_API_KEY = 'test-api-key';
  process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN = 'test-project.firebaseapp.com';
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = 'test-project';
  process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET = 'test-project.appspot.com';
  process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID = '999000111';
  process.env.NEXT_PUBLIC_FIREBASE_APP_ID = '1:999000111:web:testapp';
  process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY = 'test-vapid-public-key';
}

function clearFirebaseEnv() {
  for (const key of FIREBASE_ENV_KEYS) delete process.env[key];
}

function setupBrowserEnv(permission: NotificationPermission = 'granted') {
  Object.defineProperty(global, 'Notification', {
    configurable: true,
    writable: true,
    value: { permission, requestPermission: mockRequestPermission },
  });
  (global as unknown as { PushManager: unknown }).PushManager = function PushManager() {};
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      register: jest.fn().mockResolvedValue({}),
      ready: Promise.resolve({}),
      getRegistration: jest.fn().mockResolvedValue(undefined),
    },
  });
}

describe('push subscription wiring (firebase.ts)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    mockRequestPermission.mockResolvedValue('granted');
    setupBrowserEnv('granted');
    setRealFirebaseEnv();
  });

  afterEach(() => {
    clearFirebaseEnv();
  });

  it('saveFCMToken POSTs to /push/subscribe with the token but no userId', async () => {
    mockApiRequest.mockResolvedValue({ ok: true });
    const { saveFCMToken } = require('../firebase');

    const ok = await saveFCMToken(FCM_TOKEN);

    expect(ok).toBe(true);
    expect(mockApiRequest).toHaveBeenCalledTimes(1);
    const [url, opts] = mockApiRequest.mock.calls[0];
    expect(url).toBe('/push/subscribe');
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body);
    expect(body.token).toBe(FCM_TOKEN);
    expect(body).not.toHaveProperty('userId');
  });

  it('unregisterFCMToken POSTs to /push/unregister scoped to the given token, no userId', async () => {
    mockApiRequest.mockResolvedValue({ ok: true });
    const { unregisterFCMToken } = require('../firebase');

    const ok = await unregisterFCMToken(FCM_TOKEN);

    expect(ok).toBe(true);
    const [url, opts] = mockApiRequest.mock.calls[0];
    expect(url).toBe('/push/unregister');
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body);
    // Scoped to THIS device's token so the backend does not wipe every device.
    expect(body.token).toBe(FCM_TOKEN);
    expect(body).not.toHaveProperty('userId');
  });

  it('fetchPushStatus reads /push/status and returns the server flag', async () => {
    mockApiRequest.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ hasActiveTokens: true }),
    });
    const { fetchPushStatus } = require('../firebase');

    const status = await fetchPushStatus();

    expect(mockApiRequest).toHaveBeenCalledWith('/push/status', { method: 'GET' });
    expect(status).toEqual({ hasActiveTokens: true });
  });

  it('saveFCMToken returns false neutrally on API error without throwing', async () => {
    mockApiRequest.mockRejectedValue(new Error('network down'));
    const { saveFCMToken } = require('../firebase');

    await expect(saveFCMToken(FCM_TOKEN)).resolves.toBe(false);
  });
});

describe('PushNotificationManager / pushManager', () => {
  let logSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    mockRequestPermission.mockResolvedValue('granted');
    setupBrowserEnv('granted');
    setRealFirebaseEnv();
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    clearFirebaseEnv();
    logSpy.mockRestore();
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('is fail-closed with demo/placeholder config: no getToken, no subscribe call', async () => {
    // Drop the VAPID key so it falls back to the demo sentinel — config is unusable.
    delete process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY;
    mockGetToken.mockResolvedValue(FCM_TOKEN);
    mockApiRequest.mockResolvedValue({ ok: true });

    const { pushManager } = require('../pushNotifications');
    const ok = await pushManager.subscribe();

    expect(ok).toBe(false);
    expect(mockGetToken).not.toHaveBeenCalled();
    expect(mockApiRequest).not.toHaveBeenCalledWith('/push/subscribe', expect.anything());
  });

  it('does not prompt for permission on module load', () => {
    require('../pushNotifications');
    expect(mockRequestPermission).not.toHaveBeenCalled();
  });

  it('subscribe registers the token and writes nothing to localStorage', async () => {
    mockGetToken.mockResolvedValue(FCM_TOKEN);
    mockApiRequest.mockResolvedValue({ ok: true });
    const setItem = jest.spyOn(Storage.prototype, 'setItem');

    const { pushManager } = require('../pushNotifications');
    const ok = await pushManager.subscribe();

    expect(ok).toBe(true);
    // API hit with subscribe endpoint and no userId.
    const subscribeCall = mockApiRequest.mock.calls.find(([u]: [string]) => u === '/push/subscribe');
    expect(subscribeCall).toBeDefined();
    expect(JSON.parse(subscribeCall![1].body)).not.toHaveProperty('userId');

    // No token / userId persisted client-side.
    const persistedToken = setItem.mock.calls.some(([, v]) => String(v).includes(FCM_TOKEN));
    expect(persistedToken).toBe(false);
    const persistedKeys = setItem.mock.calls.map(([k]) => k);
    expect(persistedKeys).not.toContain('fcmToken');
    expect(persistedKeys).not.toContain('pushUserId');
    expect(persistedKeys).not.toContain('pushSubscribed');

    setItem.mockRestore();
  });

  it('never logs the FCM token through the subscribe path', async () => {
    mockGetToken.mockResolvedValue(FCM_TOKEN);
    mockApiRequest.mockResolvedValue({ ok: true });

    const { pushManager } = require('../pushNotifications');
    await pushManager.subscribe();

    const allLogs = [...logSpy.mock.calls, ...errorSpy.mock.calls, ...warnSpy.mock.calls]
      .flat()
      .map((a) => (typeof a === 'string' ? a : JSON.stringify(a ?? '')))
      .join(' ');
    expect(allLogs).not.toContain(FCM_TOKEN);
    // not even a prefix of the token
    expect(allLogs).not.toContain(FCM_TOKEN.slice(0, 10));
  });

  it('subscribe returns false when permission is denied', async () => {
    setupBrowserEnv('default');
    mockRequestPermission.mockResolvedValue('denied');

    const { pushManager } = require('../pushNotifications');
    const ok = await pushManager.subscribe();

    expect(ok).toBe(false);
    expect(mockApiRequest).not.toHaveBeenCalledWith('/push/subscribe', expect.anything());
  });

  it('unsubscribe removes only this browser token (scoped to the session token)', async () => {
    mockGetToken.mockResolvedValue(FCM_TOKEN);
    mockApiRequest.mockResolvedValue({ ok: true });
    const { pushManager } = require('../pushNotifications');

    // Must have subscribed in this session to hold the device token.
    await pushManager.subscribe();
    mockApiRequest.mockClear();

    const ok = await pushManager.unsubscribe();

    expect(ok).toBe(true);
    const unregisterCall = mockApiRequest.mock.calls.find(([u]: [string]) => u === '/push/unregister');
    expect(unregisterCall).toBeDefined();
    const body = JSON.parse(unregisterCall![1].body);
    expect(body.token).toBe(FCM_TOKEN);
    expect(body).not.toHaveProperty('userId');
  });

  it('unsubscribe without a session token does NOT wipe the account (no API call)', async () => {
    mockApiRequest.mockResolvedValue({ ok: true });
    const { pushManager } = require('../pushNotifications');

    // No prior subscribe → no device token held.
    const ok = await pushManager.unsubscribe();

    expect(ok).toBe(false);
    expect(mockApiRequest).not.toHaveBeenCalledWith('/push/unregister', expect.anything());
  });
});
