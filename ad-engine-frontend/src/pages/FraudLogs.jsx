import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { PageHeader, Badge, Spinner } from '../components/UI';

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

function getActionBadge(action, score) {
  if (action === 'block') {
    return <Badge variant="inactive" className="bg-red-100 text-red-700">Blocked ({score})</Badge>;
  }
  if (action === 'review') {
    return <Badge variant="pending" className="bg-amber-100 text-amber-700">Review ({score})</Badge>;
  }
  return <Badge variant="active" className="bg-green-100 text-green-700">Allowed ({score})</Badge>;
}

function getEntityTypeBadge(type) {
  if (type === 'registration') {
    return <Badge className="bg-blue-100 text-blue-700">Seller Registration</Badge>;
  }
  if (type === 'buyer_registration') {
    return <Badge className="bg-cyan-100 text-cyan-700">Buyer Registration</Badge>;
  }
  if (type === 'ad_submission') {
    return <Badge className="bg-purple-100 text-purple-700">Ad Submission</Badge>;
  }
  return <Badge>{type}</Badge>;
}

function exportToCSV(logs) {
  const headers = [
    'ID', 'Action', 'Score', 'Entity Type', 'Entity ID', 'IP Address', 'URL',
    'IP Score', 'IP Details', 'URL Score', 'URL Details',
    'Domain Score', 'Domain Details', 'Multi-Account Score', 'Multi-Account Details',
    'Timestamp'
  ];
  const rows = logs.map(l => [
    l.id,
    l.action,
    l.total_score,
    l.entity_type,
    l.entity_id || 'N/A',
    l.ip_address || 'N/A',
    l.url || 'N/A',
    l.ip_reputation_score,
    (l.ip_reputation_details || '').replace(/,/g, ';'),
    l.url_safety_score,
    (l.url_safety_details || '').replace(/,/g, ';'),
    l.domain_age_score,
    (l.domain_age_details || '').replace(/,/g, ';'),
    l.multi_account_score,
    (l.multi_account_details || '').replace(/,/g, ';'),
    l.created_at
  ]);

  const csvContent = [headers, ...rows]
    .map(row => row.map(cell => `"${cell}"`).join(','))
    .join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `fraud-logs-${new Date().toISOString().split('T')[0]}.csv`);
  link.click();
}

