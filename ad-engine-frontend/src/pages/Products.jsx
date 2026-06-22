import { useEffect, useState, useRef } from 'react';
import { api } from '../api/client';
import {
  PageHeader, Button, Badge, Table, SearchBar, Spinner,
  Modal, Field, Input, Select, Textarea
} from '../components/UI';

const BASE = process.env.REACT_APP_API_URL || 'http://localhost:3001';

const CATEGORIES = [
  'Electronics', 'Sports & Outdoors', 'Health & Beauty', 'Home & Garden',
  'Fashion', 'Food & Beverage', 'Books & Media', 'Toys & Games',
  'Automotive', 'Travel', 'Pet Supplies', 'Office Supplies', 'Other'
];

// ── Product Image Upload Modal ────────────────────────────────
function ProductImageModal({ product, onClose, onUploaded }) {
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const fileRef = useRef();

  const upload = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) return setError('Please select an image');
    setUploading(true); setError('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      const token = localStorage.getItem('auth_token');
      const res = await fetch(`${BASE}/api/products/${product.id}/upload-image`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token || ''}` },
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setResult(data);
      onUploaded();
    } catch (err) { setError(err.message); }
    finally { setUploading(false); }
  };

  return (
    <Modal title={`Upload Image — ${product.title}`} onClose={onClose}>
      {result ? (
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 mb-4">
          <div className="font-semibold text-green-800 mb-2">✅ Image uploaded!</div>
          {result.image_url && (
            <img src={result.image_url} alt="" className="rounded-lg w-full object-contain max-h-40" />
          )}
          <Button variant="secondary" onClick={onClose} className="mt-4 w-full">Close</Button>
        </div>
      ) : (
        <>
          <Field label="Select Image (JPG, PNG, WebP — max 10MB)">
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
          </Field>
          <div className="bg-blue-50 rounded-xl p-3 mb-4 text-xs text-blue-700">
            🤖 Image will be automatically moderated by GPT-4o before being saved.
          </div>
          {error && <div className="bg-red-50 text-red-600 text-xs px-3 py-2 rounded-lg mb-3">{error}</div>}
          <div className="flex gap-3">
            <Button onClick={upload} disabled={uploading} className="flex-1">
              {uploading ? '⏳ Uploading...' : '📤 Upload Image'}
            </Button>
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
          </div>
        </>
      )}
    </Modal>
  );
}

// ── Product Form ──────────────────────────────────────────────
function ProductForm({ initial = {}, sellers, onSave, onClose, onImageUploaded }) {
  const [form, setForm] = useState({
    seller_id: initial.seller_id || (sellers[0]?.id || ''),
    title: initial.title || '',
    description: initial.description || '',
    price: initial.price || '',
    currency: initial.currency || 'USD',
    category: initial.category || 'Electronics',
    product_url: initial.product_url || '',
  });
  const [imageUrl, setImageUrl] = useState(initial.image_url || null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const fileRef = useRef();
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  const uploadImage = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) return setUploadError('Please select an image');
    setUploading(true); setUploadError('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      const token = localStorage.getItem('auth_token');
      const res = await fetch(`${BASE}/api/products/${initial.id}/upload-image`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token || ''}` },
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setImageUrl(data.image_url);
      if (onImageUploaded) onImageUploaded();
    } catch (err) { setUploadError(err.message); }
    finally { setUploading(false); }
  };

  return (
    <>
      {/* Product Image Section */}
      <div className="mb-6">
        <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Product Image</div>
        {imageUrl ? (
          <div className="relative rounded-2xl overflow-hidden border border-slate-200 mb-3">
            <img src={`${imageUrl}?t=${Date.now()}`} alt={form.title}
              className="w-full object-contain bg-slate-50" style={{ maxHeight: '220px' }} />
            <div className="absolute bottom-3 right-3">
              <label className="bg-white/90 backdrop-blur text-xs font-semibold px-3 py-1.5 rounded-lg shadow cursor-pointer hover:bg-white transition-all">
                🔄 Replace Image
                <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp"
                  className="hidden" onChange={uploadImage} />
              </label>
            </div>
          </div>
        ) : (
          <label className="border-2 border-dashed border-slate-200 rounded-2xl p-8 text-center block cursor-pointer hover:border-blue-300 hover:bg-blue-50 transition-all mb-3">
            <div className="text-4xl mb-2">📦</div>
            <div className="text-sm font-medium text-slate-600 mb-1">Click to upload product image</div>
            <div className="text-xs text-slate-400">JPG, PNG, WebP — auto-moderated by GPT-4o</div>
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp"
              className="hidden" onChange={uploadImage} />
          </label>
        )}
        {uploading && (
          <div className="flex items-center gap-2 text-sm text-blue-600 mb-2">
            <div className="w-4 h-4 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
            Uploading and moderating...
          </div>
        )}
        {uploadError && <div className="bg-red-50 text-red-600 text-xs px-3 py-2 rounded-lg mb-2">{uploadError}</div>}
      </div>

      {/* Product Details */}
      <Field label="Seller">
        <Select value={form.seller_id} onChange={set('seller_id')}>
          {sellers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
      </Field>
      <Field label="Product Title">
        <Input value={form.title} onChange={set('title')} placeholder="e.g. Trail Running Shoe X1" />
      </Field>
      <Field label="Description">
        <Textarea value={form.description} onChange={set('description')} placeholder="Product description..." rows={3} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Price ($)">
          <Input value={form.price} onChange={set('price')} type="number" step="0.01" placeholder="99.99" />
        </Field>
        <Field label="Currency">
          <Select value={form.currency} onChange={set('currency')}>
            <option>USD</option><option>EUR</option><option>GBP</option>
          </Select>
        </Field>
      </div>
      <Field label="Category">
        <Select value={form.category} onChange={set('category')}>
          {CATEGORIES.map(c => <option key={c}>{c}</option>)}
        </Select>
      </Field>
      <Field label="Product URL (buyers click Shop Now to visit)">
        <Input value={form.product_url} onChange={set('product_url')} placeholder="https://yoursite.com/product" />
      </Field>
      <div className="flex gap-3 mt-6">
        <Button onClick={() => onSave(form)} className="flex-1">Save Product</Button>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
      </div>
    </>
  );
}

