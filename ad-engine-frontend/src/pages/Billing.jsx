import { useEffect, useState } from 'react';
import { Spinner } from '../components/UI';

const BASE = process.env.REACT_APP_API_URL || 'http://localhost:3001';

function getHeaders() {
  const token = localStorage.getItem('auth_token');
  return {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
  };
}

// Plan display configurations
const PLAN_DISPLAY = {
  free: {
    name: 'Free',
    price: 0,
    color: 'slate',
    badge: 'bg-slate-100 text-slate-700',
    tagline: 'Perfect for trying PinkCurve',
    features: ['1 Seller Story', '10 Intent Matches/month', 'Basic analytics', 'Email support'],
  },
  starter: {
    name: 'Starter',
    price: 29,
    color: 'blue',
    badge: 'bg-blue-100 text-blue-700',
    tagline: 'For growing sellers',
    features: ['5 Seller Stories', '100 Intent Matches/month', 'Full analytics', 'Priority support'],
  },
  pro: {
    name: 'Pro',
    price: 99,
    color: 'purple',
    badge: 'bg-purple-100 text-purple-700',
    popular: true,
    tagline: 'For established businesses',
    features: ['20 Seller Stories', '500 Intent Matches/month', 'Advanced analytics', 'Priority support', 'API access'],
  },
  enterprise: {
    name: 'Enterprise',
    price: 299,
    color: 'pink',
    badge: 'bg-pink-100 text-pink-700',
    tagline: 'For high-volume sellers',
    features: ['Unlimited Stories', 'Unlimited Matches', 'Dedicated support', 'Custom integrations', 'Account manager'],
  },
};

function PlanCard({ planKey, config, currentPlan, onSubscribe, loading }) {
  const isCurrent = currentPlan === planKey;
  const isDowngrade = currentPlan !== 'free' && (
    (currentPlan === 'enterprise' && planKey !== 'enterprise') ||
    (currentPlan === 'pro' && planKey === 'starter')
  );

  return (
    <div className={`relative bg-white rounded-2xl border-2 ${
      isCurrent ? 'border-pink-500 shadow-lg' : 'border-slate-200'
    } p-6 flex flex-col`}>
      {config.popular && !isCurrent && (
        <div className="absolute -top-3 left-1/2 transform -translate-x-1/2">
          <span className="bg-gradient-to-r from-pink-500 to-purple-500 text-white text-xs font-bold px-3 py-1 rounded-full">
            Most Popular
          </span>
        </div>
      )}
      {isCurrent && (
        <div className="absolute -top-3 left-1/2 transform -translate-x-1/2">
          <span className="bg-green-500 text-white text-xs font-bold px-3 py-1 rounded-full">
            Current Plan
          </span>
        </div>
      )}

      <div className="text-center mb-6">
        <h3 className="text-xl font-bold text-slate-800">{config.name}</h3>
        {config.tagline && (
          <p className="text-xs text-slate-500 mt-1">{config.tagline}</p>
        )}
        <div className="mt-2">
          <span className="text-4xl font-bold text-slate-900">${config.price}</span>
          {config.price > 0 ? <span className="text-slate-500">/month</span> : <span className="text-slate-500"> forever</span>}
        </div>
      </div>

      <ul className="space-y-3 flex-1 mb-6">
        {config.features.map((feature, i) => (
          <li key={i} className="flex items-start gap-2 text-sm text-slate-600">
            <span className="text-green-500 mt-0.5">✓</span>
            {feature}
          </li>
        ))}
      </ul>

      {!isCurrent && planKey !== 'free' && !isDowngrade && (
        <button
          onClick={() => onSubscribe(planKey)}
          disabled={loading}
          className={`w-full py-3 rounded-xl font-semibold transition-all ${
            config.popular
              ? 'bg-gradient-to-r from-pink-500 to-purple-500 text-white hover:shadow-lg'
              : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
          } disabled:opacity-50`}
        >
          {loading ? 'Processing...' : currentPlan === 'free' ? 'Subscribe' : 'Upgrade'}
        </button>
      )}
      {isCurrent && (
        <div className="w-full py-3 rounded-xl bg-green-50 text-green-700 font-semibold text-center">
          Active
        </div>
      )}
      {isDowngrade && !isCurrent && (
        <div className="w-full py-3 rounded-xl bg-slate-50 text-slate-400 font-semibold text-center text-sm">
          Contact support to downgrade
        </div>
      )}
    </div>
  );
}