export default function FraudLogs() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionFilter, setActionFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [expandedRow, setExpandedRow] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const params = {};
      if (actionFilter !== 'all') params.action = actionFilter;
      if (typeFilter !== 'all') params.entity_type = typeFilter;
      const data = await api.getFraudLogs(params);
      setLogs(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Failed to load fraud logs:', err);
      setLogs([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [actionFilter, typeFilter]);

  const blockedCount = logs.filter(l => l.action === 'block').length;
  const reviewCount = logs.filter(l => l.action === 'review').length;
  const allowedCount = logs.filter(l => l.action === 'allow').length;

  return (
    <div>
      <PageHeader
        title="Fraud Detection Logs"
        subtitle="Monitor registration and ad submission fraud checks"
      />

      {/* Summary Stats */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-slate-50 border border-slate-100 rounded-xl p-4">
          <div className="text-2xl font-bold text-slate-700">{logs.length}</div>
          <div className="text-sm text-slate-600">Total Checks</div>
        </div>
        <div className="bg-red-50 border border-red-100 rounded-xl p-4">
          <div className="text-2xl font-bold text-red-700">{blockedCount}</div>
          <div className="text-sm text-red-600">Blocked</div>
        </div>
        <div className="bg-amber-50 border border-amber-100 rounded-xl p-4">
          <div className="text-2xl font-bold text-amber-700">{reviewCount}</div>
          <div className="text-sm text-amber-600">Flagged for Review</div>
        </div>
        <div className="bg-green-50 border border-green-100 rounded-xl p-4">
          <div className="text-2xl font-bold text-green-700">{allowedCount}</div>
          <div className="text-sm text-green-600">Allowed</div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl border border-slate-100 p-4 mb-6">
        <div className="flex flex-wrap items-center gap-4">
          {/* Action Filter */}
          <div className="flex gap-2">
            <span className="text-sm text-slate-500 self-center">Action:</span>
            {['all', 'block', 'review', 'allow'].map(action => (
              <button
                key={action}
                onClick={() => setActionFilter(action)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  actionFilter === action
                    ? action === 'block' ? 'bg-red-600 text-white'
                      : action === 'review' ? 'bg-amber-600 text-white'
                      : action === 'allow' ? 'bg-green-600 text-white'
                      : 'bg-purple-600 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {action === 'all' ? 'All' : action.charAt(0).toUpperCase() + action.slice(1)}
              </button>
            ))}
          </div>

          {/* Entity Type Filter */}
          <div className="flex gap-2 ml-4">
            <span className="text-sm text-slate-500 self-center">Type:</span>
            {['all', 'registration', 'buyer_registration', 'ad_submission'].map(type => (
              <button
                key={type}
                onClick={() => setTypeFilter(type)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  typeFilter === type
                    ? type === 'registration' ? 'bg-blue-600 text-white'
                      : type === 'buyer_registration' ? 'bg-cyan-600 text-white'
                      : type === 'ad_submission' ? 'bg-purple-600 text-white'
                      : 'bg-slate-600 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {type === 'all' ? 'All Types'
                  : type === 'ad_submission' ? 'Ad Submission'
                  : type === 'buyer_registration' ? 'Buyer Reg'
                  : 'Seller Reg'}
              </button>
            ))}
          </div>

          {/* Export Button */}
          <button
            onClick={() => exportToCSV(logs)}
            disabled={logs.length === 0}
            className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed ml-auto"
          >
            Export CSV
          </button>
        </div>
      </div>

      {/* Logs Table */}
      <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50">
                <th className="text-left py-3 px-4 text-xs font-semibold text-slate-500 uppercase">Action</th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-slate-500 uppercase">Type</th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-slate-500 uppercase">IP Address</th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-slate-500 uppercase">URL</th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-slate-500 uppercase">Score Breakdown</th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-slate-500 uppercase">Timestamp</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="text-center py-12">
                    <Spinner />
                  </td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-slate-400">
                    <div className="text-3xl mb-2">🛡️</div>
                    No fraud checks logged yet
                  </td>
                </tr>
              ) : (
                logs.map((log) => (
                  <>
                    <tr
                      key={log.id}
                      onClick={() => setExpandedRow(expandedRow === log.id ? null : log.id)}
                      className={`border-b border-slate-50 hover:bg-slate-50 transition-colors cursor-pointer ${
                        log.action === 'block' ? 'bg-red-50/50'
                          : log.action === 'review' ? 'bg-amber-50/50'
                          : 'bg-white'
                      }`}
                    >
                      <td className="py-3 px-4">
                        {getActionBadge(log.action, log.total_score)}
                      </td>
                      <td className="py-3 px-4">
                        {getEntityTypeBadge(log.entity_type)}
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-mono text-xs text-slate-700">{log.ip_address || '—'}</div>
                      </td>
                      <td className="py-3 px-4">
                        <div className="text-xs text-slate-600 truncate max-w-[200px]" title={log.url}>
                          {log.url || '—'}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex gap-2 text-xs">
                          {log.ip_reputation_score > 0 && (
                            <span className="px-2 py-0.5 bg-orange-100 text-orange-700 rounded">IP: {log.ip_reputation_score}</span>
                          )}
                          {log.url_safety_score > 0 && (
                            <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded">URL: {log.url_safety_score}</span>
                          )}
                          {log.domain_age_score > 0 && (
                            <span className="px-2 py-0.5 bg-amber-100 text-amber-700 rounded">Domain: {log.domain_age_score}</span>
                          )}
                          {log.multi_account_score > 0 && (
                            <span className="px-2 py-0.5 bg-purple-100 text-purple-700 rounded">Multi: {log.multi_account_score}</span>
                          )}
                          {log.total_score === 0 && (
                            <span className="text-slate-400">No risk factors</span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-slate-500 text-xs">{formatDate(log.created_at)}</td>
                    </tr>
                    {expandedRow === log.id && (
                      <tr key={`${log.id}-details`} className="bg-slate-50">
                        <td colSpan={6} className="py-4 px-6">
                          <div className="grid grid-cols-2 gap-4 text-sm">
                            <div>
                              <div className="font-semibold text-slate-700 mb-2">IP Reputation</div>
                              <div className="text-slate-600">{log.ip_reputation_details || 'Not checked'}</div>
                            </div>
                            <div>
                              <div className="font-semibold text-slate-700 mb-2">URL Safety</div>
                              <div className="text-slate-600">{log.url_safety_details || 'Not checked'}</div>
                            </div>
                            <div>
                              <div className="font-semibold text-slate-700 mb-2">Domain Age</div>
                              <div className="text-slate-600">{log.domain_age_details || 'Not checked'}</div>
                            </div>
                            <div>
                              <div className="font-semibold text-slate-700 mb-2">Multi-Account Detection</div>
                              <div className="text-slate-600">{log.multi_account_details || 'Not checked'}</div>
                            </div>
                            {log.entity_id && (
                              <div className="col-span-2">
                                <div className="font-semibold text-slate-700 mb-2">Entity ID</div>
                                <div className="text-slate-600 font-mono text-xs">{log.entity_id}</div>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
