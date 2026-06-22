# PinkCurve — AI-Powered Ad Platform

> **Bridge the gap between sellers and buyers through intent-driven, privacy-first AI ad matching.**

Built by Peter Kao Associates · San Jose, CA

---

## Vision

Most online ads miss because they guess what buyers want. PinkCurve reads the buyer's real browsing context and life signals — privately on their device — and matches them with sellers who have exactly what they need, before they even search for it.

**For sellers:** Stop paying for ads that miss. Reach buyers who already need your product — through their real life context, not keyword guessing. Pay only when matched to a genuinely interested buyer.

**For buyers:** Discover products matched to your life — not your identity. Browse entertaining video ads, new arrivals and trending products. Your personal data never leaves your device.

---

## Live Production URLs

| Service | URL |
|---|---|
| Buyer Search (public) | https://ad-engine-4da45.web.app/search |
| Seller Portal | https://ad-engine-4da45.web.app |
| API (Cloud Run) | https://ad-engine-api-610270819686.us-west1.run.app |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + Tailwind CSS |
| Backend | Node.js + Express + Passport.js |
| Database | PostgreSQL 14 + pgvector 0.8.0 |
| AI/LLM | OpenAI (GPT-4o mini, gpt-image-1, text-embedding-3-small) |
| Storage | Google Cloud Storage |
| Hosting | Firebase Hosting + Cloud Run |
| Auth | JWT tokens |

---

## LLM Workflow — 5 AI Calls

PinkCurve uses 5 distinct LLM/AI calls across the buyer and seller flows:

### LLM Call Details

| # | Model | Route/Function | File | Purpose |
|---|---|---|---|---|
| 1 | GPT-4o mini | POST /api/extension/semantic-match | server.js | Extract intent keywords from buyer's page context |
| 2 | text-embedding-3-small | semanticSearch() | server.js | Convert buyer intent query to 1536-dim vector |
| 3 | GPT-4o mini (vision) | moderateImage() | server.js | Moderate seller-uploaded images before going live |
| 4 | text-embedding-3-small | generate-embeddings.js | generate-embeddings.js | Convert ad headline+tags to vector stored in pgvector |
| 5 | gpt-image-1 | POST /api/ads/:id/generate-image | server.js | Generate ad image from product description |

---

## File Structure

```
ad-engine/
├── ad-engine-api/
│   ├── server.js                  # Main Express API (~1300 lines)
│   ├── generate-embeddings.js     # Batch embedding generator (LLM #4)
│   ├── migrate-images-to-gcs.js   # GCS migration script
│   ├── bulk-generate-images.js    # Bulk DALL-E image generator
│   ├── package.json
│   ├── Dockerfile
│   └── .env.production
│
└── ad-engine-frontend/
    ├── public/
    │   └── index.html             # PinkCurve title + Tailwind CDN
    └── src/
        ├── App.js                 # Routes + sidebar + PinkCurve branding
        ├── auth/
        │   └── AuthContext.jsx    # JWT auth, localStorage
        ├── api/
        │   └── client.js          # Bearer token headers
        └── pages/
            ├── BuyerLanding.jsx   # PUBLIC buyer page at /search
            ├── BuyerSearch.jsx    # Seller-side buyer search demo
            ├── Dashboard.jsx      # Role-aware: Admin / Seller dashboard
            ├── Analytics.jsx      # Charts with JWT auth
            ├── Sellers.jsx        # Seller CRUD + location + verified
            ├── Products.jsx       # Product catalog + image upload
            ├── Ads.jsx            # Ad management + image/video upload
            ├── Buyers.jsx         # Admin-only buyer registry
            └── Login.jsx          # Auth page
```

---

## Database Schema (17 tables)

```sql
sellers          -- Business info, location, is_verified, business_registration
products         -- Title, price, category, image_url, product_url
ads              -- Headline, body_copy, format, media_url, thumbnail_url, status
ad_categories    -- Category taxonomy
ad_embeddings    -- vector(1536) for pgvector semantic search
product_embeddings
buyers           -- Anonymous buyer sessions
buyer_sessions
ad_matches       -- Match events (matched_at column, NOT created_at)
match_events
llm_match_logs
billing_transactions
seller_accounts  -- Login credentials + JWT, role (admin/seller)
session
ad_moderation_log
```

### Key SQL Patterns

