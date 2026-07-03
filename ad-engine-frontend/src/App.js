import { useState } from 'react';
import { AuthProvider, useAuth } from './auth/AuthContext';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Sellers from './pages/Sellers';
import Products from './pages/Products';
import Ads from './pages/Ads';
import Buyers from './pages/Buyers';
import Analytics from './pages/Analytics';
import GeoVerification from './pages/GeoVerification';
import BuyerSearch from './pages/BuyerSearch';
import BuyerLanding from './pages/BuyerLanding';

const ALL_NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: '⚡', roles: ['admin', 'seller'] },
  { id: 'analytics', label: 'Analytics', icon: '📊', roles: ['admin', 'seller'] },
  { id: 'sellers', label: 'Sellers', icon: '🏪', roles: ['admin', 'seller'] },
  { id: 'products', label: 'Products', icon: '📦', roles: ['admin', 'seller'] },
  { id: 'ads', label: 'Ads', icon: '📢', roles: ['admin', 'seller'] },
  { id: 'buyers', label: 'Buyers', icon: '👥', roles: ['admin'] },
  { id: 'geo', label: 'Geo Verification', icon: '📍', roles: ['admin'] },
];

const PAGES = {
  dashboard: Dashboard, analytics: Analytics,
  sellers: Sellers, products: Products,
  ads: Ads, buyers: Buyers, geo: GeoVerification,
};

function AppShell() {
  const { user, loading, logout } = useAuth();
  const [page, setPage] = useState('dashboard');
  const [buyerMode, setBuyerMode] = useState(false);

  // Check if this is the public buyer search URL
  const isSearchPage = window.location.pathname === '/search';

  if (isSearchPage) return <BuyerLanding />;

  if (loading) return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center">
      <div className="w-8 h-8 border-4 border-blue-400 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (!user) return <Login />;

  // Buyer search full-screen mode
  if (buyerMode) return (
    <div style={{ minHeight: '100vh', overflowY: 'auto' }}>
      <div style={{ background: 'white', borderBottom: '1px solid #f1f5f9', padding: '12px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button onClick={() => setBuyerMode(false)}
            style={{ color: '#64748b', fontSize: '14px', background: 'none', border: 'none', cursor: 'pointer' }}>
            ← Back to dashboard
          </button>
          <span style={{ color: '#cbd5e1' }}>|</span>
          <span style={{ fontSize: '14px', fontWeight: '500', background: 'linear-gradient(135deg, #ec4899, #a855f7)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>PinkCurve — Buyer Search</span>
        </div>
        <div style={{ fontSize: '12px', color: '#94a3b8' }}>🔒 Privacy-first demo</div>
      </div>
      <BuyerSearch />
    </div>
  );

  const Page = PAGES[page];

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      <aside className="w-56 bg-white border-r border-slate-100 flex flex-col shrink-0">
        <div className="px-5 py-6 border-b border-slate-100">
          <div className="text-lg font-bold" style={{ fontFamily: '"DM Serif Display", serif', background: 'linear-gradient(135deg, #ec4899, #a855f7)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>PinkCurve</div>
          <div className="text-xs text-slate-400 mt-0.5">Peter Kao Associates</div>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1">
          {ALL_NAV.filter(item => item.roles.includes(user.role || 'seller')).map(item => (
            <button key={item.id} onClick={() => setPage(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${page === item.id ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'}`}>
              <span>{item.icon}</span><span>{item.label}</span>
            </button>
          ))}
          <div className="pt-2 mt-2 border-t border-slate-100">
            <button onClick={() => setBuyerMode(true)}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-green-600 hover:bg-green-50 transition-all">
              <span>🛍️</span><span>Buyer Search</span>
            </button>
          </div>
        </nav>
        <div className="px-4 py-4 border-t border-slate-100">
          <div className="flex items-center gap-2 mb-3">
            {user.avatar_url
              ? <img src={user.avatar_url} alt="" className="w-7 h-7 rounded-full" />
              : <div className="w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center text-white text-xs font-bold">
                {(user.email || 'S')[0].toUpperCase()}
              </div>
            }
            <div className="overflow-hidden">
              <div className="text-xs font-medium text-slate-700 truncate">
                {user.seller_name || (user.role === 'admin' ? 'Admin' : 'Seller')}
              </div>
              <div className="text-xs text-slate-400 truncate">{user.email}</div>
            </div>
          </div>
          <button onClick={logout}
            className="w-full text-xs text-slate-500 hover:text-red-500 hover:bg-red-50 py-1.5 px-2 rounded-lg transition-all text-left">
            🚪 Sign out
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto px-8 py-8"><Page /></div>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppShell />
    </AuthProvider>
  );
}
