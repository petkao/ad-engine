import { useEffect, useState, useRef } from 'react';
import { api } from '../api/client';
import {
  PageHeader, Button, Badge, Table, SearchBar, Spinner,
  Modal, Field, Input, Select, Textarea
} from '../components/UI';

const FORMATS = ['text', 'image', 'native', 'carousel', 'video'];
//const BASE = 'http://localhost:3001';
const BASE = process.env.REACT_APP_API_URL || 'http://localhost:3001';

function UploadModal({ ad, onClose, onUploaded }) {
  const [tab, setTab] = useState('image');
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState(null);
  const [imageUrl, setImageUrl] = useState(null);
  const [error, setError] = useState('');
  const imageRef = useRef();
  const videoRef = useRef();
  const thumbRef = useRef();

  const uploadImage = async () => {
    const file = imageRef.current?.files?.[0];
    if (!file) return setError('Please select an image file');
    setUploading(true); setError('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(`${BASE}/api/ads/${ad.id}/upload-image`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}` },
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setResult(data); onUploaded();
    } catch (err) { setError(err.message); } finally { setUploading(false); }
  };

  const uploadVideo = async () => {
    const video = videoRef.current?.files?.[0];
    if (!video) return setError('Please select a video file');
    setUploading(true); setError('');
    try {
      const formData = new FormData();
      formData.append('video', video);
      const thumb = thumbRef.current?.files?.[0];
      if (thumb) formData.append('thumbnail', thumb);
      const res = await fetch(`${BASE}/api/ads/${ad.id}/upload-video`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}` },
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setResult(data); onUploaded();
    } catch (err) { setError(err.message); } finally { setUploading(false); }
  };

  return (
    <Modal title={`Upload Media — ${ad.headline}`} onClose={onClose}>
      <div className="flex gap-2 mb-4">
        {['image', 'video'].map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 py-2 rounded-xl text-sm font-medium capitalize transition-all ${tab === t ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'}`}>
            {t === 'image' ? '🖼️ Image' : '🎬 Video'}
          </button>
        ))}
      </div>
      {result && (
        <div className={`rounded-xl p-4 mb-4 ${result.status === 'active' ? 'bg-green-50 border border-green-200' : result.status === 'rejected' ? 'bg-red-50 border border-red-200' : 'bg-amber-50 border border-amber-200'}`}>
          <div className="font-semibold text-sm mb-1">
            {result.status === 'active' ? '✅ Approved and live!' : result.status === 'rejected' ? '❌ Rejected by moderation' : '⏳ Pending admin review'}
          </div>
          {result.moderation?.reason && <div className="text-xs text-slate-600">{result.moderation.reason}</div>}
          // {result.media_url && <img src={result.media_url} alt="" className="mt-3 rounded-lg w-full object-contain max-h-40" />}
          {result.media_url && <img src={`${result.media_url}?t=${Date.now()}`} alt="" className="mt-3 rounded-lg w-full object-cover max-h-40" />}
        </div>
      )}
      {tab === 'image' && !result && (
        <div>
          <Field label="Select Image (JPG, PNG, WebP — max 10MB)">
            <input ref={imageRef} type="file" accept="image/jpeg,image/png,image/webp" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
          </Field>
          <div className="bg-blue-50 rounded-xl p-3 mb-4 text-xs text-blue-700">🤖 Image will be automatically moderated by GPT-4o before going live.</div>
          {error && <div className="bg-red-50 text-red-600 text-xs px-3 py-2 rounded-lg mb-3">{error}</div>}
          <div className="flex gap-3">
            <Button onClick={uploadImage} disabled={uploading} className="flex-1">{uploading ? '⏳ Uploading & moderating...' : '📤 Upload Image'}</Button>
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
          </div>
        </div>
      )}
      {tab === 'video' && !result && (
        <div>
          <Field label="Select Video (MP4, WebM — max 100MB)">
            <input ref={videoRef} type="file" accept="video/mp4,video/webm,video/quicktime" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
          </Field>
          <Field label="Thumbnail Image (optional)">
            <input ref={thumbRef} type="file" accept="image/jpeg,image/png,image/webp" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
          </Field>
          <div className="bg-amber-50 rounded-xl p-3 mb-4 text-xs text-amber-700">⏳ Video ads go to pending review before going live.</div>
          {error && <div className="bg-red-50 text-red-600 text-xs px-3 py-2 rounded-lg mb-3">{error}</div>}
          <div className="flex gap-3">
            <Button onClick={uploadVideo} disabled={uploading} className="flex-1">{uploading ? '⏳ Uploading...' : '📤 Upload Video'}</Button>
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function AdminReview({ onClose, onUpdated }) {
  const [pending, setPending] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    fetch(`${BASE}/api/admin/pending-ads`, {
      headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}` }
    })
      .then(r => r.json())
      .then(setPending)
      .finally(() => setLoading(false));
  }, []);

  const approve = async (id) => {
    await fetch(`${BASE}/api/admin/ads/${id}/approve`, { method: 'POST', credentials: 'include' });
    setPending(p => p.filter(a => a.id !== id)); onUpdated();
  };
  const reject = async (id) => {
    const reason = prompt('Reason for rejection:');
    if (!reason) return;
    await fetch(`${BASE}/api/admin/ads/${id}/reject`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }) });
    setPending(p => p.filter(a => a.id !== id)); onUpdated();
  };
  return (
    <Modal title="🔍 Admin Review Queue" onClose={onClose}>
      {loading ? <Spinner /> : pending.length === 0 ? (
        <div className="text-center py-8 text-slate-400"><div className="text-4xl mb-2">✅</div><div className="text-sm">No ads pending review</div></div>
      ) : (
        <div className="space-y-4">
          {pending.map(ad => (
            <div key={ad.id} className="border border-slate-200 rounded-xl overflow-hidden">
              {ad.media_url && (ad.format === 'video' ? <video src={ad.media_url} className="w-full h-32 object-cover" controls /> : <img src={ad.media_url} alt="" className="w-full h-32 object-contain bg-slate-50" />)}
              <div className="p-3">
                <div className="font-semibold text-sm">{ad.headline}</div>
                <div className="text-xs text-slate-400 mb-2">{ad.seller_name} · {ad.format}</div>
                <div className="text-xs text-slate-600 mb-3">{ad.body_copy}</div>
                <Badge variant={ad.status}>{ad.status}</Badge>
                <div className="flex gap-2 mt-3">
                  <Button onClick={() => approve(ad.id)} className="flex-1" size="sm">✅ Approve</Button>
                  <Button variant="danger" onClick={() => reject(ad.id)} className="flex-1" size="sm">❌ Reject</Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

function AdPreview({ ad, onClose, onImageGenerated }) {
  const [generating, setGenerating] = useState(false);
  const [imageUrl, setImageUrl] = useState(
    ad.media_url ? `${ad.media_url}?t=${ad.updated_at || Date.now()}` : null
  );
  const [error, setError] = useState('');
  const tags = Array.isArray(ad.intent_tags) ? ad.intent_tags : (() => { try { return JSON.parse(ad.intent_tags); } catch { return []; } })();
  const generateImage = async () => {
    setGenerating(true); setError('');
    try {
      const res = await fetch(`${BASE}/api/ads/${ad.id}/generate-image`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' } });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setImageUrl(data.image_url);
      if (onImageGenerated) onImageGenerated(ad.id, data.image_url);
    } catch (err) { setError(err.message); } finally { setGenerating(false); }
  };
  return (
    <Modal title="Ad Preview" onClose={onClose}>
      <div className="mb-4">
        {ad.format === 'video' && ad.media_url ? (
          <video src={ad.media_url} controls className="w-full rounded-2xl" />
        ) : imageUrl ? (
          <div className="relative rounded-2xl overflow-hidden border border-slate-200">
            <img src={imageUrl} alt={ad.headline} className="w-full object-contain" style={{ maxHeight: '200px' }} />
            <div className="absolute top-2 right-2">
              <button onClick={generateImage} disabled={generating} className="bg-white/90 text-xs font-medium px-3 py-1.5 rounded-lg shadow">{generating ? '⏳' : '🔄 Regenerate'}</button>
            </div>
          </div>
        ) : (
          <div className="border-2 border-dashed border-slate-200 rounded-2xl p-8 text-center">
            <div className="text-4xl mb-3">🎨</div>
            <Button onClick={generateImage} disabled={generating}>{generating ? '⏳ Generating...' : '✨ Generate with DALL-E'}</Button>
          </div>
        )}
        {error && <div className="mt-2 bg-red-50 text-red-600 text-xs px-3 py-2 rounded-lg">{error}</div>}
      </div>
      <div className="bg-slate-50 rounded-xl p-4 space-y-2 text-sm mb-4">
        <div className="flex justify-between"><span className="text-slate-500">Product</span><span className="font-medium">{ad.product_title}</span></div>
        <div className="flex justify-between"><span className="text-slate-500">Format</span><Badge>{ad.format}</Badge></div>
        <div className="flex justify-between"><span className="text-slate-500">Cost/Match</span><span className="font-mono text-green-700">${parseFloat(ad.cost_per_match).toFixed(4)}</span></div>
        <div className="flex justify-between"><span className="text-slate-500">Status</span><Badge variant={ad.status}>{ad.status}</Badge></div>
      </div>
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {tags.map(tag => <span key={tag} className="bg-blue-50 text-blue-600 text-xs px-3 py-1 rounded-full">#{tag}</span>)}
        </div>
      )}
    </Modal>
  );
}

function AdForm({ initial = {}, products, onSave, onClose }) {
  const [form, setForm] = useState({
    product_id: initial.product_id || (products[0]?.id || ''),
    format: initial.format || 'text',
    headline: initial.headline || '',
    body_copy: initial.body_copy || '',
    cost_per_match: initial.cost_per_match || 0.01,
    daily_budget: initial.daily_budget || 50,
    total_budget: initial.total_budget || 500,
    intent_tags: initial.intent_tags ? (Array.isArray(initial.intent_tags) ? initial.intent_tags.join(', ') : initial.intent_tags) : '',
    status: initial.status || 'active',
  });
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));
  const handleSave = () => { const tags = form.intent_tags.split(',').map(t => t.trim()).filter(Boolean); onSave({ ...form, intent_tags: tags }); };
  return (
    <>
      <Field label="Product"><Select value={form.product_id} onChange={set('product_id')}>{products.map(p => <option key={p.id} value={p.id}>{p.title} — {p.seller_name || ''}</option>)}</Select></Field>
      <Field label="Ad Format">
        <Select value={form.format} onChange={set('format')}>{FORMATS.map(f => <option key={f}>{f}</option>)}</Select>
      </Field>
      {form.format === 'video' && <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-3 text-xs text-amber-700">🎬 Upload your video file after saving using the 📤 button in the table.</div>}
      <Field label="Headline"><Input value={form.headline} onChange={set('headline')} placeholder="Run further, feel less" /></Field>
      <Field label="Body Copy"><Textarea value={form.body_copy} onChange={set('body_copy')} placeholder="Your compelling ad copy here..." /></Field>
      <Field label="Intent Tags (comma separated)"><Input value={form.intent_tags} onChange={set('intent_tags')} placeholder="trail running, minimalist shoes, outdoor" /></Field>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Cost/Match ($)"><Input value={form.cost_per_match} onChange={set('cost_per_match')} type="number" step="0.001" /></Field>
        <Field label="Daily Budget ($)"><Input value={form.daily_budget} onChange={set('daily_budget')} type="number" /></Field>
        <Field label="Total Budget ($)"><Input value={form.total_budget} onChange={set('total_budget')} type="number" /></Field>
      </div>
      <Field label="Status"><Select value={form.status} onChange={set('status')}><option value="active">Active</option><option value="paused">Paused</option><option value="inactive">Inactive</option></Select></Field>
      <div className="flex gap-3 mt-6"><Button onClick={handleSave} className="flex-1">Save Ad</Button><Button variant="secondary" onClick={onClose}>Cancel</Button></div>
    </>
  );
}

export default function Ads() {
  const [ads, setAds] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState(null);
  const [preview, setPreview] = useState(null);
  const [upload, setUpload] = useState(null);
  const [showAdmin, setShowAdmin] = useState(false);
  const [filterFormat, setFilterFormat] = useState('All');
  const [filterStatus, setFilterStatus] = useState('All');
  const [pendingCount, setPendingCount] = useState(0);

  const load = () => Promise.all([api.getAds(), api.getProducts()])
    .then(([a, p]) => { setAds(a); setProducts(p); setPendingCount(a.filter(ad => ad.status === 'pending_review').length); })
    .finally(() => setLoading(false));

  useEffect(() => { load(); }, []);

  const handleSave = async (form) => { if (modal === 'create') await api.createAd(form); else await api.updateAd(modal.id, form); setModal(null); load(); };
  const handleDelete = async (id) => { if (!window.confirm('Delete this ad?')) return; await api.deleteAd(id); load(); };
  const handleImageGenerated = (adId, imageUrl) => { setAds(prev => prev.map(a => a.id === adId ? { ...a, media_url: imageUrl } : a)); };

  const filtered = ads.filter(a => {
    const matchSearch = a.headline.toLowerCase().includes(search.toLowerCase()) || (a.seller_name || '').toLowerCase().includes(search.toLowerCase());
    const matchFormat = filterFormat === 'All' || a.format === filterFormat;
    const matchStatus = filterStatus === 'All' || a.status === filterStatus;
    return matchSearch && matchFormat && matchStatus;
  });

  const columns = [
    {
      key: 'headline', label: 'Ad', render: (v, row) => (
        <div className="flex items-center gap-3">
          {row.format === 'video'
            ? (row.thumbnail_url
              ? <img src={`${row.thumbnail_url}?t=${row.updated_at}`} alt="" className="w-10 h-10 rounded-lg object-contain bg-slate-50 shrink-0" />
              : <div className="w-10 h-10 rounded-lg bg-slate-800 flex items-center justify-center text-lg shrink-0">🎬</div>)
            : row.media_url ? <img src={`${row.media_url}?t=${row.updated_at}`} alt="" className="w-10 h-10 rounded-lg object-contain bg-slate-50 shrink-0" />
              : <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center text-lg shrink-0">🎨</div>}
          <div><div className="font-medium text-slate-800">{v}</div><div className="text-xs text-slate-400">{row.product_title} · {row.seller_name}</div></div>
        </div>
      )
    },
    { key: 'format', label: 'Format', render: v => <Badge>{v}</Badge> },
    { key: 'cost_per_match', label: 'Cost/Match', render: v => <span className="font-mono text-xs">${parseFloat(v).toFixed(4)}</span> },
    { key: 'daily_budget', label: 'Daily Budget', render: v => <span className="font-mono text-xs">${parseFloat(v).toFixed(2)}</span> },
    { key: 'spent', label: 'Spent', render: v => <span className="font-mono text-xs text-amber-600">${parseFloat(v || 0).toFixed(2)}</span> },
    { key: 'status', label: 'Status', render: v => <Badge variant={v}>{v}</Badge> },
    {
      key: 'id', label: 'Actions', render: (v, row) => (
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setPreview(row); }}>{row.media_url ? '🖼️' : '✨'}</Button>
          <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setUpload(row); }}>📤</Button>
        </div>
      )
    },
  ];

  return (
    <div>
      <PageHeader title="Ads"
        subtitle={`${ads.length} total · ${ads.filter(a => a.media_url).length} with media · ${ads.filter(a => a.format === 'video').length} video`}
        action={<div className="flex gap-2">{pendingCount > 0 && <Button variant="secondary" onClick={() => setShowAdmin(true)}>🔍 Review Queue ({pendingCount})</Button>}<Button onClick={() => setModal('create')}>+ Create Ad</Button></div>}
      />
      <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex gap-3 flex-wrap">
          <div className="flex-1 min-w-48"><SearchBar value={search} onChange={setSearch} placeholder="Search ads..." /></div>
          <select value={filterFormat} onChange={e => setFilterFormat(e.target.value)} className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">{['All', ...FORMATS].map(f => <option key={f}>{f}</option>)}</select>
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">{['All', 'active', 'pending_review', 'rejected', 'paused', 'inactive'].map(s => <option key={s}>{s}</option>)}</select>
        </div>
        {loading ? <Spinner /> : <Table columns={columns} data={filtered} onEdit={setModal} onDelete={handleDelete} />}
      </div>
      {modal && <Modal title={modal === 'create' ? 'Create New Ad' : 'Edit Ad'} onClose={() => setModal(null)}><AdForm initial={modal === 'create' ? {} : modal} products={products} onSave={handleSave} onClose={() => setModal(null)} /></Modal>}
      {preview && <AdPreview ad={preview} onClose={() => setPreview(null)} onImageGenerated={handleImageGenerated} />}
      {upload && <UploadModal ad={upload} onClose={() => setUpload(null)} onUploaded={load} />}
      {showAdmin && <AdminReview onClose={() => setShowAdmin(false)} onUpdated={load} />}
    </div>
  );
}
