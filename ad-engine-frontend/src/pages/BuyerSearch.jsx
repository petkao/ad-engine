import { useEffect, useState } from 'react';

//const BASE = 'http://localhost:3001';
const BASE = process.env.REACT_APP_API_URL || 'http://localhost:3001';

function getDeviceId() {
  let id = localStorage.getItem('buyer_device_id');
  if (!id) {
    id = 'web_' + Math.random().toString(36).substr(2, 16);
    localStorage.setItem('buyer_device_id', id);
  }
  return id;
}

function AdCard({ ad, onClick }) {
  const tags = Array.isArray(ad.intent_tags)
    ? ad.intent_tags
    : (() => { try { return JSON.parse(ad.intent_tags); } catch { return []; } })();

  const imageUrl = getAdImageUrl(ad);

  return (
    <div onClick={() => onClick(ad)}
      style={{ cursor: 'pointer' }}
      className="bg-white rounded-2xl border border-slate-100 shadow-sm hover:shadow-md transition-all">
      {imageUrl && (
        <div style={{ position: 'relative' }}>
          <img
            src={imageUrl}
            alt={ad.headline}
            style={{ width: '100%', height: '140px', objectFit: 'contain', borderRadius: '16px 16px 0 0', display: 'block' }}
          />
          {ad.format === 'video' && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.2)', borderRadius: '16px 16px 0 0' }}>
              <div style={{ width: '40px', height: '40px', background: 'rgba(255,255,255,0.9)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px' }}>▶</div>
            </div>
          )}
        </div>
      )}
      <div className="p-4">
        <div className="text-xs text-green-600 font-medium mb-1">Sponsored · {ad.seller_name}</div>
        <div className="font-bold text-slate-800 mb-1" style={{ fontSize: '14px' }}>{ad.headline}</div>
        <div className="text-slate-500 mb-2" style={{ fontSize: '12px', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{ad.body_copy}</div>
        <div className="flex items-center justify-between">
          <span className="font-bold text-blue-600">${parseFloat(ad.price || 0).toFixed(2)}</span>
          {ad.relevance_score && (
            <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">
              {Math.round(ad.relevance_score * 100)}% match
            </span>
          )}
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          {tags.slice(0, 2).map(tag => (
            <span key={tag} className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">#{tag}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

function getAdImageUrl(ad) {
  if (ad.thumbnail_url) return ad.thumbnail_url;
  if (ad.format === 'video') return ad.product_image_url || null;
  return ad.media_url || ad.product_image_url || null;
}

function AdListRow({ ad, rank, onClick }) {
  const imageUrl = getAdImageUrl(ad);

  return (
    <div onClick={() => onClick(ad)}
      style={{ cursor: 'pointer' }}
      className="bg-white rounded-xl border border-slate-100 p-4 flex gap-4 hover:border-blue-200 transition-all">
      <span className="text-slate-300 font-bold text-lg w-6 shrink-0">#{rank}</span>
      {
        imageUrl && (
          <img src={imageUrl} alt=""
            style={{ width: '56px', height: '56px', objectFit: 'contain', borderRadius: '10px', flexShrink: 0 }} />
        )
      }
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="font-semibold text-slate-800" style={{ fontSize: '14px' }}>{ad.headline}</div>
            <div className="text-slate-400" style={{ fontSize: '12px' }}>{ad.seller_name} · {ad.product_title}</div>
          </div>
          <div className="text-right shrink-0">
            <div className="font-bold text-blue-600">${parseFloat(ad.price || 0).toFixed(2)}</div>
            {ad.relevance_score && (
              <div className="text-xs text-green-600">{Math.round(ad.relevance_score * 100)}% match</div>
            )}
          </div>
        </div>
        <div className="text-slate-500 mt-1" style={{ fontSize: '12px', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{ad.body_copy}</div>
      </div>
    </div >
  );
}


function AdDetail({ ad, onClose }) {
  const tags = Array.isArray(ad.intent_tags)
    ? ad.intent_tags
    : (() => { try { return JSON.parse(ad.intent_tags); } catch { return []; } })();

  const isVideo = ad.format === 'video' && ad.media_url;
  const imageUrl = !isVideo ? getAdImageUrl(ad) : null;
  const hasMedia = isVideo || imageUrl;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
      <div style={{ background: 'white', borderRadius: '24px', width: '100%', maxWidth: '480px', maxHeight: '90vh', overflowY: 'auto' }}>
        {hasMedia && (
          <div style={{ position: 'relative' }}>
            {isVideo ? (
              <video
                src={ad.media_url}
                poster={ad.thumbnail_url || undefined}
                controls
                autoPlay
                style={{ width: '100%', height: '240px', objectFit: 'contain', borderRadius: '24px 24px 0 0', display: 'block', background: '#000' }}
              />
            ) : (
              <img src={imageUrl} alt={ad.headline}
                style={{ width: '100%', height: '240px', objectFit: 'contain', borderRadius: '24px 24px 0 0', display: 'block' }} />
            )}
            <button onClick={onClose}
              style={{ position: 'absolute', top: '12px', right: '12px', background: 'rgba(255,255,255,0.9)', border: 'none', borderRadius: '50%', width: '32px', height: '32px', cursor: 'pointer', fontSize: '16px' }}>
              ✕
            </button>
          </div>
        )}
        <div className="p-6">
          {!hasMedia && (
            <div className="flex justify-end mb-4">
              <button onClick={onClose} className="text-slate-400 text-xl">✕</button>
            </div>
          )}
          <div className="text-xs text-green-600 font-medium mb-1">Sponsored · {ad.seller_name}</div>
          <h2 className="text-xl font-bold text-slate-800 mb-2">{ad.headline}</h2>
          <p className="text-slate-600 mb-4 text-sm">{ad.body_copy}</p>
          <div className="bg-slate-50 rounded-xl p-4 mb-4 space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-slate-500">Product</span><span className="font-medium">{ad.product_title}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Category</span><span className="font-medium">{ad.category}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Price</span><span className="font-bold text-blue-600">${parseFloat(ad.price || 0).toFixed(2)}</span></div>
          </div>
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-4">
              {tags.map(tag => (
                <span key={tag} className="bg-slate-100 text-slate-600 text-xs px-3 py-1 rounded-full">#{tag}</span>
              ))}
            </div>
          )}

          {ad.product_url ? (
            <a href={ad.product_url} target="_blank" rel="noreferrer"
              style={{ display: 'block', width: '100%', background: '#2563eb', color: 'white', border: 'none', borderRadius: '16px', padding: '14px', fontWeight: '700', fontSize: '16px', cursor: 'pointer', textDecoration: 'none', textAlign: 'center', boxSizing: 'border-box' }}>
              Shop Now — ${parseFloat(ad.price || 0).toFixed(2)} →
            </a>
          ) : (
            <button style={{ width: '100%', background: '#94a3b8', color: 'white', border: 'none', borderRadius: '16px', padding: '14px', fontWeight: '700', fontSize: '16px', cursor: 'not-allowed' }}>
              Shop Now — ${parseFloat(ad.price || 0).toFixed(2)} (URL not set)
            </button>
          )}
          <button onClick={onClose} className="w-full mt-3 text-slate-400 text-sm py-2">
            Continue browsing
          </button>
        </div>
      </div>
    </div>
  );
}


export default function BuyerSearch() {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [categories, setCategories] = useState([]);
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState('');
  const deviceId = getDeviceId();

  const handleSearch = async (q, cat) => {
    const searchQ = q !== undefined ? q : query;
    const searchCat = cat !== undefined ? cat : category;
    if (!searchQ && !searchCat) return;
    setLoading(true);
    setError('');
    setSearched(true);
    try {
      const res = await fetch(`${BASE}/api/buyer/semantic-match`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}`,
        },
        body: JSON.stringify({ query: searchQ, category: searchCat, device_id: deviceId, limit: 12 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setMatches(data.matches || []);
    } catch (err) {
      setError(err.message || 'Search failed');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Load categories
    fetch(`${BASE}/api/buyer/categories`, {
      headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}` }
    })
      .then(r => r.json())
      .then(setCategories)
      .catch(() => { });

    // Load featured ads (top by bid) + semantic from page context
    const loadInitialAds = async () => {
      setLoading(true);
      setSearched(true);
      try {
        // Get top 4 by cost_per_match
        const featuredRes = await fetch(`${BASE}/api/buyer/featured`, {
          headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}` }
        });
        const featuredData = await featuredRes.json();
        const featured = (featuredData || []).map((ad, i) => ({
          ...ad,
          relevance_score: 1.0,
          rank_position: i + 1,
          is_featured: true,
        }));

        const referrer = document.referrer || '';
        const rawTitle = document.title || '';
        const isGenericOwnTitle = rawTitle.includes('PinkCurve') && referrer === '';

        let pageContext = '';
        if (!isGenericOwnTitle) {
          pageContext = [
            rawTitle,
            referrer.replace(/https?:\/\//, '').replace(/[\/\-_?=&]/g, ' '),
          ].join(' ').trim();
        }

        if (!pageContext) {
          try {
            const catRes = await fetch(`${BASE}/api/buyer/categories`, {
              headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}` }
            });
            const cats = await catRes.json();
            if (Array.isArray(cats) && cats.length > 0) {
              const randomCat = cats[Math.floor(Math.random() * cats.length)];
              pageContext = randomCat.category;
            }
          } catch (e) {
            // fall through to hardcoded default below
          }
        }

        if (!pageContext) pageContext = 'popular products';

        const semanticRes = await fetch(`${BASE}/api/buyer/semantic-match`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}`,
          },
          body: JSON.stringify({ query: pageContext, limit: 8, device_id: getDeviceId() }),
        });
        const semanticData = await semanticRes.json();
        const semantic = (semanticData.matches || []).map((ad, i) => ({
          ...ad,
          rank_position: featured.length + i + 1,
        }));

        // Combine — featured first, then semantic (deduplicated)
        const featuredIds = new Set(featured.map(a => a.id));
        const deduped = semantic.filter(a => !featuredIds.has(a.id));
        setMatches([...featured, ...deduped]);
      } catch (err) {
        console.error('Initial load error:', err);
      } finally {
        setLoading(false);
      }
    };

    loadInitialAds();
  }, []);

  const handleCategoryClick = (cat) => {
    const newCat = cat === category ? '' : cat;
    setCategory(newCat);
    handleSearch(query, newCat);
  };

  const featured = matches.slice(0, 4);
  const rest = matches.slice(4);

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #f8fafc 0%, #eff6ff 100%)' }}>

      {/* Search hero */}
      <div style={{ background: 'linear-gradient(135deg, #2563eb, #4338ca)', padding: '48px 24px', textAlign: 'center' }}>
        <div style={{ maxWidth: '600px', margin: '0 auto' }}>
          <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: '13px', marginBottom: '8px' }}>🔒 Privacy-first · No tracking</div>
          <h1 style={{ color: 'white', fontSize: '28px', fontWeight: 'bold', marginBottom: '8px', fontFamily: '"DM Serif Display", serif' }}>
            Find exactly what you need
          </h1>
          <p style={{ color: '#bfdbfe', fontSize: '14px', marginBottom: '24px' }}>
            AI matches your intent to the most relevant products
          </p>
          <div style={{ display: 'flex', gap: '8px', background: 'white', borderRadius: '16px', padding: '8px' }}>
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
              placeholder="What are you looking for? e.g. trail running shoes..."
              style={{ flex: 1, border: 'none', outline: 'none', padding: '8px 12px', fontSize: '14px', color: '#334155', borderRadius: '10px' }}
            />
            <button onClick={() => handleSearch()} disabled={loading}
              style={{ background: '#2563eb', color: 'white', border: 'none', borderRadius: '10px', padding: '8px 20px', fontWeight: '600', cursor: 'pointer', fontSize: '14px', opacity: loading ? 0.6 : 1 }}>
              {loading ? '⏳' : '🔍 Search'}
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '32px 24px' }}>

        {/* Category pills */}
        {categories.length > 0 && (
          <div style={{ marginBottom: '32px' }}>
            <div style={{ fontSize: '11px', fontWeight: '600', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '12px' }}>
              Browse by category
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {categories.map(c => (
                <button key={c.category} onClick={() => handleCategoryClick(c.category)}
                  style={{
                    padding: '8px 16px', borderRadius: '12px', fontSize: '13px', fontWeight: '500',
                    border: category === c.category ? '1px solid #2563eb' : '1px solid #e2e8f0',
                    background: category === c.category ? '#2563eb' : 'white',
                    color: category === c.category ? 'white' : '#475569',
                    cursor: 'pointer', transition: 'all 0.15s'
                  }}>
                  {c.category} <span style={{ opacity: 0.6, fontSize: '11px' }}>{c.ad_count}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '12px', padding: '16px', marginBottom: '24px', color: '#dc2626', fontSize: '14px' }}>
            {error}
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div style={{ textAlign: 'center', padding: '64px 0' }}>
            <div style={{ width: '40px', height: '40px', border: '4px solid #bfdbfe', borderTopColor: '#2563eb', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 16px' }} />
            <div style={{ color: '#94a3b8', fontSize: '14px' }}>AI is matching ads to your intent...</div>
          </div>
        )}

        {/* Results */}
        {!loading && searched && matches.length > 0 && (
          <>
            {/* Results header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
              <div style={{ fontSize: '14px', color: '#64748b' }}>
                <strong style={{ color: '#1e293b' }}>{matches.length} ads</strong> matched
                {query && <span> for "<span style={{ color: '#2563eb' }}>{query}</span>"</span>}
              </div>
              <div style={{ fontSize: '12px', color: '#94a3b8' }}>🤖 Ranked by GPT-4o mini</div>
            </div>

            {/* Featured grid */}
            {featured.length > 0 && (
              <>
                <div style={{ fontSize: '11px', fontWeight: '600', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '12px' }}>
                  ⭐ {searched && query ? 'Top matches' : 'Featured Ads'}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '32px' }}>
                  {featured.map(ad => (
                    <AdCard key={ad.id} ad={ad} onClick={setSelected} />
                  ))}
                </div>
              </>
            )}

            {/* List */}
            {rest.length > 0 && (
              <>
                <div style={{ fontSize: '11px', fontWeight: '600', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '12px' }}>
                  {searched && query ? 'More results' : '🎯 Recommended for you'}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {rest.map((ad, i) => (
                    <AdListRow key={ad.id} ad={ad} rank={i + 5} onClick={setSelected} />
                  ))}
                </div>
              </>
            )}
          </>
        )}

        {/* No results */}
        {!loading && searched && matches.length === 0 && (
          <div style={{ textAlign: 'center', padding: '64px 0' }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>🔍</div>
            <div style={{ color: '#94a3b8', fontSize: '14px' }}>No matches found — try a different search</div>
          </div>
        )}
      </div>

      {/* Ad detail modal */}
      {selected && <AdDetail ad={selected} onClose={() => setSelected(null)} />}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
