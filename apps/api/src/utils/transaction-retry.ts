/**
 * Utility function to retry database transactions on serialization failures
 * PostgreSQL error codes reference: https://www.postgresql.org/docs/current/errcodes-appendix.html
 */

export async function withTransactionRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 5,
  baseDelay: number = 120
): Promise<T> {
  let lastError: Error;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;

      // Check if this is a PostgreSQL serialization failure
      const isSerializationError =
        error.code === '40001' ||  // serialization_failure
        error.code === '40P01' ||  // deadlock_detected
        error.message?.includes('could not serialize access') ||
        error.message?.includes('deadlock detected');

      if (!isSerializationError || attempt === maxRetries) {
        throw error;
      }

      // Exponential backoff with jitter
      const delay = baseDelay * Math.pow(2, attempt - 1) + Math.random() * 100;
      await new Promise(resolve => setTimeout(resolve, delay));

      console.warn(`Transaction retry ${attempt}/${maxRetries} due to serialization error:`, error.message);
    }
  }

  throw lastError!;
}
