import { useEffect, useState } from 'react';

const BASE = process.env.REACT_APP_API_URL || 'http://localhost:3001';

function getDeviceId() {
  let id = localStorage.getItem('buyer_device_id');
  if (!id) {
    id = 'web_' + Math.random().toString(36).substr(2, 16);
    localStorage.setItem('buyer_device_id', id);
  }
  return id;
}

function logAdClick(ad) {
  fetch(`${BASE}/api/buyer/click`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ad_id: ad.id }),
  }).catch(err => console.error('Click logging failed:', err));
}

// Shared helper — add this once near the top of the file, above AdCard
function getAdImageUrl(ad) {
  // Never use media_url directly for video ads (it's an .mp4, not an image)
  if (ad.thumbnail_url) return ad.thumbnail_url;
  if (ad.format === 'video') return ad.product_image_url || null;
  return ad.media_url || ad.product_image_url || null;
}

// ── Ad Card ───────────────────────────────────────────────────
function AdCard({ ad, onClick }) {
  const tags = Array.isArray(ad.intent_tags)
    ? ad.intent_tags
    : (() => { try { return JSON.parse(ad.intent_tags); } catch { return []; } })();

  const imageUrl = getAdImageUrl(ad);

  return (
    <div onClick={() => onClick(ad)} style={{ cursor: 'pointer', background: 'white', borderRadius: '16px', border: '1px solid #e2e8f0', overflow: 'hidden', transition: 'all 0.15s', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}
      onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 8px 24px rgba(37,99,235,0.12)'; e.currentTarget.style.borderColor = '#93c5fd'; }}
      onMouseLeave={e => { e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.05)'; e.currentTarget.style.borderColor = '#e2e8f0'; }}>
      {imageUrl && (
        <div style={{ position: 'relative' }}>
          <img src={`${imageUrl}?t=${ad.updated_at || ''}`} alt={ad.headline}
            style={{ width: '100%', height: '160px', objectFit: 'contain', background: '#f8fafc', display: 'block' }} />
          {ad.format === 'video' && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.2)' }}>
              <div style={{ width: '48px', height: '48px', background: 'rgba(255,255,255,0.9)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px' }}>▶</div>
            </div>
          )}
        </div>
      )}
      <div style={{ padding: '14px' }}>
        <div style={{ fontSize: '11px', color: '#16a34a', fontWeight: '600', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
          <span>Sponsored · {ad.seller_name}</span>
          {ad.seller_verified && <span style={{ background: '#dcfce7', color: '#16a34a', fontSize: '10px', padding: '1px 6px', borderRadius: '99px' }}>✅ Verified</span>}
          {ad.seller_location && <span style={{ color: '#94a3b8', fontSize: '10px' }}>📍 {ad.seller_location}</span>}
        </div>
        <div style={{ fontSize: '14px', fontWeight: '700', color: '#1e293b', marginBottom: '4px', lineHeight: 1.3 }}>{ad.headline}</div>
        <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '10px', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{ad.body_copy}</div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: '16px', fontWeight: '700', color: '#2563eb' }}>${parseFloat(ad.price || 0).toFixed(2)}</span>
          {ad.relevance_score && (
            <span style={{ fontSize: '11px', background: '#eff6ff', color: '#2563eb', padding: '2px 8px', borderRadius: '99px', fontWeight: '600' }}>
              {Math.round(ad.relevance_score * 100)}% match
            </span>
          )}
        </div>
        <div style={{ marginTop: '8px', display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
          {tags.slice(0, 2).map(tag => (
            <span key={tag} style={{ fontSize: '10px', background: '#f1f5f9', color: '#64748b', padding: '2px 6px', borderRadius: '99px' }}>#{tag}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Ad List Row ───────────────────────────────────────────────
function AdListRow({ ad, rank, onClick }) {
  const imageUrl = getAdImageUrl(ad);

  return (
    <div onClick={() => onClick(ad)} style={{ cursor: 'pointer', background: 'white', borderRadius: '12px', border: '1px solid #e2e8f0', padding: '14px', display: 'flex', gap: '14px', transition: 'all 0.15s' }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = '#93c5fd'; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = '#e2e8f0'; }}>
      <span style={{ color: '#cbd5e1', fontWeight: '700', fontSize: '16px', width: '24px', flexShrink: 0 }}>#{rank}</span>
      {imageUrl && (
        <img src={`${imageUrl}?t=${ad.updated_at || ''}`} alt=""
          style={{ width: '60px', height: '60px', objectFit: 'contain', borderRadius: '10px', background: '#f8fafc', flexShrink: 0 }} />
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontWeight: '600', fontSize: '14px', color: '#1e293b' }}>{ad.headline}</div>
            <div style={{ fontSize: '11px', color: '#94a3b8' }}>{ad.seller_name} · {ad.product_title}</div>
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={{ fontWeight: '700', color: '#2563eb' }}>${parseFloat(ad.price || 0).toFixed(2)}</div>
            {ad.relevance_score && <div style={{ fontSize: '11px', color: '#16a34a' }}>{Math.round(ad.relevance_score * 100)}% match</div>}
          </div>
        </div>
        <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{ad.body_copy}</div>
      </div>
    </div>
  );
}

// ── Ad Detail Modal ───────────────────────────────────────────
function AdModal({ ad, onClose }) {
  const tags = Array.isArray(ad.intent_tags)
    ? ad.intent_tags
    : (() => { try { return JSON.parse(ad.intent_tags); } catch { return []; } })();

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: 'white', borderRadius: '24px', width: '100%', maxWidth: '480px', maxHeight: '90vh', overflowY: 'auto' }}>
        {(ad.media_url || ad.thumbnail_url || ad.product_image_url) && (
          <div style={{ position: 'relative' }}>
            {ad.format === 'video' && ad.media_url ? (
              <video src={ad.media_url} controls autoPlay muted playsInline
                style={{ width: '100%', height: '240px', objectFit: 'contain', background: '#000', borderRadius: '24px 24px 0 0', display: 'block' }} />
            ) : (
              <img src={`${ad.media_url || ad.thumbnail_url || ad.product_image_url}?t=${ad.updated_at || ''}`} alt={ad.headline}
                style={{ width: '100%', height: '240px', objectFit: 'contain', background: '#f8fafc', borderRadius: '24px 24px 0 0', display: 'block' }} />
            )}
            <button onClick={onClose} style={{ position: 'absolute', top: '12px', right: '12px', background: 'rgba(255,255,255,0.9)', border: 'none', borderRadius: '50%', width: '32px', height: '32px', cursor: 'pointer', fontSize: '18px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
          </div>
        )}
        <div style={{ padding: '24px' }}>
          {!ad.media_url && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '16px' }}>
              <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: '#94a3b8' }}>✕</button>
            </div>
          )}
          <div style={{ fontSize: '11px', color: '#16a34a', fontWeight: '600', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span>Sponsored · {ad.seller_name}</span>
            {ad.seller_verified && <span style={{ background: '#dcfce7', color: '#16a34a', fontSize: '10px', padding: '2px 8px', borderRadius: '99px' }}>✅ Verified Seller</span>}
            {ad.seller_location && <span style={{ color: '#64748b', fontSize: '11px' }}>📍 {ad.seller_location}</span>}
          </div>
          <h2 style={{ fontSize: '22px', fontWeight: '700', color: '#1e293b', marginBottom: '8px' }}>{ad.headline}</h2>
          <p style={{ fontSize: '14px', color: '#64748b', marginBottom: '20px', lineHeight: 1.6 }}>{ad.body_copy}</p>
          <div style={{ background: '#f8fafc', borderRadius: '16px', padding: '16px', marginBottom: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '14px' }}>
              <span style={{ color: '#64748b' }}>Product</span>
              <span style={{ fontWeight: '600' }}>{ad.product_title}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '14px' }}>
              <span style={{ color: '#64748b' }}>Category</span>
              <span style={{ fontWeight: '600' }}>{ad.category}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px' }}>
              <span style={{ color: '#64748b' }}>Price</span>
              <span style={{ fontWeight: '700', fontSize: '18px', color: '#2563eb' }}>${parseFloat(ad.price || 0).toFixed(2)}</span>
            </div>
          </div>
          {ad.relevance_score && (
            <div style={{ background: '#eff6ff', borderRadius: '12px', padding: '12px', marginBottom: '16px', display: 'flex', gap: '12px', alignItems: 'center' }}>
              <span style={{ fontSize: '24px' }}>🎯</span>
              <div>
                <div style={{ fontWeight: '600', color: '#1e40af', fontSize: '14px' }}>{Math.round(ad.relevance_score * 100)}% match to your search</div>
                <div style={{ fontSize: '12px', color: '#3b82f6' }}>Matched by AI based on your intent</div>
              </div>
            </div>
          )}
          {tags.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '20px' }}>
              {tags.map(tag => <span key={tag} style={{ background: '#f1f5f9', color: '#475569', fontSize: '12px', padding: '4px 12px', borderRadius: '99px' }}>#{tag}</span>)}
            </div>
          )}
          <button style={{ width: '100%', background: '#2563eb', color: 'white', border: 'none', borderRadius: '16px', padding: '14px', fontWeight: '700', fontSize: '16px', cursor: 'pointer' }}>
            Shop Now — ${parseFloat(ad.price || 0).toFixed(2)}
          </button>
          <button onClick={onClose} style={{ width: '100%', background: 'none', border: 'none', color: '#94a3b8', fontSize: '14px', padding: '12px', cursor: 'pointer', marginTop: '8px' }}>
            Continue browsing
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Buyer Landing Page ───────────────────────────────────
export default function BuyerLanding() {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [categories, setCategories] = useState([]);
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [selected, setSelected] = useState(null);
  const deviceId = getDeviceId();

  const doSearch = async (q, cat) => {
    if (!q && !cat) return;
    setLoading(true);
    setSearched(true);
    try {
      const res = await fetch(`${BASE}/api/buyer/semantic-match`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q, category: cat, device_id: deviceId, limit: 12 }),
      });
      const data = await res.json();
      setMatches(data.matches || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const loadInitial = async () => {
    setLoading(true);
    setSearched(true);
    try {
      // Build page context, but ignore it if it's just our own app's title with no referrer
      const rawTitle = document.title || '';
      const referrer = document.referrer || '';
      const isGenericOwnTitle = rawTitle.includes('PinkCurve') && referrer === '';

      let pageContext = isGenericOwnTitle ? '' : [rawTitle, referrer].join(' ').trim();

      if (!pageContext) {
        try {
          const catRes = await fetch(`${BASE}/api/buyer/categories`);
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

      // Featured (top bidders) + semantic from page context
      const [featuredRes, semanticRes] = await Promise.all([
        fetch(`${BASE}/api/buyer/featured`),
        fetch(`${BASE}/api/buyer/semantic-match`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: pageContext,
            device_id: deviceId,
            limit: 8,
          }),
        }),
      ]);
      const featured = await featuredRes.json();
      const semantic = await semanticRes.json();
      const featuredIds = new Set((featured || []).map(a => a.id));
      const deduped = (semantic.matches || []).filter(a => !featuredIds.has(a.id));
      const featuredWithScore = (featured || []).map((ad, i) => ({ ...ad, relevance_score: 1.0, rank_position: i + 1, is_featured: true }));
      setMatches([...featuredWithScore, ...deduped]);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };


  useEffect(() => {
    fetch(`${BASE}/api/buyer/categories`)
      .then(r => r.json())
      .then(setCategories)
      .catch(() => { });
    loadInitial();
  }, []);

  const handleCategory = (cat) => {
    const newCat = cat === category ? '' : cat;
    setCategory(newCat);
    doSearch(query, newCat);
  };

  const featured = matches.slice(0, 4);
  const rest = matches.slice(4);

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #f8fafc 0%, #eff6ff 100%)' }}>

      {/* Top nav */}
      <nav style={{ background: 'white', borderBottom: '1px solid #f1f5f9', padding: '14px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <span style={{ fontSize: '18px', fontWeight: '700', background: 'linear-gradient(135deg, #ec4899, #a855f7)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', fontFamily: '"DM Serif Display", serif' }}>PinkCurve</span>
          <span style={{ fontSize: '11px', color: '#94a3b8', marginLeft: '8px' }}>by Peter Kao Associates</span>
        </div>
        <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
          <a href="/login" style={{
            fontSize: '13px',
            color: '#ec4899',
            textDecoration: 'none',
            fontWeight: '600',
            border: '2px solid #ec4899',
            padding: '8px 16px',
            borderRadius: '8px',
            transition: 'all 0.2s'
          }}>
            🏪 Seller Portal
          </a>
          <a href="/register" style={{
            fontSize: '13px',
            color: 'white',
            textDecoration: 'none',
            fontWeight: '600',
            background: 'linear-gradient(135deg, #ec4899, #a855f7)',
            padding: '8px 16px',
            borderRadius: '8px'
          }}>
            Start Selling →
          </a>
        </div>
      </nav>

      {/* Hero search */}
      <div style={{ background: 'linear-gradient(135deg, #2563eb, #4338ca)', padding: '56px 24px', textAlign: 'center' }}>
        <div style={{ maxWidth: '640px', margin: '0 auto' }}>
          <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: '13px', marginBottom: '10px' }}>
            🔒 Your device context · Anonymous matching · No identity stored
          </div>
          <h1 style={{ color: 'white', fontSize: '36px', fontWeight: '700', marginBottom: '10px', fontFamily: '"DM Serif Display", serif', lineHeight: 1.2 }}>
            The right product ad, at the right moment
          </h1>
          <p style={{ color: '#bfdbfe', fontSize: '15px', marginBottom: '28px', lineHeight: 1.6 }}>
            Our AI reads your browsing history and interests on your device to match you with sellers who have exactly what you need — before you even search. Discover trending products, new arrivals and video ads. Your personal data never leaves your device.
          </p>
          {/* Search bar */}
          <div style={{ display: 'flex', gap: '8px', background: 'white', borderRadius: '16px', padding: '8px' }}>
            <input value={query} onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && doSearch(query, category)}
              placeholder="What are you looking for? e.g. trail running shoes, espresso machine..."
              style={{ flex: 1, border: 'none', outline: 'none', padding: '10px 14px', fontSize: '14px', color: '#334155', borderRadius: '10px' }} />
            <button onClick={() => doSearch(query, category)} disabled={loading}
              style={{ background: '#2563eb', color: 'white', border: 'none', borderRadius: '10px', padding: '10px 24px', fontWeight: '600', cursor: 'pointer', fontSize: '14px', opacity: loading ? 0.6 : 1 }}>
              {loading ? '⏳' : '🔍 Search'}
            </button>
          </div>
        </div>
      </div>

      {/* How it works banner */}
      <div style={{ background: 'white', borderBottom: '1px solid #f1f5f9', padding: '16px 24px' }}>
        <div style={{ maxWidth: '900px', margin: '0 auto', display: 'flex', justifyContent: 'center', gap: '48px', flexWrap: 'wrap' }}>
          {[
            { icon: '📱', text: 'Reads your device context' },
            { icon: '🔒', text: 'Personal data stays on device' },
            { icon: '🎯', text: 'Matched to sellers who have what you need' },
            { icon: '🎬', text: 'Discover, explore and be inspired' },
          ].map(item => (
            <div key={item.text} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: '#475569' }}>
              <span style={{ fontSize: '18px' }}>{item.icon}</span>
              <span>{item.text}</span>
            </div>
          ))}
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
                <button key={c.category} onClick={() => handleCategory(c.category)}
                  style={{
                    padding: '8px 16px', borderRadius: '12px', fontSize: '13px', fontWeight: '500', cursor: 'pointer', transition: 'all 0.15s',
                    border: category === c.category ? '1px solid #2563eb' : '1px solid #e2e8f0',
                    background: category === c.category ? '#2563eb' : 'white',
                    color: category === c.category ? 'white' : '#475569',
                  }}>
                  {c.category} <span style={{ opacity: 0.6, fontSize: '11px' }}>{c.ad_count}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div style={{ textAlign: 'center', padding: '64px 0' }}>
            <div style={{ width: '40px', height: '40px', border: '4px solid #bfdbfe', borderTopColor: '#2563eb', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 16px' }} />
            <div style={{ color: '#94a3b8', fontSize: '14px' }}>AI is finding the best matches for you...</div>
          </div>
        )}

        {/* Results */}
        {!loading && searched && matches.length > 0 && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
              <div style={{ fontSize: '14px', color: '#64748b' }}>
                <strong style={{ color: '#1e293b' }}>{matches.length} products</strong> found
                {query && <span> for "<span style={{ color: '#2563eb' }}>{query}</span>"</span>}
              </div>
              <div style={{ fontSize: '12px', color: '#94a3b8' }}>🤖 Ranked by AI relevance</div>
            </div>

            {/* Featured grid */}
            {featured.length > 0 && (
              <>
                <div style={{ fontSize: '11px', fontWeight: '600', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '14px' }}>
                  {query ? '⭐ Top matches' : '⭐ Featured Products'}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '32px' }}>
                  {featured.map(ad => <AdCard key={ad.id} ad={ad} onClick={(ad) => { logAdClick(ad); setSelected(ad); }} />)}
                </div>
              </>
            )}

            {/* List */}
            {rest.length > 0 && (
              <>
                <div style={{ fontSize: '11px', fontWeight: '600', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '14px' }}>
                  {query ? 'More results' : '🎯 Recommended for you'}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {rest.map((ad, i) => <AdListRow key={ad.id} ad={ad} rank={i + 5} onClick={(ad) => { logAdClick(ad); setSelected(ad); }} />)}
                </div>
              </>
            )}
          </>
        )}

        {/* No results */}
        {!loading && searched && matches.length === 0 && (
          <div style={{ textAlign: 'center', padding: '64px 0' }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>🔍</div>
            <div style={{ color: '#94a3b8', fontSize: '14px' }}>No matches found — try a different search or browse by category</div>
          </div>
        )}
      </div>

      {/* Footer */}
      <footer style={{ background: 'white', borderTop: '1px solid #f1f5f9', padding: '32px 24px', textAlign: 'center', marginTop: '48px' }}>
        <div style={{ marginBottom: '16px' }}>
          <span style={{ fontSize: '14px', color: '#64748b' }}>Are you a seller? </span>
          <a href="/login" style={{ fontSize: '14px', color: '#ec4899', textDecoration: 'none', fontWeight: '600' }}>Sign in here</a>
          <span style={{ fontSize: '14px', color: '#64748b' }}> or </span>
          <a href="/register" style={{ fontSize: '14px', color: '#ec4899', textDecoration: 'none', fontWeight: '600' }}>create an account →</a>
        </div>
        <div style={{ fontSize: '12px', color: '#94a3b8' }}>
          <strong style={{ background: 'linear-gradient(135deg, #ec4899, #a855f7)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>PinkCurve</strong>
          <span> by Peter Kao Associates · Intent-driven · Privacy-first · Trusted</span>
        </div>
      </footer>

      {/* Ad detail modal */}
      {selected && <AdModal ad={selected} onClose={() => setSelected(null)} />}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
