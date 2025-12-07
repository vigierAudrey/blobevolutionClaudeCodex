import { cacheService } from './cache.service';
import { send2FACode } from '../lib/mailer';
import { secureLogger } from '../utils/secure-logger';

// Memory fallback is allowed outside production (dev + tests) to keep UX smooth; prod must rely on Redis
const allowMemoryFallback = process.env.NODE_ENV !== 'production';
export const memoryStore = allowMemoryFallback ? new Map<string, { code: string; expiresAt: number }>() : null;

if (memoryStore && process.env.NODE_ENV !== 'test') {
  setInterval(() => {
    const now = Date.now();
    for (const [key, value] of memoryStore.entries()) {
      if (value.expiresAt < now) {
        memoryStore.delete(key);
      }
    }
  }, 60000);
}

export class TwoFactorService {
  /**
   * Génère un code 2FA à 6 chiffres
   */
  private generateCode(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  /**
   * Génère une clé Redis pour stocker le code 2FA
   */
  private getCacheKey(userId: string): string {
    return `2fa:${userId}`;
  }

  /**
   * Envoie un code 2FA par email et le stocke en cache
   */
  async sendCode(userId: string, email: string): Promise<{ success: boolean; message: string }> {
    try {
      const code = this.generateCode();
      const cacheKey = this.getCacheKey(userId);

      const redisSuccess = await cacheService.set(cacheKey, code, 300);
      if (!redisSuccess) {
        if (!memoryStore) {
          secureLogger.error('TWO_FACTOR_CACHE_UNAVAILABLE', { userId, cacheKey });
          return {
            success: false,
            message: 'Service 2FA indisponible (cache)'
          };
        }
        memoryStore.set(cacheKey, { code, expiresAt: Date.now() + 300000 });
        secureLogger.warn('TWO_FACTOR_MEMORY_FALLBACK_USED', { userId, cacheKey });
      }

      // Envoyer l'email
      const emailResult = await send2FACode(email, code);

      if (emailResult.sent === false) {
        secureLogger.warn('TWO_FACTOR_EMAIL_FAILED', { userId, cacheKey });
        return {
          success: false,
          message: 'Erreur lors de l\'envoi de l\'email'
        };
      }

      if (emailResult.skipped) {
        secureLogger.info('TWO_FACTOR_EMAIL_SKIPPED', { userId, cacheKey });
      }

      return {
        success: true,
        message: 'Code envoyé par email'
      };
    } catch (error) {
      secureLogger.error('TWO_FACTOR_SEND_ERROR', {
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        success: false,
        message: 'Erreur interne'
      };
    }
  }

  /**
   * Vérifie un code 2FA
   */
  async verifyCode(userId: string, providedCode: string): Promise<{ valid: boolean; message: string }> {
    try {
      const cacheKey = this.getCacheKey(userId);

      let storedCode = await cacheService.get<string>(cacheKey);
      let usingMemoryStore = false;

      if (!storedCode && memoryStore) {
        const memoryEntry = memoryStore.get(cacheKey);
        if (memoryEntry && memoryEntry.expiresAt > Date.now()) {
          storedCode = memoryEntry.code;
          usingMemoryStore = true;
        }
      }

      if (!storedCode) {
        return {
          valid: false,
          message: 'Code expiré ou inexistant'
        };
      }

      if (storedCode !== providedCode.trim()) {
        return {
          valid: false,
          message: 'Code incorrect'
        };
      }

      // Code valide - le supprimer du cache pour éviter la réutilisation
      if (usingMemoryStore && memoryStore) {
        memoryStore.delete(cacheKey);
      } else {
        await cacheService.del(cacheKey);
      }

      return {
        valid: true,
        message: 'Code valide'
      };
    } catch (error) {
      secureLogger.error('TWO_FACTOR_VERIFY_ERROR', {
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        valid: false,
        message: 'Erreur interne'
      };
    }
  }

  /**
   * Vérifie si un code 2FA est en attente pour un utilisateur
   */
  async hasPendingCode(userId: string): Promise<boolean> {
    try {
      const cacheKey = this.getCacheKey(userId);
      const storedCode = await cacheService.get(cacheKey);
      if (storedCode) return true;
      if (memoryStore?.has(cacheKey)) {
        const entry = memoryStore.get(cacheKey)!;
        return entry.expiresAt > Date.now();
      }
      return false;
    } catch (error) {
      secureLogger.error('TWO_FACTOR_PENDING_CHECK_ERROR', {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Supprime un code 2FA en attente (annulation)
   */
  async cancelPendingCode(userId: string): Promise<void> {
    try {
      const cacheKey = this.getCacheKey(userId);
      await cacheService.del(cacheKey);
      if (memoryStore) {
        memoryStore.delete(cacheKey);
      }
    } catch (error) {
      secureLogger.error('TWO_FACTOR_CANCEL_ERROR', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export const twoFactorService = new TwoFactorService();
