'use client';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

class CSRFManager {
  private token: string | null = null;
  private expires: Date | null = null;

  async getToken(): Promise<string> {
    // Return cached token if still valid
    if (this.token && this.expires && new Date() < this.expires) {
      return this.token;
    }

    // Fetch new token from API
    try {
      const response = await fetch(`${API_BASE_URL}/csrf-token`, {
        method: 'GET',
        credentials: 'include', // Include cookies for session
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch CSRF token: ${response.status}`);
      }

      const data = await response.json();
      if (!data.csrfToken) {
        throw new Error('CSRF token not provided in response');
      }
      this.token = data.csrfToken;
      this.expires = new Date(data.expires);

      return this.token!;
    } catch (error) {
      console.error('Error fetching CSRF token:', error);
      throw error;
    }
  }

  // Clear cached token (useful on logout or error)
  clearToken(): void {
    this.token = null;
    this.expires = null;
  }

  // Get headers object with CSRF token
  async getHeaders(additionalHeaders: Record<string, string> = {}): Promise<Record<string, string>> {
    const token = await this.getToken();

    return {
      'Content-Type': 'application/json',
      'X-CSRF-Token': token,
      ...additionalHeaders,
    };
  }
}

// Singleton instance
export const csrfManager = new CSRFManager();

// Enhanced fetch function that automatically includes CSRF token
export async function apiRequest(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const fullUrl = url.startsWith('http') ? url : `${API_BASE_URL}${url}`;

  // Skip CSRF for safe methods
  const method = options.method?.toUpperCase() || 'GET';
  const isSafeMethod = ['GET', 'HEAD', 'OPTIONS'].includes(method);

  let headers = options.headers as Record<string, string> || {};

  if (!isSafeMethod) {
    // Add CSRF token for unsafe methods
    headers = await csrfManager.getHeaders(headers);
  }

  const requestOptions: RequestInit = {
    ...options,
    credentials: 'include', // Always include cookies
    headers,
  };

  try {
    const response = await fetch(fullUrl, requestOptions);

    // Handle CSRF errors
    if (response.status === 403) {
      const errorData = await response.json().catch(() => ({}));

      if (errorData.error?.startsWith('CSRF_')) {
        console.warn('CSRF error detected, clearing token and retrying...');
        csrfManager.clearToken();

        // Retry once with fresh token
        if (!isSafeMethod) {
          const freshHeaders = await csrfManager.getHeaders(
            options.headers as Record<string, string> || {}
          );

          return fetch(fullUrl, {
            ...requestOptions,
            headers: freshHeaders,
          });
        }
      }
    }

    return response;
  } catch (error) {
    console.error('API request failed:', error);
    throw error;
  }
}

// Preload CSRF token (call this on app startup)
export async function preloadCSRFToken(): Promise<void> {
  try {
    await csrfManager.getToken();
    console.log('CSRF token preloaded successfully');
  } catch (error) {
    console.warn('Failed to preload CSRF token:', error);
  }
}