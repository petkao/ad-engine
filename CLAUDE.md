# CLAUDE.md - Project Context for Claude Code

## Project Overview

**PinkCurve Ad Engine** - A full-stack ad marketplace platform by Peter Kao Associates.

Sellers create product listings and video/image ads. Buyers discover products through semantic search powered by OpenAI embeddings and pgvector. Video ads are transcribed using Whisper for richer search.

## Repository Structure

```
ad-engine/
├── ad-engine-api/       # Node.js/Express backend (Cloud Run)
├── ad-engine-frontend/  # React frontend (Firebase Hosting)
├── ad-engine-mcp/       # MCP server for AI agent integration
├── ad-engine-agents/    # LangGraph agents (Streamlit)
├── ad-engine-landing/   # Marketing landing page
└── ad-engine-model/     # ML model experiments
```

## Tech Stack

### Backend (ad-engine-api)
- **Runtime:** Node.js 20 + Express
- **Database:** PostgreSQL with pgvector extension (Cloud SQL)
- **Auth:** JWT + bcrypt, Passport.js (Google OAuth)
- **Payments:** Stripe subscriptions
- **Storage:** Google Cloud Storage for media
- **AI:** OpenAI (embeddings: text-embedding-3-small, transcription: whisper-1)
- **Email:** Resend API
- **Deploy:** Cloud Run via `./deploy.sh`

### Frontend (ad-engine-frontend)
- **Framework:** React 18
- **Styling:** Tailwind CSS
- **Deploy:** Firebase Hosting via `npm run deploy`

### Key Files
- `ad-engine-api/server.js` - Main API (~3500 lines)
- `ad-engine-api/transcriptionService.js` - Whisper video transcription
- `ad-engine-api/generate-embeddings.js` - Batch embedding generation
- `ad-engine-api/emailService.js` - Email verification via Resend
- `ad-engine-api/geoService.js` - IP geolocation

## Common Commands

```bash
# API Development
cd ad-engine-api
npm start                           # Start server locally (port 3001)
./deploy.sh                         # Deploy to Cloud Run

# Generate embeddings
node generate-embeddings.js         # New ads only
node generate-embeddings.js --force # Regenerate all (with transcripts)

# Frontend Development
cd ad-engine-frontend
npm start                           # Dev server (port 3000)
npm run build && firebase deploy    # Deploy to Firebase
```

## Database Schema (Key Tables)

- `sellers` - Seller accounts (approval_status, is_verified, stripe fields)
- `products` - Product listings (seller_id, category, price)
- `ads` - Ad creatives (product_id, format: video/image/text/native/carousel)
- `ad_embeddings` - Vector embeddings (ad_id, embedding, has_transcript, transcript)
- `ad_matches` - Buyer-ad match events for billing
- `buyers` - Buyer profiles with intent data

## API Endpoints (Notable)

### Public (Buyer)
- `POST /api/buyer/semantic-match` - Vector similarity search
- `GET /api/buyer/featured` - Top ads by cost_per_match
- `GET /api/buyer/categories` - Category list with counts

### Auth
- `POST /auth/register` - Seller registration
- `POST /auth/login` - JWT login
- `GET /auth/verify-email/:token` - Email verification

### Admin
- `POST /api/admin/retranscribe-ads` - Batch Whisper transcription
- `GET /api/admin/pending-sellers` - Approval queue
- `POST /api/admin/approve-seller/:id` - Approve seller

## Environment Variables

### Required (Cloud Run secrets)
- `DATABASE_URL` or `DB_HOST/DB_USER/DB_PASSWORD/DB_NAME`
- `JWT_SECRET`
- `OPENAI_API_KEY`
- `STRIPE_SECRET_KEY`
- `RESEND_API_KEY`
- `GCS_BUCKET_NAME`

### Optional
- `GOOGLE_CLIENT_ID/SECRET` - OAuth
- `FRONTEND_URL` - CORS origin

## Deployment

### API (Cloud Run)
```bash
cd ad-engine-api
./deploy.sh  # Uses gcloud run deploy with Dockerfile
```

### Frontend (Firebase)
```bash
cd ad-engine-frontend
npm run build
firebase deploy --only hosting
```

## Recent Features

1. **Whisper Transcription** - Video ads transcribed for semantic search
2. **Email Verification** - Resend-based verification flow
3. **Seller Approval** - Admin approval queue for new sellers
4. **Geo Verification** - IP-based location verification
5. **Stripe Billing** - Subscription tiers (Free/Starter/Pro/Enterprise)

## Notes for Claude

- Production API: `https://ad-engine-api-610270819686.us-west1.run.app`
- Production Frontend: `https://ad-engine-4da45.web.app`
- The local database (localhost) has test data; video ads only exist in production Cloud SQL
- Always use `ON CONFLICT (ad_id) DO UPDATE` for ad_embeddings upserts
- Video transcription requires OPENAI_API_KEY and files under 25MB
