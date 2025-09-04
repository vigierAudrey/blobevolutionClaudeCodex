const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
function getTokens() {
    if (typeof window === 'undefined')
        return null;
    const accessToken = localStorage.getItem('accessToken') || '';
    const refreshToken = localStorage.getItem('refreshToken') || '';
    return { accessToken, refreshToken };
}
function setTokens(access, refresh) {
    if (typeof window === 'undefined')
        return;
    localStorage.setItem('accessToken', access);
    localStorage.setItem('refreshToken', refresh);
}
function clearTokens() {
    if (typeof window === 'undefined')
        return;
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
}
async function request(path, opts = {}, withAuth = false) {
    const headers = {
        'Content-Type': 'application/json',
        ...opts.headers,
    };
    if (withAuth) {
        const t = getTokens();
        if (t?.accessToken)
            headers['Authorization'] = `Bearer ${t.accessToken}`;
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
    login: (body) => request('/auth/login', { method: 'POST', body: JSON.stringify(body) }),
    register: (body) => request('/auth/register', { method: 'POST', body: JSON.stringify(body) }),
    me: () => request('/auth/me', { method: 'GET' }, true),
    logoutAll: () => request('/auth/logout', { method: 'POST', body: JSON.stringify({}) }, true),
    resendVerification: (email) => request('/auth/resend-verification', { method: 'POST', body: JSON.stringify({ email }) }),
    saveTokens: setTokens,
    clearTokens: clearTokens,
    getTokens,
};
