import { useEffect, useState, useCallback } from 'react';
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';
import { Spinner, StatCard } from '../components/UI';
import { useAuth } from '../auth/AuthContext';

// const BASE = 'http://localhost:3001/api/analytics';
const BASE = `${process.env.REACT_APP_API_URL || 'http://localhost:3001'}/api/analytics`;
const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:3001';

const COLORS = ['#2563eb', '#f59e0b', '#10b981', '#8b5cf6', '#ef4444', '#06b6d4', '#f97316', '#84cc16'];

function fetchJson(url, params = {}) {
  const qs = new URLSearchParams(params).toString();
  const token = localStorage.getItem('auth_token');
  return fetch(`${qs ? `${url}?${qs}` : url}`, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    },
  }).then(r => {
    if (!r.ok) throw new Error(`API error: ${r.status}`);
    return r.json();
  });
}

// ── Custom Tooltip ────────────────────────────────────────────
function CustomTooltip({ active, payload, label, prefix = '', suffix = '' }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-lg px-4 py-3 text-sm">
      <div className="font-semibold text-slate-700 mb-1">{label}</div>
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full" style={{ background: p.color }} />
          <span className="text-slate-500">{p.name}:</span>
          <span className="font-medium">{prefix}{typeof p.value === 'number' ? p.value.toFixed(2) : p.value}{suffix}</span>
        </div>
      ))}
    </div>
  );
}

