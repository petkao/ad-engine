import { useEffect, useState } from 'react';

const API_BASE = process.env.REACT_APP_API_URL
  ? `${process.env.REACT_APP_API_URL}`
  : 'http://localhost:3001';

export default function VerifyEmail() {
  const [status, setStatus] = useState('loading'); // 'loading' | 'success' | 'error'
  const [message, setMessage] = useState('');
  const [sellerName, setSellerName] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');

    if (!token) {
      setStatus('error');
      setMessage('No verification token provided.');
      return;
    }

    fetch(`${API_BASE}/auth/verify-email?token=${encodeURIComponent(token)}`)
      .then(async (res) => {
        const data = await res.json();
        if (res.ok && data.success) {
          setStatus('success');
          setSellerName(data.seller_name || '');
          setMessage(data.message || 'Email verified successfully!');
        } else {
          setStatus('error');
          setMessage(data.error || 'Verification failed.');
        }
      })
      .catch(() => {
        setStatus('error');
        setMessage('Network error. Please try again.');
      });
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-8 text-center">
        <div className="mb-6">
          <h1
            className="text-2xl font-bold"
            style={{
              fontFamily: '"DM Serif Display", serif',
              background: 'linear-gradient(135deg, #ec4899, #a855f7)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            PinkCurve
          </h1>
        </div>

        {status === 'loading' && (
          <>
            <div className="w-12 h-12 border-4 border-purple-400 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-slate-600">Verifying your email...</p>
          </>
        )}

        {status === 'success' && (
          <>
            <div className="text-6xl mb-4">&#x2705;</div>
            <h2 className="text-xl font-semibold text-slate-800 mb-2">
              Email Verified!
            </h2>
            {sellerName && (
              <p className="text-slate-600 mb-4">Welcome, {sellerName}!</p>
            )}
            <p className="text-slate-500 mb-6">{message}</p>
            <a
              href="/"
              className="inline-block px-6 py-3 rounded-lg font-medium text-white"
              style={{
                background: 'linear-gradient(135deg, #ec4899, #a855f7)',
              }}
            >
              Go to Dashboard
            </a>
          </>
        )}

        {status === 'error' && (
          <>
            <div className="text-6xl mb-4">&#x274C;</div>
            <h2 className="text-xl font-semibold text-slate-800 mb-2">
              Verification Failed
            </h2>
            <p className="text-red-500 mb-6">{message}</p>
            <div className="space-y-3">
              <a
                href="/"
                className="block px-6 py-3 rounded-lg font-medium text-white"
                style={{
                  background: 'linear-gradient(135deg, #ec4899, #a855f7)',
                }}
              >
                Go to Login
              </a>
              <p className="text-sm text-slate-400">
                If your link expired, log in and request a new verification email.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
