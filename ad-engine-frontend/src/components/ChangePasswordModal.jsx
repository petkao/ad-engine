import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { Modal, Field, Input, Button, Spinner } from './UI';

export default function ChangePasswordModal({ onClose }) {
  const [status, setStatus] = useState(null); // { has_password, min_length }
  const [loadError, setLoadError] = useState('');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    api.getPasswordStatus()
      .then(setStatus)
      .catch((e) => setLoadError(e.message));
  }, []);

  const minLength = status?.min_length || 8;

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (next.length < minLength) return setError(`New password must be at least ${minLength} characters.`);
    if (next !== confirm) return setError('New passwords do not match.');
    if (next === current) return setError('New password must be different from the current one.');
    setSaving(true);
    try {
      await api.changePassword(current, next);
      setDone(true);
      setCurrent(''); setNext(''); setConfirm('');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  let body;
  if (loadError) {
    body = <p className="text-sm text-red-600">{loadError}</p>;
  } else if (!status) {
    body = <div className="flex justify-center py-6"><Spinner /></div>;
  } else if (!status.has_password) {
    body = (
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          This account signs in with Google and has no password, so there is nothing to change here.
          Manage your sign-in from your Google account.
        </p>
        <div className="flex justify-end"><Button onClick={onClose}>Close</Button></div>
      </div>
    );
  } else if (done) {
    body = (
      <div className="space-y-4">
        <p className="text-sm text-green-700">Your password has been changed. Use the new password next time you sign in.</p>
        <div className="flex justify-end"><Button onClick={onClose}>Done</Button></div>
      </div>
    );
  } else {
    body = (
      <form onSubmit={submit}>
        <Field label="Current password">
          <Input type="password" autoComplete="current-password" value={current}
            onChange={(e) => setCurrent(e.target.value)} required autoFocus />
        </Field>
        <Field label={`New password (at least ${minLength} characters)`}>
          <Input type="password" autoComplete="new-password" value={next}
            onChange={(e) => setNext(e.target.value)} required minLength={minLength} />
        </Field>
        <Field label="Confirm new password">
          <Input type="password" autoComplete="new-password" value={confirm}
            onChange={(e) => setConfirm(e.target.value)} required />
        </Field>
        {error && <p className="text-sm text-red-600 mb-4" role="alert">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose}
            className="rounded-lg font-medium transition-all duration-150 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 px-4 py-2 text-sm">
            Cancel
          </button>
          <button type="submit" disabled={saving}
            className="rounded-lg font-medium transition-all duration-150 disabled:opacity-40 bg-blue-600 hover:bg-blue-700 text-white shadow-sm px-4 py-2 text-sm">
            {saving ? 'Saving…' : 'Change password'}
          </button>
        </div>
      </form>
    );
  }

  return <Modal title="Change password" onClose={onClose}>{body}</Modal>;
}
