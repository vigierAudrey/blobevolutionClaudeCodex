import { cacheService } from './cache.service';
import { send2FACode } from '../lib/mailer';

// TODO: Remove this fallback when migrating to Redis in production
// Fallback in-memory store for development when Redis is not available
const memoryStore = new Map<string, { code: string; expiresAt: number }>();

// TODO: Add cleanup interval for memory store to prevent memory leaks
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of memoryStore.entries()) {
    if (value.expiresAt < now) {
      memoryStore.delete(key);
    }
  }
}, 60000); // Clean expired entries every minute

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

      // TODO: When Redis is fully deployed, remove fallback and use only cacheService
      // Try Redis first, fallback to memory store
      const redisSuccess = await cacheService.set(cacheKey, code, 300);
      if (!redisSuccess) {
        // Fallback to memory store for development
        memoryStore.set(cacheKey, { code, expiresAt: Date.now() + 300000 });
      }

      // Envoyer l'email
      const emailResult = await send2FACode(email, code);

      if (emailResult.sent === false) {
        return {
          success: false,
          message: 'Erreur lors de l\'envoi de l\'email'
        };
      }

      if (emailResult.skipped) {
        console.warn(`2FA code for user ${userId}: ${code} (email skipped - dev mode)`);
      }

      return {
        success: true,
        message: 'Code envoyé par email'
      };
    } catch (error) {
      console.error('Erreur envoi code 2FA:', error);
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

      // TODO: When Redis is fully deployed, remove fallback and use only cacheService
      // Try Redis first, fallback to memory store
      let storedCode = await cacheService.get<string>(cacheKey);
      let usingMemoryStore = false;

      if (!storedCode) {
        // Check memory store fallback
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
      if (usingMemoryStore) {
        memoryStore.delete(cacheKey);
      } else {
        await cacheService.del(cacheKey);
      }

      return {
        valid: true,
        message: 'Code valide'
      };
    } catch (error) {
      console.error('Erreur vérification code 2FA:', error);
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
      return !!storedCode;
    } catch (error) {
      console.error('Erreur vérification code en attente:', error);
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
    } catch (error) {
      console.error('Erreur suppression code 2FA:', error);
    }
  }
}

export const twoFactorService = new TwoFactorService();