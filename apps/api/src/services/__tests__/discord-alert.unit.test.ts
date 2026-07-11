/**
 * Tests unitaires — discord-alert.service.ts
 *
 * Stratégie : mock de global.fetch — aucun réseau.
 * On valide :
 *   - no-op sans DISCORD_WEBHOOK_URL (et sur URL invalide / non-https)
 *   - envoi avec embed conforme (titre niveau, couleur, description, footer contexte)
 *   - filtre ALERT_MIN_LEVEL (partagé avec scripts/alert.sh)
 *   - fail-silent : réseau down / réponse non-2xx → false, jamais de throw
 *   - l'URL du webhook n'apparaît jamais dans les logs
 */

import { describe, it, expect, jest, beforeEach, afterAll } from '@jest/globals';
import {
  sendDiscordAlert,
  sendDiscordAlertSilent,
  isDiscordAlertEnabled,
} from '../discord-alert.service';

const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};

jest.mock('../../utils/secure-logger', () => ({
  secureLogger: {
    info: (...args: unknown[]) => mockLogger.info(...args),
    warn: (...args: unknown[]) => mockLogger.warn(...args),
    error: (...args: unknown[]) => mockLogger.error(...args),
    debug: (...args: unknown[]) => mockLogger.debug(...args),
  },
}));

const WEBHOOK = 'https://discord.com/api/webhooks/123/secret-token';

const mockFetch = jest.fn<typeof fetch>();
const originalFetch = global.fetch;

const ENV_KEYS = ['DISCORD_WEBHOOK_URL', 'ALERT_MIN_LEVEL', 'ALERT_HOSTNAME'] as const;
const originalEnv: Record<string, string | undefined> = {};
for (const key of ENV_KEYS) originalEnv[key] = process.env[key];

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = mockFetch as unknown as typeof fetch;
  mockFetch.mockResolvedValue({ ok: true, status: 204 } as Response);
  for (const key of ENV_KEYS) delete process.env[key];
});

afterAll(() => {
  global.fetch = originalFetch;
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

describe('isDiscordAlertEnabled', () => {
  it('false sans webhook', () => {
    expect(isDiscordAlertEnabled()).toBe(false);
  });

  it('true avec un webhook https valide', () => {
    process.env.DISCORD_WEBHOOK_URL = WEBHOOK;
    expect(isDiscordAlertEnabled()).toBe(true);
  });

  it('false sur URL non-https ou invalide', () => {
    process.env.DISCORD_WEBHOOK_URL = 'http://discord.com/api/webhooks/1/x';
    expect(isDiscordAlertEnabled()).toBe(false);
    process.env.DISCORD_WEBHOOK_URL = 'pas-une-url';
    expect(isDiscordAlertEnabled()).toBe(false);
  });
});

describe('sendDiscordAlert', () => {
  it('no-op (false, zéro fetch) sans webhook', async () => {
    const result = await sendDiscordAlert('critical', 'Backup échoué', 'test');

    expect(result).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('envoie un embed conforme et retourne true sur 2xx', async () => {
    process.env.DISCORD_WEBHOOK_URL = WEBHOOK;
    process.env.ALERT_HOSTNAME = 'blob-test';

    const result = await sendDiscordAlert('critical', 'Backup échoué', 'backup-freshness');

    expect(result).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(WEBHOOK);
    const payload = JSON.parse(String(init.body)) as {
      embeds: Array<{ title: string; description: string; color: number; footer: { text: string } }>;
    };
    expect(payload.embeds).toHaveLength(1);
    expect(payload.embeds[0].title).toBe('🔴 CRITICAL — blob-test');
    expect(payload.embeds[0].description).toBe('Backup échoué');
    expect(payload.embeds[0].color).toBe(15158332);
    expect(payload.embeds[0].footer.text).toContain('backup-freshness');
  });

  it('respecte ALERT_MIN_LEVEL (ok filtré si min=warning)', async () => {
    process.env.DISCORD_WEBHOOK_URL = WEBHOOK;
    process.env.ALERT_MIN_LEVEL = 'warning';

    expect(await sendDiscordAlert('ok', 'heartbeat')).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();

    expect(await sendDiscordAlert('warning', 'attention')).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('réponse non-2xx → false, log du statut seul (jamais l’URL)', async () => {
    process.env.DISCORD_WEBHOOK_URL = WEBHOOK;
    mockFetch.mockResolvedValue({ ok: false, status: 429 } as Response);

    const result = await sendDiscordAlert('warning', 'test');

    expect(result).toBe(false);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'DISCORD_ALERT_REJECTED',
      expect.objectContaining({ status: 429 }),
    );
  });

  it('échec réseau → false, jamais de throw', async () => {
    process.env.DISCORD_WEBHOOK_URL = WEBHOOK;
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(sendDiscordAlert('emergency', 'test')).resolves.toBe(false);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'DISCORD_ALERT_SEND_FAILED',
      expect.objectContaining({ level: 'emergency' }),
    );
  });

  it('l’URL du webhook (et son token) n’apparaît dans aucun log', async () => {
    process.env.DISCORD_WEBHOOK_URL = WEBHOOK;
    mockFetch.mockRejectedValue(new Error('boom'));
    await sendDiscordAlert('critical', 'test');
    mockFetch.mockResolvedValue({ ok: false, status: 500 } as Response);
    await sendDiscordAlert('critical', 'test');

    const allLogs = JSON.stringify([
      mockLogger.info.mock.calls,
      mockLogger.warn.mock.calls,
      mockLogger.error.mock.calls,
      mockLogger.debug.mock.calls,
    ]);
    expect(allLogs).not.toContain('secret-token');
    expect(allLogs).not.toContain('discord.com/api/webhooks');
  });
});

describe('sendDiscordAlertSilent', () => {
  it('ne throw jamais, même sur échec réseau', async () => {
    process.env.DISCORD_WEBHOOK_URL = WEBHOOK;
    mockFetch.mockRejectedValue(new Error('down'));

    expect(() => sendDiscordAlertSilent('critical', 'test')).not.toThrow();
    await new Promise((r) => setTimeout(r, 10));
  });
});
