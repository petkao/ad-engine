import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { PageHeader, Badge, Table, SearchBar, Spinner } from '../components/UI';

export default function Buyers() {
  const [buyers, setBuyers] = useState([]);
  const [registeredBuyers, setRegisteredBuyers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState('registered');

  useEffect(() => {
    Promise.all([
      api.getBuyers(),
      api.getRegisteredBuyers().catch(() => []),
    ]).then(([anonymous, registered]) => {
      setBuyers(anonymous);
      setRegisteredBuyers(registered);
    }).finally(() => setLoading(false));
  }, []);

  const filteredAnonymous = buyers.filter(b =>
    b.device_id.toLowerCase().includes(search.toLowerCase()) ||
    b.platform.toLowerCase().includes(search.toLowerCase()) ||
    b.model_version.toLowerCase().includes(search.toLowerCase())
  );

  const filteredRegistered = registeredBuyers.filter(b =>
    (b.name || '').toLowerCase().includes(search.toLowerCase()) ||
    (b.email || '').toLowerCase().includes(search.toLowerCase())
  );

  const formatLocation = (row) => {
    const parts = [row.city, row.state, row.country].filter(Boolean);
    return parts.length > 0 ? parts.join(', ') : null;
  };

  const anonymousColumns = [
    { key: 'device_id', label: 'Device ID', render: v => (
      <span className="font-mono text-xs text-slate-500">{v}</span>
    )},
    { key: 'platform', label: 'Platform', render: v => <Badge>{v}</Badge> },
    { key: 'city', label: 'Location', render: (v, row) => {
      const loc = formatLocation(row);
      return loc
        ? <span className="text-xs text-slate-500">📍 {loc}</span>
        : <span className="text-xs text-slate-300">Unknown</span>;
    }},
    { key: 'model_version', label: 'LLM Version', render: v => (
      <span className="font-mono text-xs text-blue-600">{v}</span>
    )},
    { key: 'consent_version', label: 'Consent', render: v => <Badge variant="active">{v}</Badge> },
    { key: 'last_active', label: 'Last Active', render: v => (
      <span className="text-xs text-slate-400">{v ? new Date(v).toLocaleDateString() : '—'}</span>
    )},
    { key: 'created_at', label: 'Joined', render: v => (
      <span className="text-xs text-slate-400">{new Date(v).toLocaleDateString()}</span>
    )},
  ];

  const registeredColumns = [
    { key: 'avatar_url', label: '', render: (v, row) => (
      v ? (
        <img src={v} alt="" className="w-8 h-8 rounded-full" />
      ) : (
        <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-xs font-medium text-slate-500">
          {(row.name || row.email || '?').charAt(0).toUpperCase()}
        </div>
      )
    )},
    { key: 'name', label: 'Name', render: v => (
      <span className="font-medium text-slate-700">{v || '—'}</span>
    )},
    { key: 'email', label: 'Email', render: v => (
      <span className="text-sm text-slate-500">{v}</span>
    )},
    { key: 'google_id', label: 'Google ID', render: v => (
      <span className="font-mono text-xs text-slate-400">{v ? v.slice(0, 10) + '...' : '—'}</span>
    )},
    { key: 'last_login', label: 'Last Login', render: v => (
      <span className="text-xs text-slate-400">{v ? new Date(v).toLocaleString() : '—'}</span>
    )},
    { key: 'created_at', label: 'Joined', render: v => (
      <span className="text-xs text-slate-400">{new Date(v).toLocaleDateString()}</span>
    )},
  ];

  return (
    <div>
      <PageHeader
        title="Buyers"
        subtitle={`${registeredBuyers.length} registered · ${buyers.length} anonymous devices`}
      />

      {/* Tabs */}
      <div className="flex gap-2 mb-6">
        <button
          onClick={() => setActiveTab('registered')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            activeTab === 'registered'
              ? 'bg-blue-600 text-white'
              : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
          }`}
        >
          🔐 Registered ({registeredBuyers.length})
        </button>
        <button
          onClick={() => setActiveTab('anonymous')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            activeTab === 'anonymous'
              ? 'bg-blue-600 text-white'
              : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
          }`}
        >
          📱 Anonymous Devices ({buyers.length})
        </button>
      </div>

      {activeTab === 'registered' && (
        <>
          <div className="bg-green-50 border border-green-200 rounded-2xl p-4 mb-6 flex gap-3">
            <span className="text-green-500 text-lg">✅</span>
            <div className="text-sm text-green-800">
              <strong>Google Sign-In users:</strong> These buyers signed in with their Google account.
              They can leave reviews and access personalized features.
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
            <div className="p-4 border-b border-slate-100">
              <SearchBar value={search} onChange={setSearch} placeholder="Search by name or email..." />
            </div>
            {loading ? <Spinner /> : (
              filteredRegistered.length > 0 ? (
                <Table columns={registeredColumns} data={filteredRegistered} />
              ) : (
                <div className="p-8 text-center text-slate-400">
                  No registered buyers yet. Users can sign in with Google on the buyer landing page.
                </div>
              )
            )}
          </div>
        </>
      )}

      {activeTab === 'anonymous' && (
        <>
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 mb-6 flex gap-3">
            <span className="text-amber-500 text-lg">🔒</span>
            <div className="text-sm text-amber-800">
              <strong>Privacy by design:</strong> Only anonymous device IDs, consent versions, and on-device model versions are stored here.
              All personal buyer data (preferences, history, intent) stays on the buyer's device and never touches this server.
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
            <div className="p-4 border-b border-slate-100">
              <SearchBar value={search} onChange={setSearch} placeholder="Search by device ID, platform, or model version..." />
            </div>
            {loading ? <Spinner /> : (
              <Table columns={anonymousColumns} data={filteredAnonymous} />
            )}
          </div>
        </>
      )}
    </div>
  );
}
