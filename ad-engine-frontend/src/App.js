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
import Billing from './pages/Billing';
import FraudLogs from './pages/FraudLogs';
import CreativeStudio from './pages/CreativeStudio';

// Navigation items with role-based access
// Sellers see: Dashboard, Products, Ads, Creative Studio, Analytics, Billing
// Admins see all pages
const ALL_NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: '⚡', roles: ['admin', 'seller'] },
  { id: 'products', label: 'Products', icon: '📦', roles: ['admin', 'seller'] },
  { id: 'ads', label: 'Ads', icon: '📢', roles: ['admin', 'seller'] },
  { id: 'creative', label: 'Creative Studio', icon: '🎬', roles: ['admin', 'seller'] },
  { id: 'analytics', label: 'Analytics', icon: '📊', roles: ['admin', 'seller'] },
  { id: 'billing', label: 'Billing', icon: '💳', roles: ['seller'] },
  { id: 'pending', label: 'Pending Approval', icon: '⏳', roles: ['admin'], badge: true },
  { id: 'sellers', label: 'Sellers', icon: '🏪', roles: ['admin'] },
  { id: 'buyers', label: 'Buyers', icon: '👥', roles: ['admin'] },
  { id: 'events', label: 'Ad Event Log', icon: '📋', roles: ['admin'] },
  { id: 'geo', label: 'Geo Verification', icon: '📍', roles: ['admin'] },
  { id: 'fraud', label: 'Fraud Logs', icon: '🛡️', roles: ['admin'] },
];

// Pages that are admin-only (for route protection)
const ADMIN_ONLY_PAGES = ['pending', 'sellers', 'buyers', 'events', 'geo', 'fraud'];

const PAGES = {
  dashboard: Dashboard, analytics: Analytics, billing: Billing,
  pending: PendingApproval, sellers: Sellers, products: Products,
  ads: Ads, buyers: Buyers, events: AdEventLog, geo: GeoVerification,
  fraud: FraudLogs, creative: CreativeStudio,
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

  // Determine if user is admin early for effects
  const userIsAdmin = user?.role === 'admin';

  // Reset page to appropriate default when user changes (login/logout/switch accounts)
  // Admin default: 'pending' (Pending Approval page)
  // Seller default: 'dashboard'
  useEffect(() => {
    if (user) {
      const defaultPage = user.role === 'admin' ? 'pending' : 'dashboard';
      console.log('[App.js] Setting default page for role:', user.role, '→', defaultPage);
      setPage(defaultPage);
    }
  }, [user?.id]); // Only run when user ID changes

  // Fetch pending count for admin users only
  useEffect(() => {
    if (userIsAdmin) {
      api.getPendingSellersCount()
        .then(data => setPendingCount(data.count || 0))
        .catch(() => setPendingCount(0));
    }
  }, [userIsAdmin, page]); // Refresh when page changes (in case they just approved someone)

  // Check if this is a public page (buyer-facing routes require NO login)
  const pathname = window.location.pathname;
  const isBuyerRoute = pathname === '/' || pathname === '/search' || pathname === '/browse';
  const isVerifyEmailPage = pathname === '/verify-email';
  const isRegisterPage = pathname === '/register';
  const isLoginPage = pathname === '/login';

  // Public buyer routes - show BuyerLanding without auth
  if (isBuyerRoute && !user) return <BuyerLanding />;
  if (isVerifyEmailPage) return <VerifyEmail />;

  if (loading) return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center">
      <div className="w-8 h-8 border-4 border-blue-400 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  // Only show login for /login, /register, or seller routes when not authenticated
  if (!user) {
    // If on /register route, show Login with register tab
    if (isRegisterPage || isLoginPage) return <Login defaultTab={isRegisterPage ? 'register' : 'login'} />;
    // For any other route requiring auth, show login
    return <Login />;
  }

  // Check seller approval status - redirect non-approved sellers to waiting page
  // Admins always have access regardless of approval_status
  if (!userIsAdmin && user.approval_status && user.approval_status !== 'approved') {
    return <PendingApprovalWaiting />;
  }

  // Buyer preview mode - shows actual BuyerLanding page
  if (buyerMode) return (
    <div style={{ minHeight: '100vh', overflowY: 'auto' }}>
      <div style={{ background: '#1e293b', padding: '10px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button onClick={() => setBuyerMode(false)}
            style={{ color: 'white', fontSize: '14px', background: '#3b82f6', border: 'none', cursor: 'pointer', padding: '6px 12px', borderRadius: '6px', fontWeight: '500' }}>
            ← Back to Dashboard
          </button>
          <span style={{ color: '#94a3b8' }}>|</span>
          <span style={{ fontSize: '14px', fontWeight: '500', color: '#f1f5f9' }}>👁️ Admin Preview Mode</span>
        </div>
        <div style={{ fontSize: '12px', color: '#94a3b8' }}>Viewing as a buyer would see it</div>
      </div>
      <BuyerLanding />
    </div>
  );

  // Debug: log user role to console
  console.log('[App.js] User role:', user.role, '| Page:', page, '| User:', user);

  // Determine if user is admin - explicit check
  const isAdmin = user.role === 'admin';

  // Route protection: if non-admin tries to access admin-only page, redirect to dashboard
  const effectivePage = (!isAdmin && ADMIN_ONLY_PAGES.includes(page)) ? 'dashboard' : page;
  const Page = PAGES[effectivePage];
  const showEmailBanner = user.email_verified === false && !isAdmin;

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
          {/* Filter nav items by role - sellers only see seller items, admins see all */}
          {ALL_NAV.filter(item => item.roles.includes(isAdmin ? 'admin' : 'seller')).map(item => (
            <button key={item.id} onClick={() => setPage(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${effectivePage === item.id ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'}`}>
              <span>{item.icon}</span>
              <span className="flex-1 text-left">{item.label}</span>
              {item.badge && pendingCount > 0 && (
                <span className={`text-xs px-1.5 py-0.5 rounded-full min-w-[20px] text-center ${effectivePage === item.id ? 'bg-white/20 text-white' : 'bg-pink-500 text-white'}`}>
                  {pendingCount}
                </span>
              )}
            </button>
          ))}
          {/* Preview as Buyer - shows BuyerLanding page */}
          {isAdmin && (
            <div className="pt-2 mt-2 border-t border-slate-100">
              <button onClick={() => setBuyerMode(true)}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-pink-600 hover:bg-pink-50 transition-all">
                <span>👁️</span><span>Preview as Buyer</span>
              </button>
            </div>
          )}
        </nav>
        <div className="px-4 py-4 border-t border-slate-100">
          <div className="flex items-center gap-2 mb-3">
            {user.avatar_url
              ? <img src={user.avatar_url} alt="" className="w-7 h-7 rounded-full" />
              : <div className="w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center text-white text-xs font-bold">
                {(user.email || 'S')[0].toUpperCase()}
              </div>
            }
            <div className="overflow-hidden flex-1">
              <div className="flex items-center gap-2">
                <div className="text-xs font-medium text-slate-700 truncate">
                  {user.seller_name || (isAdmin ? 'Admin' : 'Seller')}
                </div>
                <span className={`text-[10px] px-1.5 py-0.5 rounded ${isAdmin ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                  {isAdmin ? 'Admin' : 'Seller'}
                </span>
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