```sql
-- Semantic search (cosine similarity)
SELECT a.*, 1 - (ae.embedding <=> $1::vector) as similarity_score
FROM ads a
JOIN ad_embeddings ae ON ae.ad_id = a.id
WHERE a.status = 'active'
ORDER BY similarity_score DESC
LIMIT 12;

-- pgvector index (lists=1 for small datasets < 100 rows)
CREATE INDEX idx_ad_embeddings_vec ON ad_embeddings
USING ivfflat (embedding vector_cosine_ops) WITH (lists = 1);

-- ad_matches uses matched_at NOT created_at
SELECT COUNT(*) FROM ad_matches
WHERE matched_at BETWEEN $1 AND $2;
```

---

## API Routes

### Auth
```
POST /auth/login          → { success, user, token }
POST /auth/register
GET  /auth/me
POST /auth/logout
```

### Buyer (Public — no auth required)
```
GET  /api/buyer/categories
GET  /api/buyer/featured        → Top 4 by cost_per_match
POST /api/buyer/semantic-match  → pgvector cosine search
POST /api/buyer/match           → GPT matching fallback
POST /api/buyer/click
```

### Seller (requireAuth + role filter)
```
GET/POST        /api/sellers
PUT/DELETE      /api/sellers/:id
GET/POST        /api/products         (filtered by seller_id for non-admin)
PUT/DELETE      /api/products/:id
POST            /api/products/:id/upload-image
GET/POST        /api/ads
PUT/DELETE      /api/ads/:id
POST            /api/ads/:id/generate-image   (gpt-image-1)
POST            /api/ads/:id/upload-image     (GPT-4o moderation)
POST            /api/ads/:id/upload-video     (multer + GCS)
```

### Admin Only
```
GET  /api/admin/pending-ads
POST /api/admin/ads/:id/approve
POST /api/admin/ads/:id/reject
GET  /api/buyers
```

### Analytics
```
GET /api/analytics/overview
GET /api/analytics/spend-trend
GET /api/analytics/top-sellers
GET /api/analytics/top-ads
GET /api/analytics/ads-by-format
GET /api/analytics/ads-by-category
GET /api/analytics/buyers-by-platform
GET /api/analytics/sellers-by-plan
GET /api/analytics/buyer-trend
GET /api/stats               → Role-aware (admin: all, seller: own)
```

---

## Role-Based Access Control

| Feature | Admin | Seller |
|---|---|---|
| See all sellers | Yes | Own only |
| See all products | Yes | Own only |
| See all ads | Yes | Own only |
| Buyers page | Yes | Hidden |
| Admin review queue | Yes | No |
| Buyer Search | Yes | Yes |

### JWT Token Structure
```javascript
{
  id: "seller_account_uuid",
  email: "seller@example.com",
  role: "admin" | "seller",
  seller_id: "seller_uuid",
  iat: ...,
  exp: ...   // 7 day expiry
}
```

---

## GCP Infrastructure

| Resource | Detail |
|---|---|
| Project | ad-engine-4da45 |
| Cloud Run | ad-engine-api, us-west1, 2Gi memory |
| Cloud SQL | ad-engine-4da45:us-west1:ad-engine-db (PostgreSQL 14) |
| Firebase Hosting | ad-engine-4da45.web.app |
| GCS Bucket | ad-engine-media-pka |
| Secret Manager | db-password, session-secret, openai-api-key, google-client-id, google-client-secret |

### Deployment Commands

```bash
# Build and push Docker image (ALWAYS use linux/amd64 for Cloud Run)
cd ~/ad-engine/ad-engine-api
docker buildx build --platform linux/amd64 \
  -t gcr.io/ad-engine-4da45/ad-engine-api:latest --push .

# Deploy to Cloud Run
gcloud run deploy ad-engine-api \
  --image gcr.io/ad-engine-4da45/ad-engine-api \
  --platform managed --region us-west1 --allow-unauthenticated \
  --add-cloudsql-instances ad-engine-4da45:us-west1:ad-engine-db \
  --set-env-vars "DB_HOST=/cloudsql/ad-engine-4da45:us-west1:ad-engine-db,DB_PORT=5432,DB_NAME=adengine,DB_USER=adengine,GCP_PROJECT_ID=ad-engine-4da45,GCP_BUCKET_NAME=ad-engine-media-pka,NODE_ENV=production,CLIENT_URL=https://ad-engine-4da45.web.app,GOOGLE_CALLBACK_URL=https://ad-engine-api-610270819686.us-west1.run.app/auth/google/callback" \
  --set-secrets "DB_PASSWORD=db-password:latest,SESSION_SECRET=session-secret:latest,OPENAI_API_KEY=openai-api-key:latest,GOOGLE_CLIENT_ID=google-client-id:latest,GOOGLE_CLIENT_SECRET=google-client-secret:latest" \
  --memory 2Gi --min-instances 0 --max-instances 10

# Deploy frontend
cd ~/ad-engine/ad-engine-frontend
npm run build && firebase deploy --only hosting

# Generate embeddings for production DB
DB_HOST=127.0.0.1 DB_PORT=5435 DB_NAME=adengine DB_USER=adengine \
  DB_PASSWORD='AdEngine2024!' node generate-embeddings.js

# Connect to production DB via Cloud SQL proxy (port 5435)
psql 'host=127.0.0.1 port=5435 dbname=adengine user=adengine password=AdEngine2024!'
```

