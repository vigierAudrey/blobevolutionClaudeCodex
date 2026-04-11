/**
 * Tests unitaires — brute-force-detector.ts (LOT 4.1)
 *
 * Stratégie de mock :
 * - getRedisClient() : mocké pour retourner un faux client ou null
 * - hashEmailHmac()  : mocké pour contrôler le hash ou simuler un throw
 * - hashIpHmac()     : mocké pour contrôler le hash ou simuler un throw
 * - secureLogger     : mocké pour asserter les logs sans sortie console
 *
 * Note sur mock.calls :
 * sendCommand(args: string[]) prend UN argument (le tableau).
 * Donc mock.calls[n] = [string[]] — il faut unwrapper via mock.calls[n][0].
 * On utilise un helper getCallArgsList() pour normaliser cela proprement.
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';

// ─── Mocks déclarés AVANT import du module testé ──────────────────────────────
jest.mock('../redis-client', () => ({
  getRedisClient: jest.fn(),
}));

jest.mock('../hash-email', () => ({
  hashEmailHmac: jest.fn(),
}));

jest.mock('../hash-ip', () => ({
  hashIpHmac: jest.fn(),
}));

jest.mock('../../utils/secure-logger', () => ({
  secureLogger: {
    warn: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
  },
}));

// ─── Imports après mocks ──────────────────────────────────────────────────────
import { onLoginFailure, getIpCount, getEmailCount, isSuspect } from '../brute-force-detector';
import { getRedisClient } from '../redis-client';
import { hashEmailHmac } from '../hash-email';
import { hashIpHmac } from '../hash-ip';
import { secureLogger } from '../../utils/secure-logger';

const mockGetRedisClient = getRedisClient as jest.MockedFunction<typeof getRedisClient>;
const mockHashEmailHmac = hashEmailHmac as jest.MockedFunction<typeof hashEmailHmac>;
const mockHashIpHmac = hashIpHmac as jest.MockedFunction<typeof hashIpHmac>;
const mockSecureLogger = secureLogger as {
  warn: jest.MockedFunction<typeof secureLogger.warn>;
  info: jest.MockedFunction<typeof secureLogger.info>;
  error: jest.MockedFunction<typeof secureLogger.error>;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeMockClient() {
  return {
    sendCommand: jest.fn() as jest.MockedFunction<(args: string[]) => Promise<unknown>>,
  };
}

type MockClient = ReturnType<typeof makeMockClient>;

/**
 * sendCommand prend UN argument (string[]).
 * mock.calls[n] = [args: string[]] (le tuple des arguments de l'appel).
 * mock.calls[n][0] = le string[] passé à sendCommand.
 * Cette fonction unwrappe proprement la liste des appels.
 */
function getCallArgsList(client: MockClient): string[][] {
  return client.sendCommand.mock.calls.map((callArgs) => callArgs[0] as unknown as string[]);
}

// ─── Setup / teardown ─────────────────────────────────────────────────────────

let mockClient: MockClient;

beforeEach(() => {
  jest.clearAllMocks();

  mockClient = makeMockClient();
  mockGetRedisClient.mockReturnValue(mockClient as any);

  // Hashes par défaut : valeurs valides
  mockHashEmailHmac.mockReturnValue('abcdef1234567890abcdef1234567890'); // 32 hex
  mockHashIpHmac.mockReturnValue('abcdef1234567890abcdef12');           // 24 hex

  // Par défaut : INCR retourne 1 (première tentative), SET retourne OK
  mockClient.sendCommand.mockImplementation(async (args: string[]) => {
    if (args[0] === 'EVAL') return 1;   // INCR → count 1
    if (args[0] === 'SET') return 'OK';
    if (args[0] === 'GET') return null;  // clé absente par défaut
    if (args[0] === 'EXISTS') return 0;
    return null;
  });
});

afterEach(() => {
  delete process.env.BF_EMAIL_THRESHOLD;
  delete process.env.BF_IP_THRESHOLD;
  delete process.env.BF_EMAIL_TTL_SECONDS;
  delete process.env.BF_IP_TTL_SECONDS;
});

