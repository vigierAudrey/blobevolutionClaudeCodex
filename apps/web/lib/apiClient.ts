export type LoginResponse = { accessToken: string; refreshToken: string };

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

function getTokens() {
  if (typeof window === 'undefined') return null;
  const accessToken = localStorage.getItem('accessToken') || '';
  const refreshToken = localStorage.getItem('refreshToken') || '';
  return { accessToken, refreshToken };
}

function setTokens(access: string, refresh: string) {
  if (typeof window === 'undefined') return;
  localStorage.setItem('accessToken', access);
  localStorage.setItem('refreshToken', refresh);
}

function clearTokens() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem('accessToken');
  localStorage.removeItem('refreshToken');
}

async function request(path: string, opts: RequestInit = {}, withAuth = false) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(opts.headers as any),
  };
  if (withAuth) {
    const t = getTokens();
    if (t?.accessToken) headers['Authorization'] = `Bearer ${t.accessToken}`;
  }
  const res = await fetch(`${API_URL}${path}`, {
    ...opts,
    headers,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const message = data?.error || `HTTP ${res.status}`;
    throw new Error(message);
  }
  return data;
}

export const apiClient = {
  login: (body: { email: string; password: string }) =>
    request('/auth/login', { method: 'POST', body: JSON.stringify(body) }) as Promise<LoginResponse>,

  register: (body: { email: string; password: string; role: 'RIDER' | 'PRO' }) =>
    request('/auth/register', { method: 'POST', body: JSON.stringify(body) }) as Promise<any>,

  me: () => request('/auth/me', { method: 'GET' }, true),

  logoutAll: () => request('/auth/logout', { method: 'POST', body: JSON.stringify({}) }, true),

  resendVerification: (email: string) =>
    request('/auth/resend-verification', { method: 'POST', body: JSON.stringify({ email }) }),

  getProfile: () => request('/profile/me', { method: 'GET' }, true),
  updateProfile: (body: any) => request('/profile/me', { method: 'PUT', body: JSON.stringify(body) }, true),

  searchMatching: (body: { sport: 'surf' | 'kitesurf'; level: 'beginner' | 'intermediate' | 'advanced'; date: string; partner?: 'ALL' | 'WOMEN' | 'MEN'; distanceKm?: number; location?: { lat: number; lng: number }; page?: number; pageSize?: number; sortBy?: 'distance' | 'name' }) =>
    request('/matching/search', { method: 'POST', body: JSON.stringify(body) }, true),

  saveTokens: setTokens,
  clearTokens: clearTokens,
  getTokens,
};
