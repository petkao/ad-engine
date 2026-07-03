import { useAuth } from '../auth/AuthContext';

export default function PendingApprovalWaiting() {
  const { user, logout } = useAuth();
  const status = user?.approval_status || 'pending_review';

  const statusConfig = {
    pending_review: {
      icon: '\u23F3',
      title: 'Your account is under review',
      message: `Our team will review your application and notify you at ${user?.email || 'your email'} within 24 hours.`,
      color: 'amber',
    },
    rejected: {
      icon: '\u274C',
      title: 'Account application not approved',
      message: 'Unfortunately, your seller account application was not approved. If you believe this was in error, please contact our support team.',
      color: 'red',
    },
    suspended: {
      icon: '\u26D4',
      title: 'Account suspended',
      message: 'Your seller account has been suspended. You cannot create products or ads while suspended. Please contact support for more information.',
      color: 'slate',
    },
  };

  const config = statusConfig[status] || statusConfig.pending_review;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        <div className="bg-white rounded-2xl shadow-xl p-8 text-center">
          <div className="mb-6">
            <div className="text-6xl mb-4">{config.icon}</div>
            <h1 className="text-2xl font-bold text-slate-800 mb-2">
              {config.title}
            </h1>
          </div>

          <div className={`bg-${config.color}-50 border border-${config.color}-200 rounded-xl p-4 mb-6`}>
            <p className="text-slate-600 leading-relaxed">
              {config.message}
            </p>
          </div>

          {status === 'pending_review' && (
            <div className="space-y-3 text-sm text-slate-500 mb-6">
              <p>While you wait, here's what happens next:</p>
              <ul className="text-left space-y-2 ml-4">
                <li className="flex items-start gap-2">
                  <span className="text-green-500 mt-0.5">1.</span>
                  <span>Our team reviews your business information</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-green-500 mt-0.5">2.</span>
                  <span>We verify your location and credentials</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-green-500 mt-0.5">3.</span>
                  <span>You'll receive an email once approved</span>
                </li>
              </ul>
            </div>
          )}

          <div className="border-t border-slate-100 pt-6">
            <div className="flex items-center justify-center gap-2 mb-4">
              <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-sm font-bold text-slate-600">
                {(user?.email || 'S')[0].toUpperCase()}
              </div>
              <div className="text-left">
                <div className="text-sm font-medium text-slate-700">
                  {user?.seller_name || 'Seller'}
                </div>
                <div className="text-xs text-slate-400">{user?.email}</div>
              </div>
            </div>
            <button
              onClick={logout}
              className="w-full py-2 px-4 text-sm text-slate-500 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
            >
              Sign out
            </button>
          </div>
        </div>

        <div className="mt-6 text-center">
          <p className="text-sm text-slate-400">
            Need help?{' '}
            <a href="mailto:support@pinkcurve.com" className="text-pink-500 hover:underline">
              Contact support
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
