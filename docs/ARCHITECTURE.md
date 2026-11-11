# PinkCurve Architecture

How the pieces of this repo fit together and how requests flow through them. All diagrams are [Mermaid](https://mermaid.js.org/) and render directly on GitHub.

- [1. System overview](#1-system-overview)
- [2. Where everything runs](#2-where-everything-runs)
- [3. Buyer search: semantic matching](#3-buyer-search-semantic-matching)
- [4. Chrome extension: intent from browsing context](#4-chrome-extension-intent-from-browsing-context)
- [5. Seller lifecycle: sign-up to live ad](#5-seller-lifecycle-sign-up-to-live-ad)
- [6. Ad creation, moderation and embeddings](#6-ad-creation-moderation-and-embeddings)
- [7. Creative Studio pipeline](#7-creative-studio-pipeline)
- [8. MCP server and AI agents](#8-mcp-server-and-ai-agents)
- [9. Data model](#9-data-model)
- [10. Deployment](#10-deployment)

---

## 1. System overview

```mermaid
flowchart LR
    subgraph Clients
        B[Buyer browser<br/>/search]
        S[Seller / Admin portal]
        X[Chrome extension]
        A[AI assistants<br/>Claude, agents]
    end

    subgraph Firebase["Firebase Hosting (ad-engine-4da45.web.app)"]
        FE[React frontend<br/>ad-engine-frontend]
    end

    subgraph CloudRun["Cloud Run (us-west1)"]
        API[ad-engine-api<br/>Node.js + Express]
        MCP[ad-engine-mcp<br/>MCP server]
    end

    subgraph Data
        DB[(Cloud SQL<br/>PostgreSQL 14 + pgvector)]
        GCS[(Cloud Storage<br/>images + videos)]
    end

    subgraph External["External services"]
        OAI[OpenAI<br/>embeddings, GPT, Whisper, gpt-image-1]
        STR[Stripe<br/>subscriptions]
        RES[Resend<br/>email]
        GOO[Google OAuth]
        SEC[AbuseIPDB, Safe Browsing,<br/>WhoisXML, IP geolocation]
    end

    B --> FE
    S --> FE
    FE -- "/api/**, /auth/** rewrites" --> API
    X -- "/api/extension/*" --> API
    A -- "Streamable HTTP /mcp" --> MCP
    MCP -- "public buyer endpoints" --> API
    API --> DB
    API --> GCS
    API --> OAI
    API --> STR
    API --> RES
    API --> GOO
    API --> SEC
```

The **API is the only component that talks to the database**. The frontend, the Chrome extension and the MCP server all go through it. Firebase Hosting rewrites `/api/**`, `/auth/**` and `/health` on the site's own domain to the `ad-engine-api` Cloud Run service, so the browser only ever talks to `ad-engine-4da45.web.app`.

## 2. Where everything runs

```mermaid
flowchart TB
    subgraph P1["GCP project ad-engine-4da45 (production)"]
        FH1[Firebase Hosting<br/>ad-engine-4da45.web.app]
        FH2[Firebase Hosting target 'landing'<br/>pinkcurve-landing.web.app]
        CR1[Cloud Run: ad-engine-api]
        CR2[Cloud Run: ad-engine-mcp]
        SQL[(Cloud SQL: ad-engine-db)]
        SM[Secret Manager]
        BKT[(GCS bucket: ad-engine-media-pka)]
    end
    subgraph P2["GCP project ad-engine-498605"]
        OAUTH[OAuth client 'Ad Engine'<br/>Google sign-in]
    end
    subgraph Local["Developer machine / Streamlit Cloud"]
        AG[ad-engine-agents<br/>LangGraph agents + Streamlit]
        MD[ad-engine-model<br/>MLX fine-tuning]
    end

    FH1 --> CR1
    CR1 --> SQL
    CR1 --> BKT
    SM -. secrets at revision start .-> CR1
    CR1 -. client id + secret .-> OAUTH
    CR2 --> CR1
    AG --> CR2
```

| Folder | What it is | Runs on |
|---|---|---|
| `ad-engine-api` | Express API, all business logic | Cloud Run `ad-engine-api` |
| `ad-engine-frontend` | React seller/admin portal and public buyer search | Firebase Hosting `ad-engine-4da45` |
| `ad-engine-mcp` | Public MCP server wrapping buyer endpoints | Cloud Run `ad-engine-mcp` |
| `ad-engine-agents` | LangGraph video and email agents (MCP + A2A demo) | Local / Streamlit Community Cloud |
| `ad-engine-landing` | Static marketing page | Firebase Hosting target `landing` |
| `ad-engine-model` | On-device intent model fine-tuning (Phi-3 + LoRA) | Local Apple Silicon |

> The Google OAuth client lives in a **different** GCP project (`ad-engine-498605`) from everything else. Redirect URIs and client secrets are managed there.

## 3. Buyer search: semantic matching

`POST /api/buyer/semantic-match` — used by the public `/search` page and by the MCP server.

```mermaid
sequenceDiagram
    autonumber
    actor Buyer
    participant FE as Frontend /search
    participant API as ad-engine-api
    participant OAI as OpenAI embeddings
    participant DB as PostgreSQL + pgvector
    participant RR as BGE reranker (in-process)

    Buyer->>FE: types "dash cam for my car"
    FE->>API: POST /api/buyer/semantic-match {query, category?, rerank}
    API->>OAI: embed query (text-embedding-3-small, 1536-dim)
    OAI-->>API: query vector
    API->>DB: cosine search on ad_embeddings JOIN ads/products/sellers<br/>active ads only, similarity > 0.35 (0.20 when reranking)
    DB-->>API: candidate ads (more when reranking)
    alt reranker loaded
        API->>RR: score (query, ad text + transcript) pairs<br/>Xenova/bge-reranker-base
        RR-->>API: reordered top N
    else reranker still warming up
        API->>API: keep pgvector order
    end
    API->>DB: record buyer, buyer_session, ad_matches<br/>and add cost_per_match to ads.spent
    API-->>FE: matches + engine ("pgvector" or "pgvector+bge-reranker")
    FE-->>Buyer: video/image ads, Shop Now links
```

Video ads are transcribed with Whisper and the transcript is stored with the embedding, so spoken content is searchable too.

## 4. Chrome extension: intent from browsing context

`POST /api/extension/semantic-match` — the extension sends page context instead of a typed query.

```mermaid
flowchart LR
    CTX["Page title, URL, text,<br/>search query, history<br/>and bookmark topics"] --> GPT["GPT-4o mini<br/>extract 5-10 intent keywords"]
    GPT --> EMB["text-embedding-3-small"]
    EMB --> VS["pgvector cosine search"]
    VS --> RES["Ranked ads returned<br/>to the extension"]
```

The long-term plan (see `ad-engine-model`) is to run the intent extraction on-device with a fine-tuned small model, so browsing context never leaves the buyer's device.

## 5. Seller lifecycle: sign-up to live ad

```mermaid
stateDiagram-v2
    [*] --> FraudCheck: POST /auth/register
    FraudCheck --> Blocked: IP fraud score ≥ 60
    FraudCheck --> PendingReview: allowed / flagged<br/>approval_status = pending_review<br/>verification email sent (Resend)
    PendingReview --> PendingReview: GET /auth/verify-email<br/>email_verified = true
    PendingReview --> Approved: admin approves
    PendingReview --> Rejected: admin rejects
    Approved --> Suspended: admin suspends
    Suspended --> Approved: admin unsuspends
    Approved --> Subscribed: Stripe checkout (Starter / Pro / Enterprise)
    Approved --> Active: Free plan
    Subscribed --> Active
    Active --> [*]
    Blocked --> [*]
    Rejected --> [*]
```

- Sign-in: email + password (bcrypt + JWT) or Google OAuth (`/auth/google` → `/auth/google/callback`).
- Every seller login records IP geolocation (`seller_geo_log`) for location verification.
- Stripe webhooks (`POST /api/stripe/webhook`) keep `subscriptions` and `payment_history` in sync.

## 6. Ad creation, moderation and embeddings

```mermaid
flowchart TB
    P[Seller creates product] --> AD[Seller creates ad<br/>video / image / text / native / carousel]
    AD --> UP{Media}
    UP -- image upload --> MOD[GPT-4o mini vision moderation]
    UP -- "AI generated<br/>POST /api/ads/:id/generate-image" --> GEN[gpt-image-1] --> GCSI
    MOD -- approved --> GCSI[(GCS)] --> LIVE[Ad status: active]
    MOD -- unsure --> Q[Admin review queue<br/>status pending_review]
    MOD -- rejected --> REJ[Ad status: rejected]
    UP -- "video upload<br/>(thumbnail moderated)" --> GCSV[(GCS)] --> Q
    Q -- admin approves --> LIVE
    Q -- admin rejects --> REJ
    LIVE -. "run manually" .-> EMB["generate-embeddings.js<br/>or POST /api/admin/retranscribe-ads"]
    EMB --> WH["Whisper transcription<br/>(video ads, files under 25 MB)"]
    WH --> VEC["text-embedding-3-small on<br/>headline + copy + tags + transcript"]
    EMB --> VEC
    VEC --> AE[(ad_embeddings<br/>vector 1536)]
    AE --> SEARCH[Searchable by buyers,<br/>extension and MCP]
```

> Embeddings are **not** created automatically when an ad goes live. A new ad only becomes searchable after `node generate-embeddings.js` (new ads) or the admin re-transcribe endpoint runs. Both upsert with `ON CONFLICT (ad_id) DO UPDATE`.

## 7. Creative Studio pipeline

AI-assisted ad creation, per product. Each step is a structured LLM call through `llmProvider.js` (OpenAI by default; Anthropic, Google, NVIDIA or any OpenAI-compatible endpoint via `LLM_PROVIDER`), validated against the schemas in `creativeStudioSchemas.js`.

```mermaid
flowchart LR
    PR[Product + seller] --> AN["analyzeProduct()<br/>product analysis"]
    AN --> CC["generateCampaigns()<br/>campaign concepts"]
    CC --> BR[(creative_briefs)]
    BR -- seller picks a concept --> SC["generateScript()<br/>15 / 30 / 60 s, per platform"]
    SC --> SCR[(creative_scripts)]
    SCR --> SB["generateStoryboard()<br/>scenes, aspect ratio"]
    SB --> SBR[(creative_storyboards)]
    SBR --> REV{Seller review}
    REV -- approve --> RS["generateRenderSpec()<br/>+ asset requirements"]
    REV -- reject --> SB
```

The product workspace UI (`ProductWorkspace.jsx`) groups this per product in **Overview**, **Knowledge**, **Campaigns** and **Assets** tabs. `product_knowledge` and `creative_campaigns` tables exist and briefs/scripts/storyboards carry an optional `campaign_id`, but no API reads or writes `product_knowledge` yet.

## 8. MCP server and AI agents

```mermaid
flowchart LR
    subgraph Hosts["MCP hosts"]
        CL[Claude / any MCP client]
        VA[Video Agent<br/>LangGraph + Streamlit :8501]
    end
    subgraph MCPS["ad-engine-mcp (Cloud Run)"]
        T1[get_featured_video_ads]
        T2[search_video_ads_for_buyer]
        T3[get_video_ads_by_category]
        T4[get_ad_details]
        T5[list_categories]
    end
    subgraph APIS["ad-engine-api public endpoints"]
        E1[GET /api/buyer/featured]
        E2[POST /api/buyer/semantic-match]
        E3[GET /api/buyer/categories]
    end

    CL -- Streamable HTTP --> MCPS
    VA -- Streamable HTTP --> MCPS
    T1 --> E1
    T3 --> E1
    T4 --> E1
    T2 --> E2
    T5 --> E3

    VA -- "A2A: GET /.well-known/agent.json<br/>POST /a2a/message" --> EA[Email Agent<br/>LangGraph + FastAPI :9001]
    EA --> RS[Resend email]
```

The MCP server is a thin, stateless wrapper with no database access and no authentication; it only filters to video ads and reshapes responses.

## 9. Data model

Core foreign-key relationships (29 tables in production; logs and other supporting tables are omitted here).

```mermaid
erDiagram
    sellers ||--o{ seller_accounts : "logins"
    sellers ||--o{ products : "sells"
    sellers ||--o{ subscriptions : "Stripe plan"
    sellers ||--o{ billing_transactions : "billed"
    products ||--o{ ads : "advertised by"
    products ||--o| product_embeddings : "vector"
    ads ||--o| ad_embeddings : "vector + transcript"
    ads ||--o{ ad_matches : "matched to buyers"
    buyers ||--o{ buyer_sessions : "sessions"
    buyers ||--o{ ad_matches : "receives"
    buyer_sessions ||--o{ ad_matches : "in session"
    products ||--o{ product_knowledge : "knowledge"
    product_knowledge ||--o{ creative_campaigns : "informs"
    products ||--o{ creative_briefs : "Creative Studio"
    creative_campaigns ||--o{ creative_briefs : "groups"
    creative_briefs ||--o{ creative_scripts : "scripts"
    creative_scripts ||--o{ creative_storyboards : "storyboards"
```

Deleting a seller cascades to products, ads, embeddings, matches and billing rows. Buyers are never linked to sellers by a foreign key, which keeps buyers anonymous.

## 10. Deployment

```mermaid
flowchart LR
    DEV[Developer laptop] -- "ad-engine-api/deploy.sh<br/>(gcloud run deploy --source .)" --> CB[Cloud Build<br/>Dockerfile] --> CR1[Cloud Run ad-engine-api]
    DEV -- "gcloud run deploy ad-engine-mcp --source ." --> CB2[Cloud Build] --> CR2[Cloud Run ad-engine-mcp]
    DEV -- "npm run build &&<br/>firebase deploy --only hosting" --> FH[Firebase Hosting]
    DEV -- "git push" --> GH[GitHub petkao/ad-engine]
    SM[Secret Manager] -. "DB_PASSWORD, OPENAI_API_KEY,<br/>GOOGLE_CLIENT_*, SESSION_SECRET, ..." .-> CR1
```

- Deploys are manual from a laptop; there is no CI/CD pipeline and pushing to GitHub does not deploy anything.
- Cloud Run reads Secret Manager values only when a revision starts. After rotating a secret, roll a new revision.
- Always target project `ad-engine-4da45` (`deploy.sh` pins it). The local gcloud default project may be different.
