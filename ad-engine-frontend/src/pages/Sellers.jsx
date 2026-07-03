import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import {
  PageHeader, Button, Badge, SearchBar, Spinner,
  Modal, Field, Input, Select
} from '../components/UI';

function ApprovalStatusBadge({ status }) {
  const styles = {
    pending_review: 'bg-yellow-100 text-yellow-700',
    approved: 'bg-green-100 text-green-700',
    rejected: 'bg-red-100 text-red-700',
    suspended: 'bg-slate-200 text-slate-700',
  };
  const labels = {
    pending_review: 'Pending Review',
    approved: 'Approved',
    rejected: 'Rejected',
    suspended: 'Suspended',
  };
  const icons = {
    pending_review: '\uD83D\uDFE1',
    approved: '\uD83D\uDFE2',
    rejected: '\uD83D\uDD34',
    suspended: '\u26D4',
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full ${styles[status] || styles.pending_review}`}>
      {icons[status] || icons.pending_review} {labels[status] || status || 'Unknown'}
    </span>
  );
}

const INDUSTRIES = [
  'Sports & Outdoors','Electronics','Fashion & Apparel','Home & Garden',
  'Health & Beauty','Automotive','Books & Media','Food & Beverage',
  'Toys & Games','Pet Supplies','Office Supplies','Travel & Leisure',
  'Jewelry & Accessories','Baby & Kids','Musical Instruments',
];
const PLANS = ['starter','pro','enterprise'];

function SellerForm({ initial = {}, sellers, onSave, onClose }) {
  const [form, setForm] = useState({
    name: initial.name || '',
    email: initial.email || '',
    industry: initial.industry || INDUSTRIES[0],
    plan: initial.plan || 'starter',
    balance: initial.balance || 0,
    location: initial.location || '',
    business_registration: initial.business_registration || '',
    is_verified: initial.is_verified || false,
  });
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  return (
    <>
      <Field label="Company Name"><Input value={form.name} onChange={set('name')} placeholder="Trail Runner Co" /></Field>
      <Field label="Email"><Input value={form.email} onChange={set('email')} placeholder="ads@company.com" type="email" /></Field>
      <Field label="Industry">
        <Select value={form.industry} onChange={set('industry')}>
          {INDUSTRIES.map(i => <option key={i}>{i}</option>)}
        </Select>
      </Field>
      <Field label="Plan">
        <Select value={form.plan} onChange={set('plan')}>
          {PLANS.map(p => <option key={p}>{p}</option>)}
        </Select>
      </Field>
      <Field label="Balance ($)"><Input value={form.balance} onChange={set('balance')} type="number" step="0.01" /></Field>
      <Field label="Location (City, Country)"><Input value={form.location} onChange={set('location')} placeholder="San Jose, CA, USA" /></Field>
      <Field label="Business Registration Number"><Input value={form.business_registration} onChange={set('business_registration')} placeholder="e.g. 12-3456789" /></Field>
      <Field label="Verified Seller">
        <div className="flex items-center gap-3 mt-1">
          <input type="checkbox" id="is_verified" checked={form.is_verified}
            onChange={e => setForm(f => ({...f, is_verified: e.target.checked}))}
            className="w-4 h-4 accent-pink-500" />
          <label htmlFor="is_verified" className="text-sm text-slate-600">Mark as verified seller ✅</label>
        </div>
      </Field>
      <div className="flex gap-3 mt-6">
        <Button onClick={() => onSave(form)} className="flex-1">Save Seller</Button>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
      </div>
    </>
  );
}

export default function Sellers() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [sellers, setSellers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState(null); // null | 'create' | seller obj
  const [processing, setProcessing] = useState({});

  const load = () => api.getSellers().then(setSellers).finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  const handleSave = async (form) => {
    if (modal === 'create') await api.createSeller(form);
    else await api.updateSeller(modal.id, form);
    setModal(null);
    load();
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this seller and all their products/ads?')) return;
    await api.deleteSeller(id);
    load();
  };

  const handleSuspend = async (seller) => {
    if (!window.confirm(`Suspend ${seller.name}? They will not be able to create new ads.`)) return;
    setProcessing(p => ({ ...p, [seller.id]: 'suspending' }));
    try {
      await api.suspendSeller(seller.id);
      load();
    } catch (err) {
      console.error('Failed to suspend seller:', err);
      alert('Failed to suspend seller');
    } finally {
      setProcessing(p => ({ ...p, [seller.id]: null }));
    }
  };

  const handleUnsuspend = async (seller) => {
    if (!window.confirm(`Unsuspend ${seller.name}? They will be able to create ads again.`)) return;
    setProcessing(p => ({ ...p, [seller.id]: 'unsuspending' }));
    try {
      await api.unsuspendSeller(seller.id);
      load();
    } catch (err) {
      console.error('Failed to unsuspend seller:', err);
      alert('Failed to unsuspend seller');
    } finally {
      setProcessing(p => ({ ...p, [seller.id]: null }));
    }
  };

  const filtered = sellers.filter(s =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    s.email.toLowerCase().includes(search.toLowerCase()) ||
    s.industry.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      <PageHeader
        title="Sellers"
        subtitle={`${sellers.length} registered sellers`}
        action={<Button onClick={() => setModal('create')}>+ Add Seller</Button>}
      />

      <div className="bg-white rounded-2xl border border-slate-100">
        <div className="p-4 border-b border-slate-100">
          <SearchBar value={search} onChange={setSearch} placeholder="Search by name, email, or industry..." />
        </div>
        {loading ? <Spinner /> : (
          <div style={{ overflowX: 'auto', width: '100%' }}>
            <table className="w-full text-sm" style={{ minWidth: '800px' }}>
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="text-left py-3 px-4 text-xs font-semibold text-slate-400 uppercase">Company</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-slate-400 uppercase">Email</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-slate-400 uppercase">Plan</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-slate-400 uppercase">Balance</th>
                  {isAdmin && <th className="text-left py-3 px-4 text-xs font-semibold text-slate-400 uppercase">Status</th>}
                  <th className="text-left py-3 px-4 text-xs font-semibold text-slate-400 uppercase">Verified</th>
                  <th className="text-right py-3 px-4 text-xs font-semibold text-slate-400 uppercase" style={{ position: 'sticky', right: 0, background: 'white' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(seller => (
                  <tr key={seller.id} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className="py-3 px-4 text-slate-700 font-medium">{seller.name}</td>
                    <td className="py-3 px-4 text-slate-500 text-sm">{seller.email}</td>
                    <td className="py-3 px-4"><Badge variant={seller.plan}>{seller.plan}</Badge></td>
                    <td className="py-3 px-4 font-mono text-green-700">${parseFloat(seller.balance || 0).toFixed(2)}</td>
                    {isAdmin && (
                      <td className="py-3 px-4">
                        <ApprovalStatusBadge status={seller.approval_status} />
                      </td>
                    )}
                    <td className="py-3 px-4">
                      {seller.email_verified && seller.geo_verified ? (
                        <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Verified</span>
                      ) : seller.geo_verified ? (
                        <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">Email</span>
                      ) : seller.email_verified ? (
                        <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">Geo</span>
                      ) : (
                        <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">Pending</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right" style={{ position: 'sticky', right: 0, background: 'white' }}>
                      <div className="flex gap-2 justify-end">
                        <button
                          onClick={() => setModal(seller)}
                          className="px-3 py-1.5 text-xs bg-slate-100 hover:bg-slate-200 rounded-md"
                        >
                          Edit
                        </button>
                        {isAdmin && seller.approval_status === 'approved' && (
                          <button
                            onClick={() => handleSuspend(seller)}
                            disabled={!!processing[seller.id]}
                            className="px-3 py-1.5 text-xs bg-yellow-100 text-yellow-700 hover:bg-yellow-200 rounded-md disabled:opacity-50"
                          >
                            {processing[seller.id] === 'suspending' ? 'Suspending...' : 'Suspend'}
                          </button>
                        )}
                        {isAdmin && seller.approval_status === 'suspended' && (
                          <button
                            onClick={() => handleUnsuspend(seller)}
                            disabled={!!processing[seller.id]}
                            className="px-3 py-1.5 text-xs bg-green-100 text-green-700 hover:bg-green-200 rounded-md disabled:opacity-50"
                          >
                            {processing[seller.id] === 'unsuspending' ? 'Unsuspending...' : 'Unsuspend'}
                          </button>
                        )}
                        <button
                          onClick={() => handleDelete(seller.id)}
                          className="px-3 py-1.5 text-xs bg-red-100 text-red-700 hover:bg-red-200 rounded-md"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modal && (
        <Modal
          title={modal === 'create' ? 'Add New Seller' : `Edit ${modal.name}`}
          onClose={() => setModal(null)}
        >
          <SellerForm initial={modal === 'create' ? {} : modal} onSave={handleSave} onClose={() => setModal(null)} />
        </Modal>
      )}
    </div>
  );
}