// ── Chart Card ────────────────────────────────────────────────
function ChartCard({ title, subtitle, children, className = '' }) {
  return (
    <div className={`bg-white rounded-2xl border border-slate-100 p-6 ${className}`}>
      <div className="mb-4">
        <h3 className="font-semibold text-slate-800">{title}</h3>
        {subtitle && <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

// ── Date Range Picker ─────────────────────────────────────────
function DateRangePicker({ start, end, onChange }) {
  const presets = [
    { label: '7 days', days: 7 },
    { label: '30 days', days: 30 },
    { label: '90 days', days: 90 },
  ];

  const applyPreset = (days) => {
    const endDate = new Date().toISOString().split('T')[0];
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    onChange(startDate, endDate);
  };

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <div className="flex gap-2">
        {presets.map(p => (
          <button key={p.days} onClick={() => applyPreset(p.days)}
            className="px-3 py-1.5 text-xs font-medium border border-slate-200 rounded-lg hover:bg-slate-50 transition-all">
            Last {p.label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2 text-sm">
        <input type="date" value={start} onChange={e => onChange(e.target.value, end)}
          className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        <span className="text-slate-400">to</span>
        <input type="date" value={end} onChange={e => onChange(start, e.target.value)}
          className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
      </div>
    </div>
  );
}

// ── Revenue Tab (Admin Only) ─────────────────────────────────
function RevenueTab() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('auth_token');
    fetch(`${API_BASE}/api/admin/revenue`, {
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      },
    })
      .then(r => r.json())
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Spinner />;
  if (!data) return <div className="text-slate-500">Failed to load revenue data</div>;

  return (
    <div>
      {/* MRR Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="Monthly Recurring Revenue" value={`$${data.total_mrr.toFixed(0)}`} icon="💰" color="green" />
        <StatCard label="Active Subscriptions" value={data.total_active_subscriptions} icon="📊" color="blue" />
        <StatCard label="Failed Payments (30d)" value={data.failed_payments_30d} icon="⚠️" color={data.failed_payments_30d > 0 ? 'red' : 'slate'} />
        <StatCard label="Projected ARR" value={`$${(data.total_mrr * 12).toFixed(0)}`} icon="📈" color="purple" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Subscriptions by Plan */}
        <ChartCard title="Subscriptions by Plan" subtitle="Active paid subscriptions breakdown">
          {data.subscriptions_by_plan?.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={data.subscriptions_by_plan}
                  dataKey="count"
                  nameKey="plan"
                  cx="50%"
                  cy="50%"
                  outerRadius={80}
                  innerRadius={40}
                  label={({ name, count, mrr }) => `${name}: ${count} ($${mrr}/mo)`}
                >
                  {data.subscriptions_by_plan.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-52 flex items-center justify-center text-slate-400 text-sm">No paid subscriptions yet</div>
          )}
        </ChartCard>

        {/* MRR by Plan Breakdown */}
        <ChartCard title="MRR by Plan" subtitle="Revenue breakdown by subscription tier">
          <div className="space-y-4">
            {data.subscriptions_by_plan?.map((plan, i) => (
              <div key={plan.plan} className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: COLORS[i % COLORS.length] }}
                  />
                  <span className="font-medium text-slate-700 capitalize">{plan.plan}</span>
                </div>
                <div className="text-right">
                  <div className="font-semibold text-slate-800">${parseFloat(plan.mrr).toFixed(0)}/mo</div>
                  <div className="text-xs text-slate-500">{plan.count} subscribers</div>
                </div>
              </div>
            ))}
            {(!data.subscriptions_by_plan || data.subscriptions_by_plan.length === 0) && (
              <div className="text-center text-slate-400 py-8">No paid subscriptions yet</div>
            )}
          </div>
        </ChartCard>
      </div>

      {/* Recent Payments */}
      <ChartCard title="Recent Payments" subtitle="Last 20 payment transactions">
        <div className="overflow-auto max-h-80">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="text-left py-2 text-xs text-slate-500 font-semibold">Date</th>
                <th className="text-left py-2 text-xs text-slate-500 font-semibold">Seller</th>
                <th className="text-left py-2 text-xs text-slate-500 font-semibold">Description</th>
                <th className="text-right py-2 text-xs text-slate-500 font-semibold">Amount</th>
                <th className="text-right py-2 text-xs text-slate-500 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.recent_payments?.map((payment) => (
                <tr key={payment.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="py-2 text-xs text-slate-600">
                    {new Date(payment.created_at).toLocaleDateString()}
                  </td>
                  <td className="py-2">
                    <div className="text-xs font-medium text-slate-700">{payment.seller_name}</div>
                    <div className="text-xs text-slate-400">{payment.seller_email}</div>
                  </td>
                  <td className="py-2 text-xs text-slate-600">{payment.description}</td>
                  <td className="py-2 text-right text-xs font-mono font-semibold text-slate-800">
                    ${(payment.amount_cents / 100).toFixed(2)}
                  </td>
                  <td className="py-2 text-right">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                      payment.status === 'succeeded'
                        ? 'bg-green-100 text-green-700'
                        : 'bg-red-100 text-red-700'
                    }`}>
                      {payment.status}
                    </span>
                  </td>
                </tr>
              ))}
              {(!data.recent_payments || data.recent_payments.length === 0) && (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-slate-400">
                    No payments yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </ChartCard>

      {data.failed_payments_30d > 0 && (
        <div className="mt-6 bg-red-50 border border-red-200 rounded-xl p-4">
          <div className="flex items-center gap-2 text-red-700 font-semibold">
            <span>⚠️</span>
            <span>{data.failed_payments_30d} failed payment(s) in the last 30 days</span>
          </div>
          <p className="text-sm text-red-600 mt-1">
            Review the payment history above and follow up with affected sellers.
          </p>
        </div>
      )}
    </div>
  );
}

// ── Main Analytics Page ───────────────────────────────────────
export default function Analytics() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [activeTab, setActiveTab] = useState('performance');

  const defaultEnd = new Date().toISOString().split('T')[0];
  const defaultStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const [start, setStart] = useState(defaultStart);
  const [end, setEnd] = useState(defaultEnd);
  const [loading, setLoading] = useState(true);

  const [overview, setOverview] = useState(null);
  const [spendTrend, setSpendTrend] = useState([]);
  const [topSellers, setTopSellers] = useState([]);
  const [topAds, setTopAds] = useState([]);
  const [byFormat, setByFormat] = useState([]);
  const [byCategory, setByCategory] = useState([]);
  const [byPlatform, setByPlatform] = useState([]);
  const [byPlan, setByPlan] = useState([]);
  const [buyerTrend, setBuyerTrend] = useState([]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const params = { start, end };
      const [ov, st, ts, ta, bf, bc, bp, bpl, bt] = await Promise.all([
        fetchJson(`${BASE}/overview`, params),
        fetchJson(`${BASE}/spend-trend`, params),
        fetchJson(`${BASE}/top-sellers`, params),
        fetchJson(`${BASE}/top-ads`, {}),
        fetchJson(`${BASE}/ads-by-format`, {}),
        fetchJson(`${BASE}/ads-by-category`, {}),
        fetchJson(`${BASE}/buyers-by-platform`, {}),
        fetchJson(`${BASE}/sellers-by-plan`, {}),
        fetchJson(`${BASE}/buyer-trend`, params),
      ]);
      setOverview(ov);
      setSpendTrend(st.map(r => ({ ...r, total_spent: parseFloat(r.total_spent) })));
      setTopSellers(ts.map(r => ({ ...r, total_spent: parseFloat(r.total_spent) })));
      setTopAds(ta.map(r => ({ ...r, spent: parseFloat(r.spent) })));
      setByFormat(bf.map(r => ({ ...r, count: parseInt(r.count) })));
      setByCategory(bc.map(r => ({ ...r, ad_count: parseInt(r.ad_count) })));
      setByPlatform(bp.map(r => ({ ...r, count: parseInt(r.count) })));
      setByPlan(bpl.map(r => ({ ...r, count: parseInt(r.count) })));
      setBuyerTrend(bt.map(r => ({ ...r, new_buyers: parseInt(r.new_buyers) })));
    } catch (err) {
      console.error('Analytics load error:', err);
    } finally {
      setLoading(false);
    }
  }, [start, end]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const handleDateChange = (s, e) => { setStart(s); setEnd(e); };

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between mb-6 flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Analytics</h1>
          <p className="text-sm text-slate-500 mt-1">Platform performance and insights</p>
        </div>
        {activeTab === 'performance' && (
          <DateRangePicker start={start} end={end} onChange={handleDateChange} />
        )}
      </div>

      {/* Tab Navigation (Admin only sees Revenue tab) */}
      {isAdmin && (
        <div className="flex gap-2 mb-6 border-b border-slate-200">
          <button
            onClick={() => setActiveTab('performance')}
            className={`px-4 py-2 font-medium text-sm transition-all ${
              activeTab === 'performance'
                ? 'text-blue-600 border-b-2 border-blue-600'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            📊 Performance
          </button>
          <button
            onClick={() => setActiveTab('revenue')}
            className={`px-4 py-2 font-medium text-sm transition-all ${
              activeTab === 'revenue'
                ? 'text-green-600 border-b-2 border-green-600'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            💰 Revenue
          </button>
        </div>
      )}

      {/* Revenue Tab Content */}
      {activeTab === 'revenue' && isAdmin && <RevenueTab />}

      {/* Performance Tab Content */}
      {activeTab === 'performance' && loading ? <Spinner /> : activeTab === 'performance' && (
        <>
          {/* Overview stat cards */}
          {overview && (
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
              <StatCard label="Total Sellers" value={overview.sellers} icon="🏪" color="blue" />
              <StatCard label="Total Products" value={overview.products} icon="📦" color="amber" />
              <StatCard label="Active Ads" value={overview.ads} icon="📢" color="green" />
              <StatCard label="Registered Buyers" value={overview.buyers} icon="👥" color="purple" />
              <StatCard label="Total Ad Matches" value={overview.matches} icon="🎯" color="green" />
              <StatCard label="Total Spent" value={`$${overview.revenue.toFixed(2)}`} icon="💰" color="amber" />
            </div>
          )}

          {/* Row 1: Line charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            <ChartCard title="Ad Spend Trend" subtitle="Daily spend over selected period">
              {spendTrend.length > 0 ? (
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={spendTrend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={v => v.slice(5)} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `$${v}`} />
                    <Tooltip content={<CustomTooltip prefix="$" />} />
                    <Line type="monotone" dataKey="total_spent" name="Spent" stroke="#2563eb" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-52 flex items-center justify-center text-slate-400 text-sm">No spend data for this period</div>
              )}
            </ChartCard>

            <ChartCard title="New Buyers Trend" subtitle="Daily buyer registrations">
              {buyerTrend.length > 0 ? (
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={buyerTrend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={v => v.slice(5)} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip content={<CustomTooltip />} />
                    <Line type="monotone" dataKey="new_buyers" name="New Buyers" stroke="#10b981" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-52 flex items-center justify-center text-slate-400 text-sm">No buyer data for this period</div>
              )}
            </ChartCard>
          </div>

          {/* Row 2: Bar charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            <ChartCard title="Top Sellers by Spend" subtitle="Top 10 sellers ranked by ad spend">
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={topSellers} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={v => `$${v}`} />
                  <YAxis type="category" dataKey="seller_name" tick={{ fontSize: 10 }} width={100} />
                  <Tooltip content={<CustomTooltip prefix="$" />} />
                  <Bar dataKey="total_spent" name="Spent" fill="#2563eb" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Top Ads by Spend" subtitle="Top 10 ads ranked by spend">
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={topAds} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={v => `$${v}`} />
                  <YAxis type="category" dataKey="headline" tick={{ fontSize: 10 }} width={120} />
                  <Tooltip content={<CustomTooltip prefix="$" />} />
                  <Bar dataKey="spent" name="Spent" fill="#f59e0b" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          {/* Row 3: Category bar + Donut charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            <ChartCard title="Ads by Category" subtitle="Number of ads per product category">
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={byCategory}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="category" tick={{ fontSize: 9 }} angle={-30} textAnchor="end" height={60} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="ad_count" name="Ads" fill="#8b5cf6" radius={[4, 4, 0, 0]}>
                    {byCategory.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <div className="grid grid-cols-1 gap-6">
              <ChartCard title="Ads by Format" subtitle="Distribution of ad formats">
                <ResponsiveContainer width="100%" height={120}>
                  <PieChart>
                    <Pie data={byFormat} dataKey="count" nameKey="format" cx="50%" cy="50%" outerRadius={50} innerRadius={25}>
                      {byFormat.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Tooltip />
                    <Legend iconType="circle" iconSize={8} />
                  </PieChart>
                </ResponsiveContainer>
              </ChartCard>

              <ChartCard title="Buyers by Platform" subtitle="Device/platform distribution">
                <ResponsiveContainer width="100%" height={120}>
                  <PieChart>
                    <Pie data={byPlatform} dataKey="count" nameKey="platform" cx="50%" cy="50%" outerRadius={50} innerRadius={25}>
                      {byPlatform.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Tooltip />
                    <Legend iconType="circle" iconSize={8} />
                  </PieChart>
                </ResponsiveContainer>
              </ChartCard>
            </div>
          </div>

          {/* Row 4: Sellers by plan */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <ChartCard title="Sellers by Plan" subtitle="Distribution of seller subscription plans">
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={byPlan} dataKey="count" nameKey="plan" cx="50%" cy="50%" outerRadius={80} innerRadius={40}
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                    {byPlan.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Top Sellers — Detail" subtitle="Seller performance breakdown">
              <div className="overflow-auto max-h-52">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100">
                      <th className="text-left py-2 text-xs text-slate-400 font-semibold">Seller</th>
                      <th className="text-right py-2 text-xs text-slate-400 font-semibold">Ads</th>
                      <th className="text-right py-2 text-xs text-slate-400 font-semibold">Spent</th>
                      <th className="text-right py-2 text-xs text-slate-400 font-semibold">Budget</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topSellers.slice(0, 8).map((s, i) => (
                      <tr key={i} className="border-b border-slate-50 hover:bg-slate-50">
                        <td className="py-2">
                          <div className="font-medium text-slate-700 text-xs">{s.seller_name}</div>
                          <div className="text-xs text-slate-400">{s.industry}</div>
                        </td>
                        <td className="py-2 text-right text-xs">{s.ad_count}</td>
                        <td className="py-2 text-right text-xs font-mono text-amber-600">${parseFloat(s.total_spent).toFixed(2)}</td>
                        <td className="py-2 text-right text-xs font-mono text-green-600">${parseFloat(s.total_budget).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </ChartCard>
          </div>
        </>
      )}
    </div>
  );
}
