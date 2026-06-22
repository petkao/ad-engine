import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { PageHeader, Badge, Table, SearchBar, Spinner } from '../components/UI';

export default function Buyers() {
  const [buyers, setBuyers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    api.getBuyers().then(setBuyers).finally(() => setLoading(false));
  }, []);

  const filtered = buyers.filter(b =>
    b.device_id.toLowerCase().includes(search.toLowerCase()) ||
    b.platform.toLowerCase().includes(search.toLowerCase()) ||
    b.model_version.toLowerCase().includes(search.toLowerCase())
  );

  const columns = [
    { key: 'device_id', label: 'Device ID', render: v => (
      <span className="font-mono text-xs text-slate-500">{v}</span>
    )},
    { key: 'platform', label: 'Platform', render: v => <Badge>{v}</Badge> },
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

  return (
    <div>
      <PageHeader
        title="Buyers"
        subtitle={`${buyers.length} registered devices — no personal data stored`}
      />

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
          <Table columns={columns} data={filtered} />
        )}
      </div>
    </div>
  );
}
