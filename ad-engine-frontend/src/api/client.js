const BASE = process.env.REACT_APP_API_URL
  ? `${process.env.REACT_APP_API_URL}/api`
  : 'http://localhost:3001/api';

const getToken = () => localStorage.getItem('auth_token');

async function request(path, options = {}) {
  const token = getToken();
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    },
    ...options,
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

// Auth endpoint (not under /api)
const AUTH_BASE = process.env.REACT_APP_API_URL
  ? `${process.env.REACT_APP_API_URL}`
  : 'http://localhost:3001';

async function authRequest(path, options = {}) {
  const token = getToken();
  const res = await fetch(`${AUTH_BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    },
    ...options,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `API error: ${res.status}`);
  return data;
}

export const api = {
  resendVerification: () => authRequest('/auth/resend-verification', { method: 'POST' }),
  getStats: () => request('/stats'),
  getSellers: () => request('/sellers'),
  createSeller: (data) => request('/sellers', { method: 'POST', body: JSON.stringify(data) }),
  updateSeller: (id, d) => request(`/sellers/${id}`, { method: 'PUT', body: JSON.stringify(d) }),
  deleteSeller: (id) => request(`/sellers/${id}`, { method: 'DELETE' }),
  getProducts: () => request('/products'),
  createProduct: (data) => request('/products', { method: 'POST', body: JSON.stringify(data) }),
  updateProduct: (id, d) => request(`/products/${id}`, { method: 'PUT', body: JSON.stringify(d) }),
  deleteProduct: (id) => request(`/products/${id}`, { method: 'DELETE' }),
  getAds: () => request('/ads'),
  createAd: (data) => request('/ads', { method: 'POST', body: JSON.stringify(data) }),
  updateAd: (id, d) => request(`/ads/${id}`, { method: 'PUT', body: JSON.stringify(d) }),
  deleteAd: (id) => request(`/ads/${id}`, { method: 'DELETE' }),
  getBuyers: () => request('/buyers'),
  logClick: (ad_id, match_id) => request('/buyer/click', { method: 'POST', body: JSON.stringify({ ad_id, match_id }) }),
  getAdEvents: (params = {}) => {
    const queryParams = new URLSearchParams();
    if (params.event_type) queryParams.append('event_type', params.event_type);
    if (params.ad_id) queryParams.append('ad_id', params.ad_id);
    if (params.seller_id) queryParams.append('seller_id', params.seller_id);
    if (params.start_date) queryParams.append('start_date', params.start_date);
    if (params.end_date) queryParams.append('end_date', params.end_date);
    if (params.limit) queryParams.append('limit', params.limit);
    const qs = queryParams.toString();
    return request(`/admin/ad-events${qs ? `?${qs}` : ''}`);
  },
};