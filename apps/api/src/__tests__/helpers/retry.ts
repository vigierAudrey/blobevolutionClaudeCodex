/**
 * Réessaye une opération en cas d'erreur de concurrence Postgres
 * @param fn - Fonction à exécuter
 * @param maxRetries - Nombre maximum de tentatives (défaut: 3)
 * @param delayMs - Délai initial en ms (défaut: 100ms)
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  delayMs = 100
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;

      // Codes d'erreur Postgres pour les conflits de sérialisation
      const isSerializationError =
        error?.code === '40001' || // serialization_failure
        error?.code === '40P01' || // deadlock_detected
        error?.message?.includes('could not serialize access');

      if (!isSerializationError || attempt === maxRetries - 1) {
        throw error;
      }

      // Backoff exponentiel : 100ms, 200ms, 400ms...
      const backoff = delayMs * Math.pow(2, attempt);
      await new Promise((resolve) => setTimeout(resolve, backoff));

      console.warn(
        `⚠️  Serialization error detected (attempt ${attempt + 1}/${maxRetries}), retrying in ${backoff}ms...`
      );
    }
  }

  throw lastError || new Error('Max retries exceeded');
}
