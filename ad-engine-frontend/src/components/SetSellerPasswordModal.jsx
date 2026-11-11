import { useState } from 'react';
import { api } from '../api/client';
import { Modal, Field, Input } from './UI';

const MIN_LENGTH = 8;

// Readable temporary password: no look-alike characters (0/O, 1/l/I)
function generatePassword(length = 14) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const values = new Uint32Array(length);
  window.crypto.getRandomValues(values);
  return Array.from(values, (v) => chars[v % chars.length]).join('');
}

export default function SetSellerPasswordModal({ seller, onClose }) {
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [doneFor, setDoneFor] = useState(null); // login emails updated
  const [copied, setCopied] = useState(false);

  const generate = () => {
    setPassword(generatePassword());
    setShow(true);
    setError('');
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (password.length < MIN_LENGTH) return setError(`Password must be at least ${MIN_LENGTH} characters.`);
    if (!window.confirm(`Set a new password for ${seller.name}? Their current password will stop working.`)) return;
    setSaving(true);
    try {
      const res = await api.setSellerPassword(seller.id, password);
      setDoneFor(res.emails || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={`Set password — ${seller.name}`} onClose={onClose}>
      {doneFor ? (
        <div className="space-y-4">
          <p className="text-sm text-green-700">
            Password updated for {doneFor.join(', ') || seller.email}. Share it with the seller privately
            (not in a public channel), and ask them to change it after signing in with 🔑 Change password.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono break-all">{password}</code>
            <button type="button" onClick={copy}
              className="rounded-lg text-sm px-3 py-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200">
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <p className="text-xs text-slate-400">This password won't be shown again after you close this window.</p>
          <div className="flex justify-end">
            <button type="button" onClick={onClose}
              className="rounded-lg font-medium bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 text-sm">Done</button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit}>
          <p className="text-sm text-slate-600 mb-4">
            Sets a new sign-in password for <strong>{seller.email}</strong>. Use this when a seller is locked out.
          </p>
          <Field label={`New password (at least ${MIN_LENGTH} characters)`}>
            <div className="flex gap-2">
              <Input type={show ? 'text' : 'password'} autoComplete="new-password" value={password}
                onChange={(e) => setPassword(e.target.value)} required minLength={MIN_LENGTH} autoFocus />
              <button type="button" onClick={() => setShow((s) => !s)}
                className="rounded-lg text-xs px-3 bg-white hover:bg-slate-50 text-slate-600 border border-slate-200">
                {show ? 'Hide' : 'Show'}
              </button>
              <button type="button" onClick={generate}
                className="rounded-lg text-xs px-3 bg-white hover:bg-slate-50 text-slate-600 border border-slate-200 whitespace-nowrap">
                Generate
              </button>
            </div>
          </Field>
          {error && <p className="text-sm text-red-600 mb-4" role="alert">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose}
              className="rounded-lg font-medium bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 px-4 py-2 text-sm">
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="rounded-lg font-medium disabled:opacity-40 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 text-sm">
              {saving ? 'Saving…' : 'Set password'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
