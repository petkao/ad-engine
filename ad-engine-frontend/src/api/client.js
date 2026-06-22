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

export const api = {
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
};