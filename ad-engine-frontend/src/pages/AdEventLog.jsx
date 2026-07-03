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

function formatLocation(city, state, country) {
  const parts = [city, state, country].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : 'Unknown';
}

function formatBuyerId(sessionId, deviceId) {
  if (deviceId) return deviceId.length > 12 ? deviceId.slice(0, 12) + '...' : deviceId;
  if (sessionId) return sessionId.slice(0, 8) + '...';
  return '—';
}

function getFullBuyerId(sessionId, deviceId) {
  if (deviceId) return `Device: ${deviceId}`;
  if (sessionId) return `Session: ${sessionId}`;
  return 'Unknown';
}

function exportToCSV(events) {
  const headers = ['Type', 'Ad Title', 'Seller', 'Buyer', 'Device ID', 'Session ID', 'Location', 'IP', 'User Agent', 'Referrer', 'Timestamp'];
  const rows = events.map(e => [
    e.event_type,
    e.ad_title || 'N/A',
    e.seller_name || 'N/A',
    formatBuyerId(e.buyer_session_id, e.buyer_device_id),
    e.buyer_device_id || 'N/A',
    e.buyer_session_id || 'N/A',
    formatLocation(e.buyer_city, e.buyer_state, e.buyer_country),
    e.buyer_ip || 'N/A',
    (e.user_agent || 'N/A').replace(/,/g, ';'),
    e.referrer || 'N/A',
    e.timestamp
  ]);

  const csvContent = [headers, ...rows]
    .map(row => row.map(cell => `"${cell}"`).join(','))
    .join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `ad-events-${new Date().toISOString().split('T')[0]}.csv`);
  link.click();
}

export default function AdEventLog() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all'); // 'all', 'click', 'impression'
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const params = {};
      if (filter !== 'all') params.event_type = filter;
      if (startDate) params.start_date = startDate;
      if (endDate) params.end_date = endDate + 'T23:59:59';
      const data = await api.getAdEvents(params);
      setEvents(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Failed to load ad events:', err);
      setEvents([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [filter, startDate, endDate]);

  const clickCount = events.filter(e => e.event_type === 'click').length;
  const impressionCount = events.filter(e => e.event_type === 'impression').length;

  return (
    <div>
      <PageHeader
        title="Ad Event Log"
        subtitle="Track all ad impressions and clicks"
      />

      {/* Summary Stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
          <div className="text-2xl font-bold text-blue-700">{events.length}</div>
          <div className="text-sm text-blue-600">Total Events</div>
        </div>
        <div className="bg-green-50 border border-green-100 rounded-xl p-4">
          <div className="text-2xl font-bold text-green-700">{clickCount}</div>
          <div className="text-sm text-green-600">Clicks</div>
        </div>
        <div className="bg-slate-50 border border-slate-100 rounded-xl p-4">
          <div className="text-2xl font-bold text-slate-700">{impressionCount}</div>
          <div className="text-sm text-slate-600">Impressions</div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl border border-slate-100 p-4 mb-6">
        <div className="flex flex-wrap items-center gap-4">
          {/* Event Type Filter */}
          <div className="flex gap-2">
            {['all', 'click', 'impression'].map(type => (
              <button
                key={type}
                onClick={() => setFilter(type)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  filter === type
                    ? type === 'click' ? 'bg-blue-600 text-white'
                      : type === 'impression' ? 'bg-slate-600 text-white'
                      : 'bg-purple-600 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {type === 'all' ? 'All Events' : type.charAt(0).toUpperCase() + type.slice(1) + 's'}
              </button>
            ))}
          </div>

          {/* Date Range */}
          <div className="flex items-center gap-2 ml-auto">
            <label className="text-sm text-slate-500">From:</label>
            <input
              type="date"
              value={startDate}
              onChange={e => setStartDate(e.target.value)}
              className="px-3 py-2 border border-slate-200 rounded-lg text-sm"
            />
            <label className="text-sm text-slate-500">To:</label>
            <input
              type="date"
              value={endDate}
              onChange={e => setEndDate(e.target.value)}
              className="px-3 py-2 border border-slate-200 rounded-lg text-sm"
            />
          </div>

          {/* Export Button */}
          <button
            onClick={() => exportToCSV(events)}
            disabled={events.length === 0}
            className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Export CSV
          </button>
        </div>
      </div>

      {/* Events Table */}
      <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50">
                <th className="text-left py-3 px-4 text-xs font-semibold text-slate-500 uppercase">Type</th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-slate-500 uppercase">Ad Title</th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-slate-500 uppercase">Seller</th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-slate-500 uppercase">Buyer</th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-slate-500 uppercase">Location</th>
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
              ) : events.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-slate-400">
                    <div className="text-3xl mb-2">📋</div>
                    No ad events yet
                  </td>
                </tr>
              ) : (
                events.map((event) => (
                  <tr
                    key={event.id}
                    className={`border-b border-slate-50 hover:bg-slate-50 transition-colors ${
                      event.event_type === 'click' ? 'bg-blue-50/50' : 'bg-white'
                    }`}
                  >
                    <td className="py-3 px-4">
                      {event.event_type === 'click' ? (
                        <Badge variant="active">Click</Badge>
                      ) : (
                        <Badge>Impression</Badge>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-medium text-slate-800">{event.ad_title || 'N/A'}</div>
                      {event.ad_id && (
                        <div className="text-xs text-slate-400">ID: {event.ad_id}</div>
                      )}
                    </td>
                    <td className="py-3 px-4 text-slate-600">{event.seller_name || '—'}</td>
                    <td className="py-3 px-4">
                      <div
                        className="text-slate-700 font-mono text-xs cursor-help"
                        title={getFullBuyerId(event.buyer_session_id, event.buyer_device_id)}
                      >
                        {formatBuyerId(event.buyer_session_id, event.buyer_device_id)}
                      </div>
                      {event.buyer_device_id && (
                        <div className="text-xs text-green-600">Device</div>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <div className="text-slate-700">
                        {formatLocation(event.buyer_city, event.buyer_state, event.buyer_country)}
                      </div>
                      {event.buyer_ip && (
                        <div className="text-xs text-slate-400">{event.buyer_ip}</div>
                      )}
                    </td>
                    <td className="py-3 px-4 text-slate-500 text-xs">{formatDate(event.timestamp)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
