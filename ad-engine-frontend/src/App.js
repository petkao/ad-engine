import { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { api } from './api/client';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Sellers from './pages/Sellers';
import Products from './pages/Products';
import Ads from './pages/Ads';
import Buyers from './pages/Buyers';
import Analytics from './pages/Analytics';
import GeoVerification from './pages/GeoVerification';
import AdEventLog from './pages/AdEventLog';
import BuyerSearch from './pages/BuyerSearch';
import BuyerLanding from './pages/BuyerLanding';
import VerifyEmail from './pages/VerifyEmail';
import PendingApproval from './pages/PendingApproval';
import PendingApprovalWaiting from './pages/PendingApprovalWaiting';

const ALL_NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: '⚡', roles: ['admin', 'seller'] },
  { id: 'analytics', label: 'Analytics', icon: '📊', roles: ['admin', 'seller'] },
  { id: 'pending', label: 'Pending Approval', icon: '⏳', roles: ['admin'], badge: true },
  { id: 'sellers', label: 'Sellers', icon: '🏪', roles: ['admin', 'seller'] },
  { id: 'products', label: 'Products', icon: '📦', roles: ['admin', 'seller'] },
  { id: 'ads', label: 'Ads', icon: '📢', roles: ['admin', 'seller'] },
  { id: 'buyers', label: 'Buyers', icon: '👥', roles: ['admin'] },
  { id: 'events', label: 'Ad Event Log', icon: '📋', roles: ['admin'] },
  { id: 'geo', label: 'Geo Verification', icon: '📍', roles: ['admin'] },
];

const PAGES = {
  dashboard: Dashboard, analytics: Analytics,
  pending: PendingApproval, sellers: Sellers, products: Products,
  ads: Ads, buyers: Buyers, events: AdEventLog, geo: GeoVerification,
};

function EmailVerificationBanner({ onResend }) {
  const [resending, setResending] = useState(false);
  const [message, setMessage] = useState('');

  const handleResend = async () => {
    setResending(true);
    setMessage('');
    try {
      const result = await api.resendVerification();
      setMessage(result.message || 'Verification email sent!');
    } catch (err) {
      setMessage(err.message || 'Failed to send. Try again later.');
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="bg-amber-50 border-b border-amber-200 px-4 py-3">
      <div className="flex items-center justify-between max-w-6xl mx-auto">
        <div className="flex items-center gap-2">
          <span className="text-amber-600 text-lg">&#x26A0;&#xFE0F;</span>
          <span className="text-amber-800 text-sm font-medium">
            Please verify your email address to fully activate your account.
          </span>
        </div>
        <div className="flex items-center gap-3">
          {message && (
            <span className={`text-xs ${message.includes('sent') ? 'text-green-600' : 'text-red-600'}`}>
              {message}
            </span>
          )}
          <button
            onClick={handleResend}
            disabled={resending}
            className="text-sm font-medium text-amber-700 hover:text-amber-900 underline disabled:opacity-50"
          >
            {resending ? 'Sending...' : 'Resend verification email'}
          </button>
        </div>
      </div>
    </div>
  );
}

function AppShell() {
  const { user, loading, logout } = useAuth();
  const [page, setPage] = useState('dashboard');
  const [buyerMode, setBuyerMode] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);

  // Fetch pending count for admin users
  useEffect(() => {
    if (user?.role === 'admin') {
      api.getPendingSellersCount()
        .then(data => setPendingCount(data.count || 0))
        .catch(() => setPendingCount(0));
    }
  }, [user, page]); // Refresh when page changes (in case they just approved someone)

  // Check if this is a public page
  const isSearchPage = window.location.pathname === '/search';
  const isVerifyEmailPage = window.location.pathname === '/verify-email';

  if (isSearchPage) return <BuyerLanding />;
  if (isVerifyEmailPage) return <VerifyEmail />;

  if (loading) return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center">
      <div className="w-8 h-8 border-4 border-blue-400 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (!user) return <Login />;

  // Check seller approval status - redirect non-approved sellers to waiting page
  // Admins always have access regardless of approval_status
  if (user.role !== 'admin' && user.approval_status && user.approval_status !== 'approved') {
    return <PendingApprovalWaiting />;
  }

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
  const showEmailBanner = user.email_verified === false && user.role !== 'admin';

  return (
    <div className="flex flex-col h-screen bg-slate-50 overflow-hidden">
      {showEmailBanner && <EmailVerificationBanner />}
      <div className="flex flex-1 overflow-hidden">
      <aside className="w-56 bg-white border-r border-slate-100 flex flex-col shrink-0">
        <div className="px-5 py-6 border-b border-slate-100">
          <div className="text-lg font-bold" style={{ fontFamily: '"DM Serif Display", serif', background: 'linear-gradient(135deg, #ec4899, #a855f7)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>PinkCurve</div>
          <div className="text-xs text-slate-400 mt-0.5">Peter Kao Associates</div>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1">
          {ALL_NAV.filter(item => item.roles.includes(user.role || 'seller')).map(item => (
            <button key={item.id} onClick={() => setPage(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${page === item.id ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'}`}>
              <span>{item.icon}</span>
              <span className="flex-1 text-left">{item.label}</span>
              {item.badge && pendingCount > 0 && (
                <span className={`text-xs px-1.5 py-0.5 rounded-full min-w-[20px] text-center ${page === item.id ? 'bg-white/20 text-white' : 'bg-pink-500 text-white'}`}>
                  {pendingCount}
                </span>
              )}
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