// ── Main Products Page ────────────────────────────────────────
export default function Products() {
  const [products, setProducts] = useState([]);
  const [sellers, setSellers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState('All');
  const [modal, setModal] = useState(null);
  const [uploadProduct, setUploadProduct] = useState(null);

  const load = () => Promise.all([api.getProducts(), api.getSellers()])
    .then(([p, s]) => { setProducts(p); setSellers(s); })
    .finally(() => setLoading(false));

  useEffect(() => { load(); }, []);

  const handleSave = async (form) => {
    if (modal === 'create') await api.createProduct(form);
    else await api.updateProduct(modal.id, form);
    setModal(null);
    load();
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this product?')) return;
    await api.deleteProduct(id);
    load();
  };

  const categories = ['All', ...new Set(products.map(p => p.category).filter(Boolean))];

  const filtered = products.filter(p => {
    const matchSearch = p.title.toLowerCase().includes(search.toLowerCase()) ||
      (p.seller_name || '').toLowerCase().includes(search.toLowerCase());
    const matchCategory = filterCategory === 'All' || p.category === filterCategory;
    return matchSearch && matchCategory;
  });

  const columns = [
    {
      key: 'title', label: 'Product', render: (v, row) => (
        <div className="flex items-center gap-3">
          {row.image_url
            ? <img src={`${row.image_url}?t=${row.updated_at}`} alt=""
              className="w-10 h-10 rounded-lg object-contain bg-slate-50 shrink-0" />
            : <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center text-lg shrink-0">📦</div>
          }
          <div>
            <div className="font-medium text-slate-800">{v}</div>
            <div className="text-xs text-slate-400">{row.seller_name}</div>
          </div>
        </div>
      )
    },
    { key: 'category', label: 'Category', render: v => <Badge>{v}</Badge> },
    { key: 'price', label: 'Price', render: v => <span className="font-mono font-medium text-slate-800">${parseFloat(v).toFixed(2)}</span> },
    {
      key: 'product_url', label: 'URL', sortable: false, render: v => v
        ? <span className="text-green-600 text-xs">✅ Set</span>
        : <span className="text-slate-400 text-xs">Not set</span>
    },
    { key: 'status', label: 'Status', render: v => <Badge variant={v}>{v}</Badge> },
    {
      key: 'id', label: 'Image', sortable: false, render: (v, row) => (
        <button onClick={(e) => { e.stopPropagation(); setUploadProduct(row); }}
          className="text-blue-500 hover:text-blue-700 text-sm font-medium transition-colors">
          {row.image_url ? '🔄 Replace' : '📤 Upload'}
        </button>
      )
    },
  ];

  return (
    <div>
      <PageHeader
        title="Products"
        subtitle={`${products.length} total`}
        action={<Button onClick={() => setModal('create')}>+ Add Product</Button>}
      />

      <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex gap-3 flex-wrap">
          <div className="flex-1 min-w-48">
            <SearchBar value={search} onChange={setSearch} placeholder="Search products or sellers..." />
          </div>
          <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)}
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            {categories.map(c => <option key={c}>{c}</option>)}
          </select>
        </div>
        {loading ? <Spinner /> : (
          <Table columns={columns} data={filtered} onEdit={setModal} onDelete={handleDelete} />
        )}
      </div>

      {modal && (
        <Modal title={modal === 'create' ? 'Add New Product' : `Edit ${modal.title}`} onClose={() => setModal(null)}>
          <ProductForm initial={modal === 'create' ? {} : modal} sellers={sellers} onSave={handleSave} onClose={() => setModal(null)} onImageUploaded={load} />
        </Modal>
      )}

      {uploadProduct && (
        <ProductImageModal product={uploadProduct} onClose={() => setUploadProduct(null)} onUploaded={load} />
      )}
    </div>
  );
}
