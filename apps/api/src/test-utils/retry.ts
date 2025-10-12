/**
 * Réexécute une opération Prisma en cas d'erreurs de concurrence Postgres.
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
      const isSerializationError =
        error?.code === '40001' ||
        error?.code === '40P01' ||
        error?.message?.includes('could not serialize access');

      if (!isSerializationError || attempt === maxRetries - 1) {
        throw error;
      }

      const backoff = delayMs * Math.pow(2, attempt);
      await new Promise((resolve) => setTimeout(resolve, backoff));
      console.warn(
        `⚠️  Serialization error detected (attempt ${attempt + 1}/${maxRetries}), retrying in ${backoff}ms...`
      );
    }
  }

  throw lastError || new Error('Max retries exceeded');
}
