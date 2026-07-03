import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';

const INDUSTRIES = [
  'Sports & Outdoors','Electronics','Fashion & Apparel','Home & Garden',
  'Health & Beauty','Automotive','Books & Media','Food & Beverage',
  'Toys & Games','Pet Supplies','Office Supplies','Travel & Leisure',
  'Jewelry & Accessories','Baby & Kids','Musical Instruments','General',
];

export default function Login() {
  const { login, register, loginWithGoogle } = useAuth();
  const [mode, setMode] = useState('login'); // 'login' | 'register' | 'registered'
  const [form, setForm] = useState({ name: '', email: '', password: '', industry: 'General', location: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [registrationMessage, setRegistrationMessage] = useState('');

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async () => {
    setError('');
    setLoading(true);
    try {
      if (mode === 'login') {
        await login(form.email, form.password);
      } else {
        if (!form.name) return setError('Company name is required.');
        const result = await register(form);
        // Nuclear option: Registration does NOT auto-login
        // Show success message and switch to login mode
        if (result.requiresLogin) {
          setRegistrationMessage(result.message || 'Registration successful! Please wait for admin approval.');
          setMode('registered');
          setForm({ name: '', email: '', password: '', industry: 'General', location: '' });
        }
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 flex items-center justify-center p-4">
      {/* Background decoration */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl" />
      </div>

      <div className="relative w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="text-4xl font-bold text-white mb-1" style={{ fontFamily: '"DM Serif Display", serif' }}>
            Ad Engine
          </div>
          <div className="text-blue-300 text-sm">Privacy-first personal AI ad platform</div>
          <div className="text-slate-500 text-xs mt-1">Peter Kao Associates</div>
        </div>

        {/* Card */}
        <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl p-8 shadow-2xl">

          {/* Registration Success Message */}
          {mode === 'registered' ? (
            <div className="text-center">
              <div className="text-5xl mb-4">&#x2705;</div>
              <h2 className="text-xl font-bold text-white mb-3">Registration Successful!</h2>
              <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-4 mb-6">
                <p className="text-green-300 text-sm leading-relaxed">
                  {registrationMessage}
                </p>
              </div>
              <div className="space-y-3 text-sm text-slate-400 mb-6 text-left">
                <p className="font-medium text-slate-300">What happens next:</p>
                <ul className="space-y-2 ml-4">
                  <li className="flex items-start gap-2">
                    <span className="text-blue-400">1.</span>
                    <span>Check your email to verify your email address</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-blue-400">2.</span>
                    <span>Our team will review your application</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-blue-400">3.</span>
                    <span>You'll receive an email once approved</span>
                  </li>
                </ul>
              </div>
              <button
                onClick={() => { setMode('login'); setRegistrationMessage(''); }}
                className="w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold py-3 px-4 rounded-xl transition-all shadow-lg shadow-blue-600/20">
                Go to Sign In
              </button>
            </div>
          ) : (
            <>
              {/* Tab switcher */}
              <div className="flex bg-white/5 rounded-2xl p-1 mb-6">
                {['login','register'].map(m => (
                  <button key={m} onClick={() => { setMode(m); setError(''); }}
                    className={`flex-1 py-2 rounded-xl text-sm font-medium capitalize transition-all ${
                      mode === m ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-400 hover:text-white'}`}>
                    {m === 'login' ? 'Sign In' : 'Register'}
                  </button>
                ))}
              </div>

              {/* Google OAuth */}
              <button onClick={loginWithGoogle}
                className="w-full flex items-center justify-center gap-3 bg-white hover:bg-slate-50 text-slate-700 font-medium py-3 px-4 rounded-xl transition-all mb-4 shadow-sm">
                <svg width="18" height="18" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
                Continue with Google
              </button>

              {/* Divider */}
              <div className="flex items-center gap-3 mb-4">
                <div className="flex-1 h-px bg-white/10" />
                <span className="text-slate-500 text-xs">or</span>
                <div className="flex-1 h-px bg-white/10" />
              </div>

              {/* Form */}
              <div className="space-y-3">
                {mode === 'register' && (
                  <>
                    <input value={form.name} onChange={set('name')} placeholder="Company name"
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-blue-400 focus:bg-white/10 transition-all" />
                    <select value={form.industry} onChange={set('industry')}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-blue-400 transition-all">
                      {INDUSTRIES.map(i => <option key={i} value={i} className="bg-slate-800">{i}</option>)}
                    </select>
                    <input value={form.location} onChange={set('location')} placeholder="Business location (e.g., San Jose, CA)"
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-blue-400 focus:bg-white/10 transition-all" />
                  </>
                )}
                <input value={form.email} onChange={set('email')} placeholder="Email address" type="email"
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-blue-400 focus:bg-white/10 transition-all" />
                <input value={form.password} onChange={set('password')} placeholder="Password" type="password"
                  onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-blue-400 focus:bg-white/10 transition-all" />
              </div>

              {/* Error */}
              {error && (
                <div className="mt-3 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-red-400 text-sm">
                  {error}
                </div>
              )}

              {/* Submit */}
              <button onClick={handleSubmit} disabled={loading}
                className="w-full mt-4 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold py-3 px-4 rounded-xl transition-all shadow-lg shadow-blue-600/20">
                {loading ? 'Please wait...' : mode === 'login' ? 'Sign In' : 'Create Account'}
              </button>

              {/* Privacy note for register */}
              {mode === 'register' && (
                <p className="text-xs text-slate-500 text-center mt-4">
                  By registering you agree to our terms. Your seller data is stored securely.
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