---

## Critical Known Issues & Fixes

### 1. Missing imports after server.js replacement
Add directly after `const app = express();`:
```javascript
app.set('trust proxy', 1);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const storage = new Storage({ projectId: process.env.GCP_PROJECT_ID, keyFilename: process.env.GCP_KEY_FILE });
const gcsBucket = storage.bucket(process.env.GCP_BUCKET_NAME);

async function uploadImageToGCS(base64String, filename) {
  const base64Data = base64String.replace(/^data:image\/\w+;base64,/, '');
  const buffer = Buffer.from(base64Data, 'base64');
  const file = gcsBucket.file(`ads/${filename}`);
  await file.save(buffer, { metadata: { contentType: 'image/png' } });
  return `https://storage.googleapis.com/${process.env.GCP_BUCKET_NAME}/ads/${filename}`;
}
```

### 2. ad_matches uses matched_at not created_at
```javascript
pool.query(`SELECT COUNT(*) FROM ad_matches ${dateFilter.replace('created_at', 'matched_at')}`)
```

### 3. Docker must be AMD64 for Cloud Run
```bash
docker buildx build --platform linux/amd64 ...
```

### 4. gpt-image-1 returns base64 not URL
```javascript
const base64Image = `data:image/png;base64,${response.data[0].b64_json}`;
const imageUrl = await uploadImageToGCS(base64Image, filename);
```

### 5. gpt-image-1 quality values
```javascript
quality: 'auto'  // supports: 'low', 'medium', 'high', 'auto' (NOT 'standard')
```

### 6. GPT moderation returns markdown-wrapped JSON
```javascript
const text = response.choices[0].message.content.trim()
  .replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '');
return JSON.parse(text);
```

### 7. ivfflat index needs lists=1 for small datasets
```sql
CREATE INDEX idx_ad_embeddings_vec ON ad_embeddings
USING ivfflat (embedding vector_cosine_ops) WITH (lists = 1);
```

### 8. GCS service account permissions
```bash
gsutil iam ch serviceAccount:610270819686-compute@developer.gserviceaccount.com:objectAdmin \
  gs://ad-engine-media-pka
