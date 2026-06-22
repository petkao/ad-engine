import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { StatCard, Spinner } from '../components/UI';

const BASE = process.env.REACT_APP_API_URL || 'http://localhost:3001';

function getHeaders() {
  const token = localStorage.getItem('auth_token');
  return {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
  };
}

// ── Admin Dashboard ───────────────────────────────────────────
function AdminDashboard() {
  const [stats, setStats] = useState(null);
  const [pending, setPending] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch(`${BASE}/api/stats`, { headers: getHeaders() }).then(r => r.json()),
      fetch(`${BASE}/api/admin/pending-ads`, { headers: getHeaders() }).then(r => r.json()),
    ]).then(([s, p]) => {
      setStats(s);
      setPending(Array.isArray(p) ? p.length : 0);
    }).finally(() => setLoading(false));
  }, []);

  if (loading) return <Spinner />;

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-800">Admin Dashboard</h1>
        <p className="text-slate-500 mt-1">Platform overview — Peter Kao Associates PinkCurve</p>
      </div>

      {/* Platform stats */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        <StatCard label="Total Sellers"   value={stats?.sellers  || 0} icon="🏪" color="blue" />
        <StatCard label="Total Products"  value={stats?.products || 0} icon="📦" color="amber" />
        <StatCard label="Active Ads"      value={stats?.ads      || 0} icon="📢" color="green" />
        <StatCard label="Registered Buyers" value={stats?.buyers || 0} icon="👥" color="purple" />
        <StatCard label="Total Matches"   value={stats?.matches  || 0} icon="🎯" color="green" />
        <StatCard label="Pending Review"  value={pending}              icon="⏳" color="amber" />
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <div className="bg-white rounded-2xl border border-slate-100 p-6">
          <h2 className="font-semibold text-slate-800 mb-4">⚡ Quick Actions</h2>
          <div className="space-y-3">
            {pending > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-center justify-between">
                <div>
                  <div className="font-semibold text-amber-800">⏳ {pending} ads pending review</div>
                  <div className="text-xs text-amber-600 mt-0.5">Click Ads → Review Queue to approve</div>
                </div>
                <span className="text-2xl">📋</span>
              </div>
            )}
            <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 flex items-center justify-between">
              <div>
                <div className="font-semibold text-blue-800">📊 View Analytics</div>
                <div className="text-xs text-blue-600 mt-0.5">Charts, spend trends, buyer activity</div>
              </div>
              <span className="text-2xl">📈</span>
            </div>
            <div className="bg-green-50 border border-green-100 rounded-xl p-4 flex items-center justify-between">
              <div>
                <div className="font-semibold text-green-800">🛍️ Test Buyer Search</div>
                <div className="text-xs text-green-600 mt-0.5">See what buyers experience</div>
              </div>
              <span className="text-2xl">🔍</span>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-100 p-6">
          <h2 className="font-semibold text-slate-800 mb-4">🌐 Platform Architecture</h2>
          <div className="space-y-3 text-sm text-slate-600">
            <div className="flex items-start gap-3">
              <span className="text-lg">🔒</span>
              <div><strong>Privacy-first</strong> — buyer browsing data never leaves their device. Only anonymized intent signals are sent.</div>
            </div>
            <div className="flex items-start gap-3">
              <span className="text-lg">🧠</span>
              <div><strong>AI-powered matching</strong> — pgvector semantic search + GPT intent extraction matches buyers to the most relevant ads.</div>
            </div>
            <div className="flex items-start gap-3">
              <span className="text-lg">💰</span>
              <div><strong>Pay per match</strong> — sellers only pay when their ad is matched to a relevant buyer. No wasted impressions.</div>
            </div>
            <div className="flex items-start gap-3">
              <span className="text-lg">🔗</span>
              <div><strong>Direct linking</strong> — ads can link directly to seller product pages, driving qualified traffic.</div>
            </div>
          </div>
        </div>
      </div>

      {/* Live URLs */}
      <div className="bg-slate-800 rounded-2xl p-6 text-white">
        <h2 className="font-semibold mb-4">🚀 Live Production URLs</h2>
        <div className="space-y-2 font-mono text-sm">
          <div className="flex items-center gap-3">
            <span className="text-green-400">●</span>
            <span className="text-slate-400">Frontend:</span>
            <a href="https://pinkcurve-4da45.web.app" target="_blank" rel="noreferrer" className="text-blue-400 hover:underline">https://pinkcurve-4da45.web.app</a>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-green-400">●</span>
            <span className="text-slate-400">API:</span>
            <span className="text-slate-300">https://pinkcurve-api-610270819686.us-west1.run.app</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Seller Dashboard ──────────────────────────────────────────
