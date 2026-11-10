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
  if (!res.ok) {
    let errorMessage = `API error: ${res.status}`;
    try {
      const data = await res.json();
      errorMessage = data.error || data.message || errorMessage;
    } catch {
      // Response wasn't JSON, use status code
    }
    throw new Error(errorMessage);
  }
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
  getRegisteredBuyers: () => request('/admin/registered-buyers'),
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
  // Seller approval endpoints
  getPendingSellers: () => request('/admin/sellers/pending'),
  getPendingSellersCount: () => request('/admin/sellers/pending/count'),
  approveSeller: (id) => request(`/admin/sellers/${id}/approve`, { method: 'PUT' }),
  rejectSeller: (id) => request(`/admin/sellers/${id}/reject`, { method: 'PUT' }),
  suspendSeller: (id) => request(`/admin/sellers/${id}/suspend`, { method: 'PUT' }),
  unsuspendSeller: (id) => request(`/admin/sellers/${id}/unsuspend`, { method: 'PUT' }),
  // Fraud detection endpoints
  getFraudLogs: (params = {}) => {
    const queryParams = new URLSearchParams();
    if (params.action) queryParams.append('action', params.action);
    if (params.entity_type) queryParams.append('entity_type', params.entity_type);
    if (params.limit) queryParams.append('limit', params.limit);
    const qs = queryParams.toString();
    return request(`/admin/fraud-logs${qs ? `?${qs}` : ''}`);
  },
  // Buyer ban/unban endpoints
  banBuyer: (id, reason) => request(`/admin/buyers/${id}/ban`, { method: 'POST', body: JSON.stringify({ reason }) }),
  unbanBuyer: (id) => request(`/admin/buyers/${id}/unban`, { method: 'POST' }),

  // Creative Studio endpoints
  getCreativeBriefs: () => request('/creative-studio/briefs'),
  getCreativeBrief: (id) => request(`/creative-studio/briefs/${id}`),
  createCreativeBrief: (productId) => request('/creative-studio/briefs', {
    method: 'POST',
    body: JSON.stringify({ product_id: productId }),
  }),
  selectCampaign: (briefId, campaignIndex) => request(`/creative-studio/briefs/${briefId}/select-campaign`, {
    method: 'PUT',
    body: JSON.stringify({ campaign_index: campaignIndex }),
  }),
  generateScript: (briefId, options = {}) => request(`/creative-studio/briefs/${briefId}/script`, {
    method: 'POST',
    body: JSON.stringify({
      platform: options.platform || 'generic',
      duration_seconds: options.duration || 15,
    }),
  }),
  getScripts: (briefId) => request(`/creative-studio/briefs/${briefId}/scripts`),
  generateStoryboard: (scriptId, aspectRatio = '9:16') => request(`/creative-studio/scripts/${scriptId}/storyboard`, {
    method: 'POST',
    body: JSON.stringify({ aspect_ratio: aspectRatio }),
  }),
  getStoryboards: (scriptId) => request(`/creative-studio/scripts/${scriptId}/storyboards`),
  updateStoryboardStatus: (storyboardId, status) => request(`/creative-studio/storyboards/${storyboardId}/status`, {
    method: 'PUT',
    body: JSON.stringify({ status }),
  }),

  // Creative Studio - Product Workspace endpoints
  getCreativeProductBriefs: (productId) => request(`/creative-studio/products/${productId}/briefs`),
  getCreativeProductScripts: (productId) => request(`/creative-studio/products/${productId}/scripts`),
  getCreativeProductStoryboards: (productId) => request(`/creative-studio/products/${productId}/storyboards`),
  getCreativeProductStats: (productId) => request(`/creative-studio/products/${productId}/stats`),
};