```

### 9. multer must be defined before upload routes
`const upload = multer({...})` must appear BEFORE any route using `upload.single()` or `upload.fields()`.

---

## Branding

- **Brand name:** PinkCurve
- **Colors:** Pink to Purple gradient `linear-gradient(135deg, #ec4899, #a855f7)`
- **Mission:** Inclusive, privacy-first, trust-based ad marketplace
- **Domain:** pinkcurve (planned)

---

## Feature Roadmap

### Completed
- JWT authentication + role-based access (admin/seller)
- Seller dashboard with getting started guide
- Product management with image upload + moderation
- Ad management with image/video upload
- GPT-4o vision content moderation + admin review queue
- pgvector semantic search (1536-dim embeddings)
- Public buyer landing page at /search
- Featured ads (top bidders) + Recommended (AI matching)
- Video ads with thumbnail + inline playback
- Shop Now links to seller product pages
- Seller location + verified badge on ads
- Sortable tables on all pages
- Analytics dashboard with Recharts
- Chrome extension (server-side intent extraction)
- GCS image/video storage
- Production deployment on GCP

### Planned
- Email notifications for sellers (Resend)
- Seller self-registration page
- Analytics filtered by seller's own data
- Discovery feed — Trending, New Arrivals, Deals
- Seller billing and pay-per-match payments
- Real-time location verification (lat/long for trust)
- Mobile app (iOS/Android) with on-device LLM
- On-device personal model (reads email, photos, messages)

---

## Vector Database Scaling Path

Currently running pgvector 0.8.0 on Cloud SQL for PostgreSQL 14 with an
ivfflat index (lists=1). This is the right choice at current scale (50 ads).

### Data integrity (verified)

Cascade deletes are configured at the schema level, not just in application
code, so vectors never become orphaned:

```
sellers (delete)
  → products (CASCADE)
      → product_embeddings (CASCADE)
      → ads (CASCADE)
          → ad_embeddings (CASCADE)
          → ad_categories (CASCADE)
          → ad_matches (CASCADE)
          → ad_moderation_log (CASCADE)
  → billing_transactions (CASCADE)
  → seller_accounts (CASCADE)
```

Verified by inserting a test ad + embedding, deleting the ad, and confirming
the embedding row was removed automatically — no manual cleanup needed.
This also satisfies GDPR/CCPA "right to be forgotten" — one DELETE on
sellers removes all downstream personal/business data including vectors.
Buyers are never linked to sellers by any foreign key — confirmed zero
columns connect the two tables, preserving buyer anonymity end-to-end.

### Similarity threshold

`semanticSearch()` in server.js filters out low-quality matches:
```sql
AND (1 - (ae.embedding <=> $1::vector)) > 0.35
```
Without this, the query would always return `limit` rows regardless of
relevance — e.g. a search with no good matches would still surface the
"least bad" unrelated ads. Verified empirically: same-topic ad pairs
(indoor garden / grow herbs) scored ~0.79 similarity; unrelated pairs
(car diagnostics / jewelry) scored ~0.27. The 0.35 threshold sits between
these, so a query with zero relevant ads correctly returns "no matches"
instead of forcing irrelevant ones.

### pgvector vs dedicated vector DBs (e.g. Pinecone)

| | pgvector (current) | Pinecone / dedicated vector DB |
|---|---|---|
| Query syntax | Plain SQL | Proprietary API/SDK |
| Join vectors with relational data | Native — one query joins ads+products+sellers+embedding | Requires separate lookups, merged in app code |
| Cost | Free (Postgres extension) | Paid, scales with usage |
| Good up to | ~1-10M vectors | Billions |
| Distributed scaling | Manual | Automatic |

For PinkCurve's relational + semantic search pattern (ads belong to
products belong to sellers, all filtered by status/category/role), pgvector's
ability to JOIN business logic directly into the similarity query is a
structural advantage, not just simplicity — this is something a separate
vector DB cannot do natively.

### When to reconsider (future scale)

| Ad count | Recommendation |
|---|---|
| Current (~50-100k) | pgvector + ivfflat (lists=1) — no change needed |
| 100k-1M | pgvector + hnsw index (replaces ivfflat for better recall at scale) |
| 1M+ | Consider AlloyDB for PostgreSQL (GCP's PostgreSQL-compatible DB with native ScaNN index — Google's proprietary ANN algorithm, ~4x faster than pgvector's ivfflat/hnsw at scale). AlloyDB speaks the same wire protocol as Cloud SQL Postgres, so migration effort is moderate, not a rewrite. |
| 10M+ | Dedicated vector DB (Pinecone/Weaviate) becomes competitive, accepting the tradeoff of losing native SQL joins with relational data. |

Note: AlloyDB is a separate GCP product from Cloud SQL — PinkCurve is
currently on Cloud SQL, which does not include ScaNN. This is a deliberate
choice for current scale and cost; revisit only if ad volume grows by
multiple orders of magnitude.

---

## Test Accounts

| Role | Email | Password |
|---|---|---|
| Admin | petkao@gmail.com | NewPass123 |
| Test Seller | testseller@example.com | TestPass123 |

---

## Local Development

```bash
# PostgreSQL 14 — port 5432, user: postgres, password: Colleen1
# API — http://localhost:3001
cd ~/ad-engine/ad-engine-api && node server.js

# Frontend — http://localhost:3000
cd ~/ad-engine/ad-engine-frontend && npm start

# Cloud SQL proxy for production DB — port 5435
psql 'host=127.0.0.1 port=5435 dbname=adengine user=adengine password=AdEngine2024!'
```

---

*PinkCurve — Peter Kao Associates — San Jose, CA*
*Built with Claude (Anthropic) as primary AI coding assistant*