function SellerDashboard({ user }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch(`${BASE}/api/products`, { headers: getHeaders() }).then(r => r.json()),
      fetch(`${BASE}/api/ads`, { headers: getHeaders() }).then(r => r.json()),
    ]).then(([products, ads]) => {
      const activeAds = Array.isArray(ads) ? ads.filter(a => a.status === 'active') : [];
      const totalSpent = Array.isArray(ads) ? ads.reduce((sum, a) => sum + parseFloat(a.spent || 0), 0) : 0;
      setStats({
        products: Array.isArray(products) ? products.length : 0,
        ads: Array.isArray(ads) ? ads.length : 0,
        activeAds: activeAds.length,
        spent: totalSpent,
      });
    }).finally(() => setLoading(false));
  }, []);

  const isNew = stats?.products === 0 && stats?.ads === 0;

  if (loading) return <Spinner />;

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-800">Welcome, {user?.seller_name || 'Seller'}! 👋</h1>
        <p className="text-slate-500 mt-1">Manage your ads and track performance</p>
      </div>

      {/* Seller stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard label="Your Products" value={stats?.products || 0} icon="📦" color="blue" />
        <StatCard label="Your Ads"      value={stats?.ads      || 0} icon="📢" color="green" />
        <StatCard label="Active Ads"    value={stats?.activeAds|| 0} icon="✅" color="green" />
        <StatCard label="Total Spent"   value={`$${(stats?.spent || 0).toFixed(2)}`} icon="💰" color="amber" />
      </div>

      {/* Getting started guide for new sellers */}
      {isNew && (
        <div className="bg-gradient-to-br from-blue-600 to-indigo-700 rounded-2xl p-6 text-white mb-8">
          <h2 className="text-xl font-bold mb-2">🚀 Get Started in 3 Steps</h2>
          <p className="text-blue-100 text-sm mb-6">Start advertising your products to AI-matched buyers</p>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="bg-white/10 rounded-xl p-4">
              <div className="text-2xl mb-2">1️⃣</div>
              <div className="font-semibold mb-1">Create a Product</div>
              <div className="text-blue-100 text-sm">Add your product with title, description, price and category.</div>
              <div className="mt-3 text-xs bg-white/20 rounded-lg px-3 py-1.5 inline-block">Click 📦 Products → + Add Product</div>
            </div>
            <div className="bg-white/10 rounded-xl p-4">
              <div className="text-2xl mb-2">2️⃣</div>
              <div className="font-semibold mb-1">Create an Ad</div>
              <div className="text-blue-100 text-sm">Write a compelling headline and body copy. Add intent tags for better matching.</div>
              <div className="mt-3 text-xs bg-white/20 rounded-lg px-3 py-1.5 inline-block">Click 📢 Ads → + Create Ad</div>
            </div>
            <div className="bg-white/10 rounded-xl p-4">
              <div className="text-2xl mb-2">3️⃣</div>
              <div className="font-semibold mb-1">Add an Image</div>
              <div className="text-blue-100 text-sm">Upload your own image or generate one with DALL-E AI.</div>
              <div className="mt-3 text-xs bg-white/20 rounded-lg px-3 py-1.5 inline-block">Click 📤 or ✨ on your ad</div>
            </div>
          </div>
        </div>
      )}

      {/* How it works for sellers */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <div className="bg-white rounded-2xl border border-slate-100 p-6">
          <h2 className="font-semibold text-slate-800 mb-4">💡 How PinkCurve Works</h2>
          <div className="space-y-4 text-sm text-slate-600">
            <div className="flex items-start gap-3">
              <span className="text-lg shrink-0">🔒</span>
              <div><strong className="text-slate-800">Privacy-first matching</strong> — buyers' browsing context is analyzed on their device. Only anonymized intent signals reach our server.</div>
            </div>
            <div className="flex items-start gap-3">
              <span className="text-lg shrink-0">🧠</span>
              <div><strong className="text-slate-800">AI intent matching</strong> — our AI reads what buyers are interested in and matches your ads to the most relevant buyers automatically.</div>
            </div>
            <div className="flex items-start gap-3">
              <span className="text-lg shrink-0">💰</span>
              <div><strong className="text-slate-800">Pay per match</strong> — you only pay when your ad is shown to a relevant buyer. Set your cost-per-match and daily budget.</div>
            </div>
            <div className="flex items-start gap-3">
              <span className="text-lg shrink-0">🔗</span>
              <div><strong className="text-slate-800">Direct to your site</strong> — buyers click your ad and go directly to your product page. More qualified traffic, higher conversion.</div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-100 p-6">
          <h2 className="font-semibold text-slate-800 mb-4">💡 Tips for Better Matching</h2>
          <div className="space-y-3 text-sm text-slate-600">
            <div className="flex items-start gap-3">
              <span className="bg-blue-100 text-blue-700 text-xs font-bold px-2 py-0.5 rounded shrink-0">TIP</span>
              <div>Add detailed <strong>intent tags</strong> — keywords that describe what buyers searching for your product would type.</div>
            </div>
            <div className="flex items-start gap-3">
              <span className="bg-green-100 text-green-700 text-xs font-bold px-2 py-0.5 rounded shrink-0">TIP</span>
              <div>Write a compelling <strong>headline</strong> — it's the first thing buyers see. Make it clear and benefit-focused.</div>
            </div>
            <div className="flex items-start gap-3">
              <span className="bg-purple-100 text-purple-700 text-xs font-bold px-2 py-0.5 rounded shrink-0">TIP</span>
              <div>Use a <strong>high quality image</strong> — ads with images get 3x more clicks than text-only ads.</div>
            </div>
            <div className="flex items-start gap-3">
              <span className="bg-amber-100 text-amber-700 text-xs font-bold px-2 py-0.5 rounded shrink-0">TIP</span>
              <div>Set a <strong>competitive cost-per-match</strong> — higher bids get featured placement on the buyer search page.</div>
            </div>
          </div>
        </div>
      </div>

      {/* Quick actions */}
      {!isNew && (
        <div className="bg-white rounded-2xl border border-slate-100 p-6">
          <h2 className="font-semibold text-slate-800 mb-4">⚡ Quick Actions</h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="border border-slate-200 rounded-xl p-4 text-center hover:border-blue-300 hover:bg-blue-50 transition-all cursor-pointer">
              <div className="text-2xl mb-1">📦</div>
              <div className="text-xs font-medium text-slate-700">Add Product</div>
            </div>
            <div className="border border-slate-200 rounded-xl p-4 text-center hover:border-blue-300 hover:bg-blue-50 transition-all cursor-pointer">
              <div className="text-2xl mb-1">📢</div>
              <div className="text-xs font-medium text-slate-700">Create Ad</div>
            </div>
            <div className="border border-slate-200 rounded-xl p-4 text-center hover:border-blue-300 hover:bg-blue-50 transition-all cursor-pointer">
              <div className="text-2xl mb-1">📊</div>
              <div className="text-xs font-medium text-slate-700">View Analytics</div>
            </div>
            <div className="border border-slate-200 rounded-xl p-4 text-center hover:border-blue-300 hover:bg-blue-50 transition-all cursor-pointer">
              <div className="text-2xl mb-1">🛍️</div>
              <div className="text-xs font-medium text-slate-700">Buyer Search</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Buyer Info Section (shown in Buyer Search) ────────────────
export function BuyerInfo() {
  return (
    <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-2xl p-6 text-white mb-6">
      <h2 className="text-lg font-bold mb-2">🛍️ How Buyer Search Works</h2>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-4 text-sm">
        <div className="bg-white/10 rounded-xl p-4">
          <div className="text-2xl mb-2">🔒</div>
          <div className="font-semibold mb-1">Privacy First</div>
          <div className="text-slate-300">Your browsing context is analyzed locally. No personal data is ever sent to our servers.</div>
        </div>
        <div className="bg-white/10 rounded-xl p-4">
          <div className="text-2xl mb-2">🧠</div>
          <div className="font-semibold mb-1">AI Matching</div>
          <div className="text-slate-300">Our AI understands your intent and matches you with the most relevant products automatically.</div>
        </div>
        <div className="bg-white/10 rounded-xl p-4">
          <div className="text-2xl mb-2">🔗</div>
          <div className="font-semibold mb-1">Direct to Seller</div>
          <div className="text-slate-300">Click any ad to go directly to the seller's product page. No middleman, no tracking.</div>
        </div>
      </div>
    </div>
  );
}

// ── Main Dashboard ────────────────────────────────────────────
export default function Dashboard() {
  const { user } = useAuth();
  
  if (user?.role === 'admin') return <AdminDashboard />;
  return <SellerDashboard user={user} />;
}
