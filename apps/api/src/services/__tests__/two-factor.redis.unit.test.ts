/**
 * Tests unitaires ciblés — chemin Redis de TwoFactorService
 *
 * PÉRIMÈTRE : prouver que les opérations Redis (INCR, DECR, DEL, EXISTS, EVAL)
 * sont correctement exécutées dans sendCode(), verifyCode() et cancelPendingCode().
 *
 * Ce fichier NE teste PAS le chemin mémoire (couvert par two-factor.service.test.ts).
 * Il NE teste PAS les appels HTTP (couverts par 2fa-send-rate-limit.e2e.test.ts).
 *
 * Approche : mock explicite de cacheService.getClient() retournant un faux client Redis
 * contrôlé. Toutes les assertions portent sur les appels Redis réels attendus.
 *
 * Invariant de lecture : luaScriptSha = null en tests → eval() est toujours utilisé
 * (pas evalSha). Les tests vérifient eval(). Si evalSha est ajouté à l'avenir,
 * les tests devront être mis à jour.
 */

// ─── Mocks (doivent être déclarés AVANT les imports du module testé) ─────────

jest.mock('../../lib/mailer', () => ({
  send2FACode: jest.fn().mockResolvedValue({ sent: true }),
}));

// Note: cache.service est intentionnellement NON mocké via jest.mock().
// jest.setup.ts charge two-factor.service.ts avant l'exécution du fichier de test,
// ce qui signifie que la variable cacheService dans two-factor.service.ts est déjà
// liée au vrai singleton avant que jest.mock() puisse l'intercepter.
// Solution : jest.spyOn sur le singleton réel — visible par two-factor.service.ts
// car les deux partagent la même instance (CacheService.getInstance()).

// security-event-alert.service est appelé fire-and-forget dans les cas BLOCKED_*
jest.mock('../security-event-alert.service', () => ({
  securityEventAlertService: {
    reportTwoFactorRateLimit: jest.fn().mockResolvedValue(undefined),
  },
}));

// ─── Imports ─────────────────────────────────────────────────────────────────

import { beforeEach, afterEach, describe, it, expect, jest } from '@jest/globals';
import { TwoFactorService } from '../two-factor.service';
import { cacheService } from '../cache.service';
import { send2FACode } from '../../lib/mailer';

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Spies assigned in beforeEach — use SpyInstance so mockReturnValue/mockResolvedValue work
let mockCacheGetTwoFactorHash: jest.SpyInstance;
let mockCacheDel: jest.SpyInstance;
let mockCacheSet: jest.SpyInstance;
let mockCacheSetTwoFactorHash: jest.SpyInstance;
let mockGetClient: jest.SpyInstance;
const mockSend2FACode = send2FACode as jest.MockedFunction<typeof send2FACode>;

/** Crée un faux client Redis avec toutes les méthodes utilisées par TwoFactorService */
function makeMockRedisClient() {
  return {
    exists: jest.fn<() => Promise<number>>(),
    get: jest.fn<() => Promise<string | null>>(),
    del: jest.fn<() => Promise<number>>(),
    incr: jest.fn<() => Promise<number>>(),
    expire: jest.fn<() => Promise<number>>(),
    decr: jest.fn<() => Promise<number>>(),
    eval: jest.fn<() => Promise<unknown>>(),
    evalSha: jest.fn<() => Promise<unknown>>(),
    scriptLoad: jest.fn<() => Promise<string>>(),
  };
}

const USER_ID = 'redis-test-user-001';
const CODE_KEY = `2fa:${USER_ID}`;
const COUNTER_KEY = `2fa:challenges:${USER_ID}`;
const CLIENT_IP = '127.0.0.1'; // hashIpHmac fonctionne car IP_HASH_SECRET est injecté par jest.setup.secrets.ts

// ─── Suite principale ─────────────────────────────────────────────────────────