// ─────────────────────────────────────────────────────────────────────────────
// onLoginFailure — compteur email
// ─────────────────────────────────────────────────────────────────────────────

describe('onLoginFailure — compteur email', () => {
  it('incrémente le compteur email via EVAL Lua', async () => {
    await onLoginFailure({ email: 'victim@example.com' });

    const calls = getCallArgsList(mockClient);
    const evalCalls = calls.filter((args) => args[0] === 'EVAL');
    expect(evalCalls.length).toBeGreaterThanOrEqual(1);

    const emailEval = evalCalls.find((args) => args[3] === 'bf:em:abcdef1234567890abcdef1234567890');
    expect(emailEval).toBeDefined();
  });

  it('le script Lua contient le pattern TTL fixe NX (if count == 1)', async () => {
    await onLoginFailure({ email: 'victim@example.com' });

    const calls = getCallArgsList(mockClient);
    const evalCall = calls.find((args) => args[0] === 'EVAL');
    expect(evalCall).toBeDefined();

    const luaScript = evalCall![1];
    // Le TTL est posé uniquement si count == 1 (fenêtre fixe depuis la première tentative)
    expect(luaScript).toContain('if count == 1');
    expect(luaScript).toContain('EXPIRE');
    // Un seul EXPIRE dans le script — pas de TTL glissant
    const expireOccurrences = (luaScript.match(/EXPIRE/g) || []).length;
    expect(expireOccurrences).toBe(1);
  });

  it('le TTL passé à Lua correspond à BF_EMAIL_TTL_SECONDS (default 86400)', async () => {
    await onLoginFailure({ email: 'victim@example.com' });

    const calls = getCallArgsList(mockClient);
    // Structure EVAL: ['EVAL', script, '1', key, ttl]
    const emailEval = calls.find(
      (args) => args[0] === 'EVAL' && args[3]?.startsWith('bf:em:')
    );
    expect(emailEval).toBeDefined();
    expect(emailEval![4]).toBe('86400');
  });

  it('utilise BF_EMAIL_TTL_SECONDS si défini', async () => {
    process.env.BF_EMAIL_TTL_SECONDS = '3600';
    await onLoginFailure({ email: 'victim@example.com' });

    const calls = getCallArgsList(mockClient);
    const emailEval = calls.find(
      (args) => args[0] === 'EVAL' && args[3]?.startsWith('bf:em:')
    );
    expect(emailEval![4]).toBe('3600');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// onLoginFailure — compteur IP
// ─────────────────────────────────────────────────────────────────────────────

describe('onLoginFailure — compteur IP', () => {
  it('incrémente le compteur IP via EVAL Lua quand une IP est fournie', async () => {
    await onLoginFailure({ ip: '1.2.3.4', email: 'victim@example.com' });

    const calls = getCallArgsList(mockClient);
    const ipEval = calls.find(
      (args) => args[0] === 'EVAL' && args[3]?.startsWith('bf:ip:')
    );
    expect(ipEval).toBeDefined();
    expect(ipEval![3]).toBe('bf:ip:abcdef1234567890abcdef12');
  });

  it('ne crée pas de clé IP si ip est undefined', async () => {
    await onLoginFailure({ email: 'victim@example.com' }); // pas d'IP

    const calls = getCallArgsList(mockClient);
    const ipEval = calls.find(
      (args) => args[0] === 'EVAL' && args[3]?.startsWith('bf:ip:')
    );
    expect(ipEval).toBeUndefined();
  });

  it('skip silencieux si hashIpHmac retourne null (IP malformée)', async () => {
    mockHashIpHmac.mockReturnValue(null);
    await expect(onLoginFailure({ ip: 'invalid-ip', email: 'victim@example.com' })).resolves.toBeUndefined();

    const calls = getCallArgsList(mockClient);
    const ipEval = calls.find((args) => args[0] === 'EVAL' && args[3]?.startsWith('bf:ip:'));
    expect(ipEval).toBeUndefined();
    // Pas de log BF_HASH_FAILURE (hashIpHmac null = IP invalide, pas une erreur secrète)
    const hashFailureLogs = mockSecureLogger.warn.mock.calls.filter((c) => c[0] === 'BF_HASH_FAILURE');
    expect(hashFailureLogs.length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// onLoginFailure — détection suspect
// ─────────────────────────────────────────────────────────────────────────────

describe('onLoginFailure — détection suspect email', () => {
  it('émet BF_SUSPECT_DETECTED et pose le flag SET quand le seuil email est atteint', async () => {
    process.env.BF_EMAIL_THRESHOLD = '3';
    mockClient.sendCommand.mockImplementation(async (args: string[]) => {
      if (args[0] === 'EVAL') return 3; // count == threshold
      if (args[0] === 'SET') return 'OK';
      return null;
    });

    await onLoginFailure({ email: 'victim@example.com' });

    expect(mockSecureLogger.warn).toHaveBeenCalledWith(
      'BF_SUSPECT_DETECTED',
      expect.objectContaining({
        type: 'email',
        emailHash: 'abcdef1234567890abcdef1234567890',
        count: 3,
        threshold: 3,
      })
    );

    const calls = getCallArgsList(mockClient);
    const setCalls = calls.filter((args) => args[0] === 'SET');
    expect(setCalls.length).toBe(1);
    expect(setCalls[0][1]).toMatch(/^bf:sus:em:/);

    // Le payload JSON contient flaggedAt et reason
    const payload = JSON.parse(setCalls[0][2]);
    expect(payload).toMatchObject({
      reason: 'email_threshold_exceeded',
      count: 3,
    });
    expect(typeof payload.flaggedAt).toBe('string');
  });

  it('ne pose PAS de flag si le count est inférieur au seuil', async () => {
    process.env.BF_EMAIL_THRESHOLD = '5';
    mockClient.sendCommand.mockImplementation(async (args: string[]) => {
      if (args[0] === 'EVAL') return 2; // en-dessous du seuil
      return null;
    });

    await onLoginFailure({ email: 'victim@example.com' });

    expect(mockSecureLogger.warn).not.toHaveBeenCalledWith('BF_SUSPECT_DETECTED', expect.anything());

    const calls = getCallArgsList(mockClient);
    const setCalls = calls.filter((args) => args[0] === 'SET');
    expect(setCalls.length).toBe(0);
  });

  it('émet BF_SUSPECT_DETECTED pour IP quand le seuil IP est atteint', async () => {
    process.env.BF_IP_THRESHOLD = '5';
    mockClient.sendCommand.mockImplementation(async (args: string[]) => {
      if (args[0] === 'EVAL') return 5;
      if (args[0] === 'SET') return 'OK';
      return null;
    });

    await onLoginFailure({ ip: '1.2.3.4', email: 'victim@example.com' });

    const warnCalls = mockSecureLogger.warn.mock.calls;
    const ipSuspect = warnCalls.find(
      (args) => args[0] === 'BF_SUSPECT_DETECTED' && (args[1] as any).type === 'ip'
    );
    expect(ipSuspect).toBeDefined();
    expect((ipSuspect![1] as any).ipHash).toBe('abcdef1234567890abcdef12');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Fallback Redis down (null client)
// ─────────────────────────────────────────────────────────────────────────────

describe('Fallback Redis down (getRedisClient() = null)', () => {
  beforeEach(() => {
    mockGetRedisClient.mockReturnValue(null);
  });

  it('onLoginFailure ne throw pas quand Redis est null', async () => {
    await expect(
      onLoginFailure({ ip: '1.2.3.4', email: 'victim@example.com' })
    ).resolves.toBeUndefined();
  });

  it('getIpCount retourne null (état inconnu) quand Redis est null', async () => {
    const result = await getIpCount('1.2.3.4');
    expect(result).toBeNull();
  });

  it('getEmailCount retourne null (état inconnu) quand Redis est null', async () => {
    const result = await getEmailCount('victim@example.com');
    expect(result).toBeNull();
  });

  it('isSuspect retourne false (fail-open) quand Redis est null pour email', async () => {
    const result = await isSuspect('email', 'victim@example.com');
    expect(result).toBe(false);
  });

  it('isSuspect retourne false (fail-open) quand Redis est null pour IP', async () => {
    const result = await isSuspect('ip', '1.2.3.4');
    expect(result).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Hash failure (secret absent)
// ─────────────────────────────────────────────────────────────────────────────

describe('Hash failure — EMAIL_HASH_SECRET / IP_HASH_SECRET absents', () => {
  it('skip email counter et log BF_HASH_FAILURE si hashEmailHmac throw', async () => {
    mockHashEmailHmac.mockImplementation(() => {
      throw new Error('FATAL: EMAIL_HASH_SECRET is not configured');
    });

    await expect(
      onLoginFailure({ email: 'victim@example.com' })
    ).resolves.toBeUndefined();

    expect(mockSecureLogger.warn).toHaveBeenCalledWith(
      'BF_HASH_FAILURE',
      expect.objectContaining({ hashType: 'email' })
    );

    // Aucun EVAL ne doit avoir été appelé pour email
    const calls = getCallArgsList(mockClient);
    const emailEval = calls.find(
      (args) => args[0] === 'EVAL' && args[3]?.startsWith('bf:em:')
    );
    expect(emailEval).toBeUndefined();
  });

  it('skip IP counter et log BF_HASH_FAILURE si hashIpHmac throw', async () => {
    mockHashIpHmac.mockImplementation(() => {
      throw new Error('FATAL: IP_HASH_SECRET is not configured');
    });

    await expect(
      onLoginFailure({ ip: '1.2.3.4', email: 'victim@example.com' })
    ).resolves.toBeUndefined();

    expect(mockSecureLogger.warn).toHaveBeenCalledWith(
      'BF_HASH_FAILURE',
      expect.objectContaining({ hashType: 'ip' })
    );

    const calls = getCallArgsList(mockClient);
    const ipEval = calls.find(
      (args) => args[0] === 'EVAL' && args[3]?.startsWith('bf:ip:')
    );
    expect(ipEval).toBeUndefined();
  });

  it('getIpCount retourne null si hashIpHmac throw', async () => {
    mockHashIpHmac.mockImplementation(() => {
      throw new Error('FATAL: IP_HASH_SECRET is not configured');
    });

    const result = await getIpCount('1.2.3.4');
    expect(result).toBeNull();
  });

  it('getEmailCount retourne null si hashEmailHmac throw', async () => {
    mockHashEmailHmac.mockImplementation(() => {
      throw new Error('FATAL: EMAIL_HASH_SECRET is not configured');
    });

    const result = await getEmailCount('victim@example.com');
    expect(result).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getIpCount / getEmailCount — sémantique null vs 0
// ─────────────────────────────────────────────────────────────────────────────

describe('getIpCount / getEmailCount — sémantique null vs 0', () => {
  it('getIpCount retourne 0 si la clé est absente de Redis (état connu)', async () => {
    mockClient.sendCommand.mockResolvedValue(null); // GET → key not found
    const result = await getIpCount('1.2.3.4');
    expect(result).toBe(0);
  });

  it('getEmailCount retourne 0 si la clé est absente de Redis (état connu)', async () => {
    mockClient.sendCommand.mockResolvedValue(null);
    const result = await getEmailCount('victim@example.com');
    expect(result).toBe(0);
  });

  it('getIpCount retourne le count numérique si la clé existe', async () => {
    mockClient.sendCommand.mockResolvedValue('7');
    const result = await getIpCount('1.2.3.4');
    expect(result).toBe(7);
  });

  it('getEmailCount retourne le count numérique si la clé existe', async () => {
    mockClient.sendCommand.mockResolvedValue('12');
    const result = await getEmailCount('victim@example.com');
    expect(result).toBe(12);
  });

  it('getIpCount retourne null si Redis throw (état inconnu)', async () => {
    mockClient.sendCommand.mockRejectedValue(new Error('Connection reset'));
    const result = await getIpCount('1.2.3.4');
    expect(result).toBeNull();
  });

  it('getIpCount retourne null si hashIpHmac retourne null (IP malformée)', async () => {
    mockHashIpHmac.mockReturnValue(null);
    const result = await getIpCount('not-an-ip');
    expect(result).toBeNull();
    // Aucun sendCommand ne doit avoir été appelé (hash invalide = skip total)
    expect(mockClient.sendCommand).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// isSuspect
// ─────────────────────────────────────────────────────────────────────────────

describe('isSuspect', () => {
  it('retourne true si le flag suspect email existe (EXISTS → 1)', async () => {
    mockClient.sendCommand.mockResolvedValue(1);
    const result = await isSuspect('email', 'victim@example.com');
    expect(result).toBe(true);

    const calls = getCallArgsList(mockClient);
    const existsCall = calls.find((args) => args[0] === 'EXISTS');
    expect(existsCall).toBeDefined();
    expect(existsCall![1]).toMatch(/^bf:sus:em:/);
  });

  it('retourne false si le flag suspect email est absent (EXISTS → 0)', async () => {
    mockClient.sendCommand.mockResolvedValue(0);
    const result = await isSuspect('email', 'victim@example.com');
    expect(result).toBe(false);
  });

  it('retourne true si le flag suspect IP existe (EXISTS → 1)', async () => {
    mockClient.sendCommand.mockResolvedValue(1);
    const result = await isSuspect('ip', '1.2.3.4');
    expect(result).toBe(true);

    const calls = getCallArgsList(mockClient);
    const existsCall = calls.find((args) => args[0] === 'EXISTS');
    expect(existsCall).toBeDefined();
    expect(existsCall![1]).toMatch(/^bf:sus:ip:/);
  });

  it('retourne false (fail-open) si Redis throw', async () => {
    mockClient.sendCommand.mockRejectedValue(new Error('timeout'));
    const result = await isSuspect('email', 'victim@example.com');
    expect(result).toBe(false);
  });

  it('retourne false (fail-open) si hashEmailHmac throw dans isSuspect', async () => {
    mockHashEmailHmac.mockImplementation(() => {
      throw new Error('SECRET manquant');
    });
    const result = await isSuspect('email', 'victim@example.com');
    expect(result).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Isolation namespace Redis
// ─────────────────────────────────────────────────────────────────────────────

describe('Isolation namespace Redis', () => {
  it('les clés email EVAL commencent par bf:em:', async () => {
    await onLoginFailure({ email: 'victim@example.com' });

    const calls = getCallArgsList(mockClient);
    const emailEvalKeys = calls
      .filter((args) => args[0] === 'EVAL')
      .map((args) => args[3])
      .filter((key) => key?.startsWith('bf:em:'));

    expect(emailEvalKeys.length).toBeGreaterThanOrEqual(1);
    emailEvalKeys.forEach((k) => expect(k).not.toMatch(/^bf:ip:/));
  });

  it('les clés IP EVAL commencent par bf:ip:', async () => {
    await onLoginFailure({ ip: '1.2.3.4', email: 'victim@example.com' });

    const calls = getCallArgsList(mockClient);
    const ipEvalKeys = calls
      .filter((args) => args[0] === 'EVAL')
      .map((args) => args[3])
      .filter((key) => key?.startsWith('bf:ip:'));

    expect(ipEvalKeys.length).toBeGreaterThanOrEqual(1);
    ipEvalKeys.forEach((k) => expect(k).not.toMatch(/^bf:em:/));
  });

  it('les clés suspect SET commencent par bf:sus: (distinct des compteurs)', async () => {
    process.env.BF_EMAIL_THRESHOLD = '1';
    mockClient.sendCommand.mockImplementation(async (args: string[]) => {
      if (args[0] === 'EVAL') return 1;
      if (args[0] === 'SET') return 'OK';
      return null;
    });

    await onLoginFailure({ email: 'victim@example.com' });

    const calls = getCallArgsList(mockClient);
    const setKeys = calls.filter((args) => args[0] === 'SET').map((args) => args[1]);

    expect(setKeys.length).toBeGreaterThanOrEqual(1);
    setKeys.forEach((k) => {
      expect(k).toMatch(/^bf:sus:(ip|em):/);
      expect(k).not.toMatch(/^bf:em:/);
      expect(k).not.toMatch(/^bf:ip:/);
    });
  });
});
