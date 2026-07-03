import { useEffect, useState } from 'react';
import { Spinner, PageHeader } from '../components/UI';

const BASE = process.env.REACT_APP_API_URL || 'http://localhost:3001';

function getHeaders() {
  const token = localStorage.getItem('auth_token');
  return {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
  };
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

function formatLocation(city, state, country) {
  const parts = [city, state, country].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : '—';
}

export default function GeoVerification() {
  const [tab, setTab] = useState('sellers');
  const [sellerLogs, setSellerLogs] = useState([]);
  const [buyerLogs, setBuyerLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetch(`${BASE}/api/admin/seller-geo-logs`, { headers: getHeaders() }).then(r => r.ok ? r.json() : []),
      fetch(`${BASE}/api/admin/buyer-geo-logs`, { headers: getHeaders() }).then(r => r.ok ? r.json() : []),
    ]).then(([sellers, buyers]) => {
      setSellerLogs(Array.isArray(sellers) ? sellers : []);
      setBuyerLogs(Array.isArray(buyers) ? buyers : []);
    }).finally(() => setLoading(false));
  }, []);

  const mismatchCount = sellerLogs.filter(s => s.geo_match === false).length;

  if (loading) return <Spinner />;

  return (
    <div>
      <PageHeader
        title="Geo Verification"
        subtitle="IP geolocation tracking for fraud detection"
      />

      {/* Summary Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
          <div className="text-2xl font-bold text-blue-700">{sellerLogs.length}</div>
          <div className="text-sm text-blue-600">Seller Logins</div>
        </div>
        <div className="bg-green-50 border border-green-100 rounded-xl p-4">
          <div className="text-2xl font-bold text-green-700">{buyerLogs.length}</div>
          <div className="text-sm text-green-600">Buyer Clicks</div>
        </div>
        <div className="bg-amber-50 border border-amber-100 rounded-xl p-4">
          <div className="text-2xl font-bold text-amber-700">{mismatchCount}</div>
          <div className="text-sm text-amber-600">Location Mismatches</div>
        </div>
        <div className="bg-purple-50 border border-purple-100 rounded-xl p-4">
          <div className="text-2xl font-bold text-purple-700">
            {sellerLogs.length > 0 ? Math.round((sellerLogs.filter(s => s.geo_match).length / sellerLogs.length) * 100) : 0}%
          </div>
          <div className="text-sm text-purple-600">Match Rate</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setTab('sellers')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            tab === 'sellers'
              ? 'bg-blue-600 text-white'
              : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
          }`}
        >
          Seller Geo ({sellerLogs.length})
        </button>
        <button
          onClick={() => setTab('buyers')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            tab === 'buyers'
              ? 'bg-blue-600 text-white'
              : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
          }`}
        >
          Buyer Geo ({buyerLogs.length})
        </button>
      </div>

      {/* Seller Geo Table */}
      {tab === 'sellers' && (
        <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50">
                  <th className="text-left py-3 px-4 text-xs font-semibold text-slate-500 uppercase">Seller</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-slate-500 uppercase">Email</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-slate-500 uppercase">Claimed Location</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-slate-500 uppercase">Detected Location</th>
                  <th className="text-center py-3 px-4 text-xs font-semibold text-slate-500 uppercase">Match</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-slate-500 uppercase">Date</th>
                </tr>
              </thead>
              <tbody>
                {sellerLogs.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center py-12 text-slate-400">
                      <div className="text-3xl mb-2">📍</div>
                      No seller geo logs yet
                    </td>
                  </tr>
                ) : (
                  sellerLogs.map((log) => (
                    <tr
                      key={log.id}
                      className={`border-b border-slate-50 hover:bg-slate-50 transition-colors ${
                        log.geo_match === false ? 'bg-amber-50' : ''
                      }`}
                    >
                      <td className="py-3 px-4">
                        <div className="font-medium text-slate-800">{log.seller_name || '—'}</div>
                      </td>
                      <td className="py-3 px-4 text-slate-600">{log.seller_email || '—'}</td>
                      <td className="py-3 px-4 text-slate-600">{log.claimed_location || '—'}</td>
                      <td className="py-3 px-4">
                        <div className="text-slate-800">
                          {formatLocation(log.detected_city, log.detected_state, log.detected_country)}
                        </div>
                        <div className="text-xs text-slate-400">{log.ip}</div>
                      </td>
                      <td className="py-3 px-4 text-center">
                        {log.geo_match === true ? (
                          <span className="text-green-600 text-lg">✅</span>
                        ) : log.geo_match === false ? (
                          <span className="text-amber-600 text-lg">⚠️</span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-slate-500 text-xs">{formatDate(log.created_at)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Buyer Geo Table */}
      {tab === 'buyers' && (
        <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50">
                  <th className="text-left py-3 px-4 text-xs font-semibold text-slate-500 uppercase">Session ID</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-slate-500 uppercase">City</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-slate-500 uppercase">State</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-slate-500 uppercase">Country</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-slate-500 uppercase">IP</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-slate-500 uppercase">Timestamp</th>
                </tr>
              </thead>
              <tbody>
                {buyerLogs.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center py-12 text-slate-400">
                      <div className="text-3xl mb-2">🛒</div>
                      No buyer geo logs yet
                    </td>
                  </tr>
                ) : (
                  buyerLogs.map((log) => (
                    <tr key={log.id} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                      <td className="py-3 px-4">
                        <code className="text-xs bg-slate-100 px-2 py-0.5 rounded text-slate-600">
                          {log.session_id ? log.session_id.slice(0, 12) + '...' : '—'}
                        </code>
                      </td>
                      <td className="py-3 px-4 text-slate-700">{log.city || '—'}</td>
                      <td className="py-3 px-4 text-slate-700">{log.state || '—'}</td>
                      <td className="py-3 px-4 text-slate-700">{log.country || '—'}</td>
                      <td className="py-3 px-4 text-slate-500 text-xs font-mono">{log.ip || '—'}</td>
                      <td className="py-3 px-4 text-slate-500 text-xs">{formatDate(log.created_at)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