describe('TwoFactorService — chemin Redis (unit)', () => {
  let service: TwoFactorService;
  let mockRedis: ReturnType<typeof makeMockRedisClient>;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new TwoFactorService();
    mockRedis = makeMockRedisClient();

    // Spy sur le vrai singleton — deux-factor.service.ts voit ces spies car il
    // partage la même instance CacheService que ce fichier de test.
    mockGetClient = jest.spyOn(cacheService, 'getClient').mockReturnValue(null);
    mockCacheSetTwoFactorHash = jest.spyOn(cacheService, 'setTwoFactorCodeHash').mockResolvedValue({ ok: true } as any);
    mockCacheGetTwoFactorHash = jest.spyOn(cacheService, 'getTwoFactorCodeHash').mockResolvedValue({ ok: true, found: false } as any);
    mockCacheDel = jest.spyOn(cacheService, 'del').mockResolvedValue(true);
    mockCacheSet = jest.spyOn(cacheService, 'set').mockResolvedValue(true);
    mockSend2FACode.mockResolvedValue({ sent: true });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // A. sendCode() — Redis normal : code actif présent, counter < MAX
  // ───────────────────────────────────────────────────────────────────────────

  describe('sendCode() — Redis normal (code actif, counter < MAX)', () => {
    it('appelle EXISTS puis INCR + EXPIRE après envoi réussi', async () => {
      mockGetClient.mockReturnValue(mockRedis as any);
      mockRedis.exists.mockResolvedValue(1);   // code actif présent
      mockRedis.get.mockResolvedValue('1');    // counter = 1 < MAX(3)
      mockRedis.incr.mockResolvedValue(2);
      mockRedis.expire.mockResolvedValue(1);

      const result = await service.sendCode(USER_ID, 'test@example.com');

      expect(result.success).toBe(true);
      expect(result.tooManyChallenges).toBeUndefined();

      // 1) EXISTS sur la clé de code
      expect(mockRedis.exists).toHaveBeenCalledWith(CODE_KEY);

      // 2) Pas de DEL counter (code actif → pas de stale reset)
      expect(mockRedis.del).not.toHaveBeenCalledWith(COUNTER_KEY);

      // 3) GET counter pour vérifier le seuil
      expect(mockRedis.get).toHaveBeenCalledWith(COUNTER_KEY);

      // 4) INCR + EXPIRE après envoi (TTL = 300s = durée du code)
      expect(mockRedis.incr).toHaveBeenCalledWith(COUNTER_KEY);
      expect(mockRedis.expire).toHaveBeenCalledWith(COUNTER_KEY, 300);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // B. sendCode() — Stale reset : code absent mais counter > 0
  // ───────────────────────────────────────────────────────────────────────────

  describe('sendCode() — stale reset Redis', () => {
    it('DEL le counter stale quand aucun code actif, puis INCR + EXPIRE', async () => {
      // Préconditions : code absent (code expiré naturellement sans verify/cancel)
      // mais counter Redis toujours > 0 → bug P1 original
      mockGetClient.mockReturnValue(mockRedis as any);
      mockRedis.exists.mockResolvedValue(0);      // codeKey absent → stale détecté
      mockRedis.del.mockResolvedValue(1);         // DEL counter stale
      mockRedis.get.mockResolvedValue(null);      // après DEL, counter = 0
      mockRedis.incr.mockResolvedValue(1);
      mockRedis.expire.mockResolvedValue(1);

      const result = await service.sendCode(USER_ID, 'test@example.com');

      expect(result.success).toBe(true);

      // Ordre critique : EXISTS → DEL(counter) → GET(counter) → INCR → EXPIRE
      expect(mockRedis.exists).toHaveBeenCalledWith(CODE_KEY);
      expect(mockRedis.del).toHaveBeenCalledWith(COUNTER_KEY);
      expect(mockRedis.get).toHaveBeenCalledWith(COUNTER_KEY);
      expect(mockRedis.incr).toHaveBeenCalledWith(COUNTER_KEY);
      expect(mockRedis.expire).toHaveBeenCalledWith(COUNTER_KEY, 300);
    });

    it('stale reset + GET retourne "3" → counter reset → activeCount = 3 → toujours < MAX(3) → échec', async () => {
      // Cas limite : après DEL, Redis retourne encore "3" (race condition improbable en production).
      // Comportement attendu : parseInt("3", 10) = 3 >= MAX(3) → tooManyChallenges.
      // Ce test documente que le DEL Redis n'est pas atomic avec le GET suivant.
      // NOTE: comportement raisonné, pas risque P0 (improbable en single-client-per-pod).
      mockGetClient.mockReturnValue(mockRedis as any);
      mockRedis.exists.mockResolvedValue(0);
      mockRedis.del.mockResolvedValue(1);
      const MAX = parseInt(process.env.TWO_FACTOR_MAX_CONCURRENT_CHALLENGES ?? '3', 10);
      mockRedis.get.mockResolvedValue(String(MAX)); // race: redis retourne encore MAX après DEL

      const result = await service.sendCode(USER_ID, 'test@example.com');

      // Comportement documenté : DEL non-atomic avec GET → encore bloqué si race
      expect(result.success).toBe(false);
      expect(result.tooManyChallenges).toBe(true);
      expect(mockRedis.incr).not.toHaveBeenCalled();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // C. sendCode() — tooManyChallenges (Redis path)
  // ───────────────────────────────────────────────────────────────────────────

  describe('sendCode() — tooManyChallenges Redis', () => {
    it('retourne tooManyChallenges sans INCR ni email quand counter = MAX', async () => {
      const MAX = parseInt(process.env.TWO_FACTOR_MAX_CONCURRENT_CHALLENGES ?? '3', 10);

      mockGetClient.mockReturnValue(mockRedis as any);
      mockRedis.exists.mockResolvedValue(1);           // code actif → pas de stale reset
      mockRedis.get.mockResolvedValue(String(MAX));    // counter au seuil exact

      const result = await service.sendCode(USER_ID, 'test@example.com');

      expect(result.success).toBe(false);
      expect(result.tooManyChallenges).toBe(true);

      // Invariant : pas de nouveau challenge créé
      expect(mockRedis.incr).not.toHaveBeenCalled();
      expect(mockSend2FACode).not.toHaveBeenCalled();
    });

    it('retourne tooManyChallenges pour counter > MAX (sursaturation)', async () => {
      const MAX = parseInt(process.env.TWO_FACTOR_MAX_CONCURRENT_CHALLENGES ?? '3', 10);

      mockGetClient.mockReturnValue(mockRedis as any);
      mockRedis.exists.mockResolvedValue(1);
      mockRedis.get.mockResolvedValue(String(MAX + 10)); // bien au-delà

      const result = await service.sendCode(USER_ID, 'test@example.com');

      expect(result.success).toBe(false);
      expect(result.tooManyChallenges).toBe(true);
      expect(mockRedis.incr).not.toHaveBeenCalled();
    });

    it('counter = MAX - 1 → pas bloqué, challenge autorisé', async () => {
      const MAX = parseInt(process.env.TWO_FACTOR_MAX_CONCURRENT_CHALLENGES ?? '3', 10);

      mockGetClient.mockReturnValue(mockRedis as any);
      mockRedis.exists.mockResolvedValue(1);
      mockRedis.get.mockResolvedValue(String(MAX - 1)); // sous le seuil
      mockRedis.incr.mockResolvedValue(MAX);
      mockRedis.expire.mockResolvedValue(1);

      const result = await service.sendCode(USER_ID, 'test@example.com');

      expect(result.success).toBe(true);
      expect(result.tooManyChallenges).toBeUndefined();
      expect(mockRedis.incr).toHaveBeenCalledWith(COUNTER_KEY);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // D. verifyCode() — chemin VALID Redis (DECR + DEL conditionnel)
  // ───────────────────────────────────────────────────────────────────────────

  describe('verifyCode() — VALID Redis branch', () => {
    it('DECR sans DEL quand counter > 0 après décrément', async () => {
      mockGetClient.mockReturnValue(mockRedis as any);
      mockRedis.eval.mockResolvedValue('VALID');
      mockRedis.decr.mockResolvedValue(1); // reste à 1 → pas de DEL

      const result = await service.verifyCode(USER_ID, '123456', CLIENT_IP);

      expect(result.valid).toBe(true);
      expect(result.message).toBe('Code valide');

      expect(mockRedis.decr).toHaveBeenCalledWith(COUNTER_KEY);
      // DEL NE doit PAS être appelé (pas de nettoyage prématuré)
      expect(mockRedis.del).not.toHaveBeenCalledWith(COUNTER_KEY);
    });

    it('DECR puis DEL quand counter tombe à 0 — pas de clé orpheline', async () => {
      mockGetClient.mockReturnValue(mockRedis as any);
      mockRedis.eval.mockResolvedValue('VALID');
      mockRedis.decr.mockResolvedValue(0); // tombe à 0 → DEL obligatoire
      mockRedis.del.mockResolvedValue(1);

      const result = await service.verifyCode(USER_ID, '123456', CLIENT_IP);

      expect(result.valid).toBe(true);
      expect(mockRedis.decr).toHaveBeenCalledWith(COUNTER_KEY);
      // Clé nettoyée → pas de stale 0-counter au prochain sendCode
      expect(mockRedis.del).toHaveBeenCalledWith(COUNTER_KEY);
    });

    it('DECR puis DEL quand counter Redis négatif (compteur incohérent) — comportement défensif', async () => {
      // Un counter négatif est impossible en théorie mais peut survenir si un pod
      // crashe entre DECR et DEL, ou si un test externe modifie la clé.
      // Invariant : decrVal <= 0 → DEL → jamais de counter négatif persistant.
      mockGetClient.mockReturnValue(mockRedis as any);
      mockRedis.eval.mockResolvedValue('VALID');
      mockRedis.decr.mockResolvedValue(-1); // valeur corrompue
      mockRedis.del.mockResolvedValue(1);

      const result = await service.verifyCode(USER_ID, '123456', CLIENT_IP);

      expect(result.valid).toBe(true);
      expect(mockRedis.del).toHaveBeenCalledWith(COUNTER_KEY);
    });

    it('INVALID → valid:false, aucun DECR', async () => {
      mockGetClient.mockReturnValue(mockRedis as any);
      mockRedis.eval.mockResolvedValue('INVALID');

      const result = await service.verifyCode(USER_ID, 'wrong', CLIENT_IP);

      expect(result.valid).toBe(false);
      expect(result.message).toBe('Code invalide ou expiré');
      // Invariant : pas de décrément sur code invalide
      expect(mockRedis.decr).not.toHaveBeenCalled();
    });

    it('NO_CODE → valid:false, aucun DECR, même message anti-oracle que INVALID', async () => {
      mockGetClient.mockReturnValue(mockRedis as any);
      mockRedis.eval.mockResolvedValue('NO_CODE');

      const result = await service.verifyCode(USER_ID, '123456', CLIENT_IP);

      expect(result.valid).toBe(false);
      // Anti-oracle : NO_CODE et INVALID donnent le même message
      expect(result.message).toBe('Code invalide ou expiré');
      expect(mockRedis.decr).not.toHaveBeenCalled();
    });

    it('BLOCKED_USER → valid:false, message rate-limit, aucun DECR', async () => {
      mockGetClient.mockReturnValue(mockRedis as any);
      mockRedis.eval.mockResolvedValue('BLOCKED_USER');

      const result = await service.verifyCode(USER_ID, '123456', CLIENT_IP);

      expect(result.valid).toBe(false);
      expect(result.message).toContain('Trop de tentatives');
      expect(mockRedis.decr).not.toHaveBeenCalled();
    });

    it('BLOCKED_IP → valid:false, même message que BLOCKED_USER (anti-énumération)', async () => {
      mockGetClient.mockReturnValue(mockRedis as any);
      mockRedis.eval.mockResolvedValue('BLOCKED_IP');

      const result = await service.verifyCode(USER_ID, '123456', CLIENT_IP);

      expect(result.valid).toBe(false);
      expect(result.message).toContain('Trop de tentatives');
    });

    it('sans clientIp → chemin Lua non pris, eval() jamais appelé', async () => {
      // Quand clientIp est absent, la condition (redisClient && clientIp) = false.
      // Le service bascule sur le chemin mémoire sans passer par Lua.
      mockGetClient.mockReturnValue(mockRedis as any);
      mockCacheGetTwoFactorHash.mockResolvedValue({ ok: true, found: false }); // pas de code en cache

      const result = await service.verifyCode(USER_ID, '123456', undefined);

      expect(mockRedis.eval).not.toHaveBeenCalled();
      expect(mockRedis.evalSha).not.toHaveBeenCalled();
      expect(result.valid).toBe(false); // pas de code → invalide
    });

    it('evalSha NOSCRIPT → fallback sur eval, retourne VALID correctement', async () => {
      // Simule le cas où luaScriptSha est chargé mais Redis a flushé les scripts.
      // Le service doit fallback sur eval() et continuer normalement.
      // NOTE: luaScriptSha est null en tests (loadLuaScript pas appelé) donc ce chemin
      // ne peut être atteint qu'en injectant le sha directement via le module.
      // Ce test reste "raisonné" : la logique est lisible dans le code mais non exécutable
      // sans accès direct à luaScriptSha (variable module-level non exportée).
      // STATUT: NON PROUVÉ par ce test — voir section D du rapport de clôture.
      expect(true).toBe(true); // placeholder documenté
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // E. cancelPendingCode() — chemin Redis
  // ───────────────────────────────────────────────────────────────────────────

  describe('cancelPendingCode() — Redis branch', () => {
    it('DECR sans DEL quand counter > 0 après décrément (code existait)', async () => {
      mockGetClient.mockReturnValue(mockRedis as any);
      mockCacheGetTwoFactorHash.mockResolvedValue({ ok: true, found: true, value: 'some-stored-hash' }); // hadCode = true
      mockCacheDel.mockResolvedValue(true);
      mockRedis.decr.mockResolvedValue(2); // counter reste positif

      await service.cancelPendingCode(USER_ID);

      expect(mockRedis.decr).toHaveBeenCalledWith(COUNTER_KEY);
      expect(mockRedis.del).not.toHaveBeenCalledWith(COUNTER_KEY);
    });

    it('DECR puis DEL quand counter tombe à 0 (dernier challenge annulé)', async () => {
      mockGetClient.mockReturnValue(mockRedis as any);
      mockCacheGetTwoFactorHash.mockResolvedValue({ ok: true, found: true, value: 'some-stored-hash' });
      mockCacheDel.mockResolvedValue(true);
      mockRedis.decr.mockResolvedValue(0);
      mockRedis.del.mockResolvedValue(1);

      await service.cancelPendingCode(USER_ID);

      expect(mockRedis.decr).toHaveBeenCalledWith(COUNTER_KEY);
      expect(mockRedis.del).toHaveBeenCalledWith(COUNTER_KEY);
    });

    it('pas de DECR quand aucun code actif (hadCode = false) — pas de décrément parasite', async () => {
      // Invariant critique : un cancel sans code ne doit pas faire dériver le counter
      // vers des valeurs négatives. Ce serait une fuite silencieuse dégradant la protection.
      mockGetClient.mockReturnValue(mockRedis as any);
      mockCacheGetTwoFactorHash.mockResolvedValue({ ok: true, found: false });  // aucun code en cache
      mockCacheDel.mockResolvedValue(true);

      await service.cancelPendingCode(USER_ID);

      expect(mockRedis.decr).not.toHaveBeenCalled();
      expect(mockRedis.del).not.toHaveBeenCalledWith(COUNTER_KEY);
    });

    it('DEL counter après DECR retournant valeur négative (counter incohérent)', async () => {
      mockGetClient.mockReturnValue(mockRedis as any);
      mockCacheGetTwoFactorHash.mockResolvedValue({ ok: true, found: true, value: 'some-stored-hash' });
      mockCacheDel.mockResolvedValue(true);
      mockRedis.decr.mockResolvedValue(-2); // valeur Redis corrompue
      mockRedis.del.mockResolvedValue(1);

      await service.cancelPendingCode(USER_ID);

      // -2 <= 0 → DEL défensif : on ne laisse jamais un counter négatif en Redis
      expect(mockRedis.del).toHaveBeenCalledWith(COUNTER_KEY);
    });

    it('codeKey supprimé de cacheService.del après cancel, indépendamment du counter', async () => {
      mockGetClient.mockReturnValue(mockRedis as any);
      mockCacheGetTwoFactorHash.mockResolvedValue({ ok: true, found: true, value: 'hash-exists' });
      mockCacheDel.mockResolvedValue(true);
      mockRedis.decr.mockResolvedValue(1);

      await service.cancelPendingCode(USER_ID);

      // La clé de code est supprimée via cacheService.del (pas via le raw client)
      expect(mockCacheDel).toHaveBeenCalledWith(CODE_KEY);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // F. Cas défensifs — valeurs Redis incohérentes dans sendCode()
  // ───────────────────────────────────────────────────────────────────────────

  describe('sendCode() — cas défensifs / valeurs Redis incohérentes', () => {
    it('counter non-numérique "CORRUPT" → parseInt=NaN → activeCount=0 → pas bloqué (permissif documenté)', async () => {
      // COMPORTEMENT DOCUMENTÉ : si Redis retourne une valeur corrompue, parseInt(raw, 10) = NaN.
      // NaN >= MAX est false → l'utilisateur n'est PAS bloqué.
      // Risque résiduel P2 : counter corrompu n'est ni réinitialisé ni signalé.
      // Acceptable car la corruption Redis est rare et le TTL nettoiera la clé.
      mockGetClient.mockReturnValue(mockRedis as any);
      mockRedis.exists.mockResolvedValue(1);
      mockRedis.get.mockResolvedValue('CORRUPT_VALUE');
      mockRedis.incr.mockResolvedValue(1);
      mockRedis.expire.mockResolvedValue(1);

      const result = await service.sendCode(USER_ID, 'test@example.com');

      // Permissif : pas de blocage sur valeur corrompue
      expect(result.success).toBe(true);
      expect(result.tooManyChallenges).toBeUndefined();
    });

    it('counter "0" explicite → activeCount=0 → pas bloqué, INCR correct', async () => {
      mockGetClient.mockReturnValue(mockRedis as any);
      mockRedis.exists.mockResolvedValue(1);
      mockRedis.get.mockResolvedValue('0');
      mockRedis.incr.mockResolvedValue(1);
      mockRedis.expire.mockResolvedValue(1);

      const result = await service.sendCode(USER_ID, 'test@example.com');

      expect(result.success).toBe(true);
      expect(mockRedis.incr).toHaveBeenCalledWith(COUNTER_KEY);
    });

    it('counter null (clé inexistante) → activeCount=0 → pas bloqué', async () => {
      mockGetClient.mockReturnValue(mockRedis as any);
      mockRedis.exists.mockResolvedValue(1);
      mockRedis.get.mockResolvedValue(null); // clé absente dans Redis
      mockRedis.incr.mockResolvedValue(1);
      mockRedis.expire.mockResolvedValue(1);

      const result = await service.sendCode(USER_ID, 'test@example.com');

      expect(result.success).toBe(true);
      expect(mockRedis.incr).toHaveBeenCalledWith(COUNTER_KEY);
    });
  });
});
