import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { PageHeader, Spinner } from '../components/UI';

function ApprovalStatusBadge({ status }) {
  const styles = {
    pending_review: 'bg-yellow-100 text-yellow-700',
    approved: 'bg-green-100 text-green-700',
    rejected: 'bg-red-100 text-red-700',
    suspended: 'bg-slate-100 text-slate-700',
  };
  const labels = {
    pending_review: 'Pending Review',
    approved: 'Approved',
    rejected: 'Rejected',
    suspended: 'Suspended',
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full ${styles[status] || styles.pending_review}`}>
      {labels[status] || status}
    </span>
  );
}

export default function PendingApproval() {
  const [sellers, setSellers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState({});

  const load = async () => {
    setLoading(true);
    try {
      const data = await api.getPendingSellers();
      setSellers(data);
    } catch (err) {
      console.error('Failed to load pending sellers:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleApprove = async (seller) => {
    if (!window.confirm(`Approve ${seller.name}? They will be able to create ads.`)) return;
    setProcessing(p => ({ ...p, [seller.id]: 'approving' }));
    try {
      await api.approveSeller(seller.id);
      load();
    } catch (err) {
      console.error('Failed to approve seller:', err);
      alert('Failed to approve seller');
    } finally {
      setProcessing(p => ({ ...p, [seller.id]: null }));
    }
  };

  const handleReject = async (seller) => {
    if (!window.confirm(`Reject ${seller.name}? They will not be able to create ads.`)) return;
    setProcessing(p => ({ ...p, [seller.id]: 'rejecting' }));
    try {
      await api.rejectSeller(seller.id);
      load();
    } catch (err) {
      console.error('Failed to reject seller:', err);
      alert('Failed to reject seller');
    } finally {
      setProcessing(p => ({ ...p, [seller.id]: null }));
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div>
      <PageHeader
        title="Pending Approval"
        subtitle={`${sellers.length} seller${sellers.length !== 1 ? 's' : ''} awaiting review`}
      />

      <div className="bg-white rounded-2xl border border-slate-100">
        {loading ? <Spinner /> : sellers.length === 0 ? (
          <div className="p-12 text-center text-slate-500">
            <div className="text-4xl mb-3">&#x2705;</div>
            <div className="text-lg font-medium">No pending approvals</div>
            <div className="text-sm mt-1">All seller registrations have been reviewed.</div>
          </div>
        ) : (
          <div style={{ overflowX: 'auto', width: '100%' }}>
            <table className="w-full text-sm" style={{ minWidth: '900px' }}>
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="text-left py-3 px-4 text-xs font-semibold text-slate-400 uppercase">Company</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-slate-400 uppercase">Email</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-slate-400 uppercase">Industry</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-slate-400 uppercase">Location</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-slate-400 uppercase">Verification</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-slate-400 uppercase">Registered</th>
                  <th className="text-right py-3 px-4 text-xs font-semibold text-slate-400 uppercase" style={{ position: 'sticky', right: 0, background: 'white' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {sellers.map(seller => (
                  <tr key={seller.id} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className="py-3 px-4 text-slate-700 font-medium">{seller.name}</td>
                    <td className="py-3 px-4 text-slate-500 text-sm">{seller.email}</td>
                    <td className="py-3 px-4 text-slate-500">{seller.industry || '-'}</td>
                    <td className="py-3 px-4 text-slate-500">{seller.location || '-'}</td>
                    <td className="py-3 px-4">
                      <div className="flex flex-col gap-1">
                        {seller.email_verified ? (
                          <span className="text-xs text-green-600">&#x2709;&#xFE0F; Email verified</span>
                        ) : (
                          <span className="text-xs text-slate-400">&#x2709;&#xFE0F; Email pending</span>
                        )}
                        {seller.geo_match ? (
                          <span className="text-xs text-green-600">&#x1F4CD; Geo matched</span>
                        ) : seller.geo_verified ? (
                          <span className="text-xs text-yellow-600">&#x1F4CD; Geo verified</span>
                        ) : (
                          <span className="text-xs text-slate-400">&#x1F4CD; Geo pending</span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-slate-500 text-xs">{formatDate(seller.created_at)}</td>
                    <td className="py-3 px-4 text-right" style={{ position: 'sticky', right: 0, background: 'white' }}>
                      <div className="flex gap-2 justify-end">
                        <button
                          onClick={() => handleApprove(seller)}
                          disabled={!!processing[seller.id]}
                          className="px-3 py-1.5 text-xs bg-green-100 text-green-700 hover:bg-green-200 rounded-md disabled:opacity-50"
                        >
                          {processing[seller.id] === 'approving' ? 'Approving...' : 'Approve'}
                        </button>
                        <button
                          onClick={() => handleReject(seller)}
                          disabled={!!processing[seller.id]}
                          className="px-3 py-1.5 text-xs bg-red-100 text-red-700 hover:bg-red-200 rounded-md disabled:opacity-50"
                        >
                          {processing[seller.id] === 'rejecting' ? 'Rejecting...' : 'Reject'}
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
    </div>
  );
}