function UsageProgressBar({ used, included, label }) {
  // Treat 999+ stories or 999999+ impressions as unlimited
  const isUnlimited = included >= 999;
  const percentage = isUnlimited ? 0 : Math.min(100, (used / included) * 100);
  const isOverage = !isUnlimited && used > included;

  return (
    <div>
      <div className="flex justify-between items-center mb-2">
        <span className="text-sm font-medium text-slate-700">{label}</span>
        <span className={`text-sm font-semibold ${isOverage ? 'text-red-600' : 'text-slate-600'}`}>
          {used.toLocaleString()} / {isUnlimited ? '∞' : included.toLocaleString()}
        </span>
      </div>
      <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${
            isOverage ? 'bg-red-500' : percentage > 80 ? 'bg-amber-500' : 'bg-gradient-to-r from-pink-500 to-purple-500'
          }`}
          style={{ width: isUnlimited ? '100%' : `${Math.min(100, percentage)}%` }}
        />
      </div>
      {isOverage && (
        <p className="text-xs text-red-600 mt-1">
          {(used - included).toLocaleString()} over limit
        </p>
      )}
    </div>
  );
}

export default function Billing() {
  const [subscription, setSubscription] = useState(null);
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [subscribing, setSubscribing] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      const [subRes, payRes] = await Promise.all([
        fetch(`${BASE}/api/seller/subscription`, { headers: getHeaders() }),
        fetch(`${BASE}/api/seller/payments`, { headers: getHeaders() }),
      ]);

      if (subRes.ok) {
        setSubscription(await subRes.json());
      }
      if (payRes.ok) {
        setPayments(await payRes.json());
      }
    } catch (err) {
      setError('Failed to load billing information');
    } finally {
      setLoading(false);
    }
  }

  async function handleSubscribe(plan) {
    setSubscribing(true);
    setError(null);

    try {
      const res = await fetch(`${BASE}/api/stripe/create-checkout-session`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ plan }),
      });

      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        setError(data.error || 'Failed to create checkout session');
      }
    } catch (err) {
      setError('Failed to start checkout process');
    } finally {
      setSubscribing(false);
    }
  }

  async function handleCancel() {
    if (!window.confirm('Are you sure you want to cancel your subscription? You will retain access until the end of your billing period.')) {
      return;
    }

    try {
      const res = await fetch(`${BASE}/api/seller/subscription/cancel`, {
        method: 'POST',
        headers: getHeaders(),
      });

      const data = await res.json();
      if (data.success) {
        alert(data.message);
        loadData();
      } else {
        setError(data.error || 'Failed to cancel subscription');
      }
    } catch (err) {
      setError('Failed to cancel subscription');
    }
  }

  if (loading) return <Spinner />;

  const currentPlan = subscription?.plan || 'free';
  const planConfig = PLAN_DISPLAY[currentPlan] || PLAN_DISPLAY.free;

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-800">Billing & Subscription</h1>
        <p className="text-slate-500 mt-1">Manage your subscription and view usage</p>
      </div>

      {error && (
        <div className="mb-6 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl">
          {error}
        </div>
      )}

      {/* Check for Stripe success/cancel in URL */}
      {window.location.search.includes('stripe=success') && (
        <div className="mb-6 bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-xl">
          <strong>Success!</strong> Your subscription has been activated. It may take a moment to update.
        </div>
      )}
      {window.location.search.includes('stripe=cancel') && (
        <div className="mb-6 bg-amber-50 border border-amber-200 text-amber-700 px-4 py-3 rounded-xl">
          Checkout was cancelled. Your subscription has not been changed.
        </div>
      )}

      {/* Current Plan Card */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 mb-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-lg font-semibold text-slate-800">Current Plan</h2>
            <div className="flex items-center gap-2 mt-1">
              <span className={`px-3 py-1 rounded-full text-sm font-semibold ${planConfig.badge}`}>
                {planConfig.name}
              </span>
              {subscription?.status === 'active' && (
                <span className="px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">
                  Active
                </span>
              )}
              {subscription?.status === 'cancelled' && (
                <span className="px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700">
                  Cancelled
                </span>
              )}
            </div>
          </div>
          {currentPlan !== 'free' && subscription?.stripe_subscription_id && (
            <button
              onClick={handleCancel}
              className="text-sm text-red-600 hover:text-red-700 font-medium"
            >
              Cancel Subscription
            </button>
          )}
        </div>

        {/* Usage Stats */}
        <div className="grid md:grid-cols-3 gap-6">
          <div className="bg-slate-50 rounded-xl p-4">
            <UsageProgressBar
              used={subscription?.stories_used || 0}
              included={subscription?.stories_included || 1}
              label="Seller Stories"
            />
            {subscription?.stories_remaining === 0 && subscription?.stories_included < 999 && (
              <div className="mt-3 bg-amber-50 border border-amber-200 rounded-lg p-3">
                <p className="text-xs text-amber-700 font-medium">
                  Story limit reached. Upgrade to add more!
                </p>
              </div>
            )}
          </div>

          <div className="bg-slate-50 rounded-xl p-4">
            <UsageProgressBar
              used={subscription?.impressions_used || 0}
              included={subscription?.impressions_included || 10}
              label="Intent Matches"
            />
          </div>

          <div className="bg-slate-50 rounded-xl p-4">
            <div className="flex justify-between items-center">
              <span className="text-sm font-medium text-slate-700">Billing Period</span>
              <span className="text-sm text-slate-600">
                {subscription?.current_period_end
                  ? `Renews ${new Date(subscription.current_period_end).toLocaleDateString()}`
                  : 'Monthly'}
              </span>
            </div>
            {subscription?.overage_amount > 0 && (
              <div className="mt-3 bg-red-50 border border-red-200 rounded-lg p-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium text-red-700">Overage Charges</span>
                  <span className="text-sm font-bold text-red-700">
                    ${subscription.overage_amount.toFixed(2)}
                  </span>
                </div>
                <p className="text-xs text-red-600 mt-1">
                  {subscription.overage_count} matches × ${parseFloat(subscription.impression_overage_rate || 0.25).toFixed(2)}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Available Plans */}
      <div className="mb-8">
        <h2 className="text-lg font-semibold text-slate-800 mb-4">Available Plans</h2>
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
          {Object.entries(PLAN_DISPLAY).map(([key, config]) => (
            <PlanCard
              key={key}
              planKey={key}
              config={config}
              currentPlan={currentPlan}
              onSubscribe={handleSubscribe}
              loading={subscribing}
            />
          ))}
        </div>
      </div>

      {/* Payment History */}
      {payments.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6">
          <h2 className="text-lg font-semibold text-slate-800 mb-4">Payment History</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="text-left py-2 font-medium text-slate-600">Date</th>
                  <th className="text-left py-2 font-medium text-slate-600">Description</th>
                  <th className="text-left py-2 font-medium text-slate-600">Amount</th>
                  <th className="text-left py-2 font-medium text-slate-600">Status</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((payment) => (
                  <tr key={payment.id} className="border-b border-slate-100">
                    <td className="py-3 text-slate-600">
                      {new Date(payment.created_at).toLocaleDateString()}
                    </td>
                    <td className="py-3 text-slate-700">{payment.description}</td>
                    <td className="py-3 text-slate-700 font-medium">
                      ${(payment.amount_cents / 100).toFixed(2)}
                    </td>
                    <td className="py-3">
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
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
