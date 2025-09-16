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
    const error = new Error(message) as any;
    // Passer les détails de validation s'ils existent
    if (data?.details) {
      error.details = data.details;
    }
    throw error;
  }
  return data;
}

export const apiClient = {
  login: (body: { email: string; password: string; consentAccepted?: boolean }) =>
    request('/auth/login', { method: 'POST', body: JSON.stringify(body) }) as Promise<LoginResponse>,

  register: (body: { email: string; password: string; role: 'RIDER' | 'PRO' | 'ADMIN'; consentAccepted: true }) =>
    request('/auth/register', { method: 'POST', body: JSON.stringify(body) }) as Promise<any>,

  me: () => request('/auth/me', { method: 'GET' }, true),

  logoutAll: () => request('/auth/logout', { method: 'POST', body: JSON.stringify({}) }, true),

  resendVerification: (email: string) =>
    request('/auth/resend-verification', { method: 'POST', body: JSON.stringify({ email }) }),

  getProfile: () => request('/profile/me', { method: 'GET' }, true),
  updateProfile: (body: any) => request('/profile/me', { method: 'PUT', body: JSON.stringify(body) }, true),

  getDisciplines: () => request('/profile/disciplines', { method: 'GET' }, true) as Promise<Array<{ sport: 'surf'|'kitesurf'; level: 'beginner'|'intermediate'|'advanced' }>>,
  setDisciplines: (items: Array<{ sport: 'surf'|'kitesurf'; level: 'beginner'|'intermediate'|'advanced' }>) =>
    request('/profile/disciplines', { method: 'PUT', body: JSON.stringify(items) }, true),

  searchMatching: (body: { sport: 'surf' | 'kitesurf'; level: 'beginner' | 'intermediate' | 'advanced'; date: string; partner?: 'ALL' | 'WOMEN' | 'MEN'; distanceKm?: number; location?: { lat: number; lng: number }; page?: number; pageSize?: number; sortBy?: 'distance' | 'name'; excludeIds?: string[] }) =>
    request('/matching/search', { method: 'POST', body: JSON.stringify(body) }, true),

  matchDecision: (body: { targetProfileId: string; decision: 'ACCEPT' | 'REFUSE' }) =>
    request('/matching/decision', { method: 'POST', body: JSON.stringify(body) }, true),

  matchDecisions: (list: Array<{ targetProfileId: string; decision: 'ACCEPT' | 'REFUSE' }>) =>
    request('/matching/decisions', { method: 'POST', body: JSON.stringify({ items: list }) }, true),

  openConversation: (targetUserId: string) =>
    request('/conversations/open', { method: 'POST', body: JSON.stringify({ targetUserId }) }, true) as Promise<{ id: string }>,

  reportProfile: (body: { targetProfileId: string; reason?: string }) =>
    request('/reports/profile', { method: 'POST', body: JSON.stringify(body) }, true),

  listConversations: (opts?: { includeTrashed?: boolean; type?: 'RIDER_TO_RIDER' | 'RIDER_TO_PRO' | 'PRO_TO_PRO' }) => {
    const params = new URLSearchParams();
    if (opts?.includeTrashed) params.append('includeTrashed', 'true');
    if (opts?.type) params.append('type', opts.type);
    const query = params.toString();
    return request(`/conversations${query ? `?${query}` : ''}`, { method: 'GET' }, true);
  },
  getMessages: (id: string, cursor?: string, limit: number = 50) =>
    request(`/conversations/${id}/messages${cursor ? `?cursor=${encodeURIComponent(cursor)}&limit=${limit}` : `?limit=${limit}`}`, { method: 'GET' }, true),
  sendMessage: (id: string, body: { type?: 'TEXT'|'PROPOSAL'; content: string; meta?: any }) =>
    request(`/conversations/${id}/messages`, { method: 'POST', body: JSON.stringify(body) }, true),
  blockConversation: (id: string) => request(`/conversations/${id}/block`, { method: 'POST', body: JSON.stringify({ action: 'block' }) }, true),
  unblockConversation: (id: string) => request(`/conversations/${id}/block`, { method: 'POST', body: JSON.stringify({ action: 'unblock' }) }, true),
  unmatchConversation: (id: string) => request(`/conversations/${id}/unmatch`, { method: 'POST', body: JSON.stringify({}) }, true),
  trashConversation: (id: string) => request(`/conversations/${id}/trash`, { method: 'POST', body: JSON.stringify({ action: 'trash' }) }, true),
  untrashConversation: (id: string) => request(`/conversations/${id}/trash`, { method: 'POST', body: JSON.stringify({ action: 'untrash' }) }, true),
  favoriteConversation: (id: string, value: boolean) => request(`/conversations/${id}/favorite`, { method: 'POST', body: JSON.stringify({ value }) }, true),

  // Pro Offers
  getProOffer: () => request('/pro/offers/me', { method: 'GET' }, true),
  createOrUpdateProOffer: (body: { sport: 'surf' | 'kitesurf'; level: 'beginner' | 'intermediate' | 'advanced'; title: string; description: string; hourlyRate: number; isActive?: boolean }) =>
    request('/pro/offers', { method: 'POST', body: JSON.stringify(body) }, true),
  deleteProOffer: () => request('/pro/offers/me', { method: 'DELETE' }, true),
  toggleProOffer: () => request('/pro/offers/me/toggle', { method: 'PATCH' }, true),

  searchOffers: (params: { lat?: number; lng?: number; radiusKm?: number; sport?: string; level?: string }) => {
    const query = new URLSearchParams();
    if (params.lat) query.append('lat', params.lat.toString());
    if (params.lng) query.append('lng', params.lng.toString());
    if (params.radiusKm) query.append('radiusKm', params.radiusKm.toString());
    if (params.sport) query.append('sport', params.sport);
    if (params.level) query.append('level', params.level);

    return request(`/pro/offers/search?${query.toString()}`, { method: 'GET' }, true);
  },

  // Credits
  getWallet: () => request('/credits/wallet', { method: 'GET' }, true),
  getTransactions: (params?: { page?: number; limit?: number }) => {
    const query = new URLSearchParams();
    if (params?.page) query.append('page', params.page.toString());
    if (params?.limit) query.append('limit', params.limit.toString());
    return request(`/credits/transactions?${query.toString()}`, { method: 'GET' }, true);
  },
  claimWelcomeBonus: () => request('/credits/welcome-bonus', { method: 'POST' }, true),
  canSpend: (amount: number) => request(`/credits/can-spend/${amount}`, { method: 'GET' }, true),

  // Admin
  getAdminStats: () => request('/admin/stats', { method: 'GET' }, true),
  getAdminUsers: (params?: { page?: number; limit?: number; role?: string }) => {
    const query = new URLSearchParams();
    if (params?.page) query.append('page', params.page.toString());
    if (params?.limit) query.append('limit', params.limit.toString());
    if (params?.role) query.append('role', params.role);
    return request(`/admin/users?${query.toString()}`, { method: 'GET' }, true);
  },
  suspendUser: (userId: string, suspended: boolean) =>
    request(`/admin/users/${userId}/suspend`, { method: 'PATCH', body: JSON.stringify({ suspended }) }, true),
  verifyPro: (userId: string, verified: boolean) =>
    request(`/admin/pros/${userId}/verify`, { method: 'PATCH', body: JSON.stringify({ verified }) }, true),
  getAdminReports: (params?: { page?: number; limit?: number }) => {
    const query = new URLSearchParams();
    if (params?.page) query.append('page', params.page.toString());
    if (params?.limit) query.append('limit', params.limit.toString());
    return request(`/admin/reports?${query.toString()}`, { method: 'GET' }, true);
  },

  saveTokens: setTokens,
  clearTokens: clearTokens,
  getTokens,
};
