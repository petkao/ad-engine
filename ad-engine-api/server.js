require('dotenv').config();
const {
  sendAdApprovedEmail,
  sendMatchNotificationEmail,
  sendVerificationEmail,
  sendNewSellerAdminNotification,
  sendSellerApprovedEmail,
  sendSellerRejectedEmail,
  sendSellerSuspendedEmail,
  setPool
} = require('./emailService');
const crypto = require('crypto');
const { resolveGeo, getClientIp } = require('./geoService');
const { transcribeVideoAd, isMeaningfulTranscript, buildAdTextWithTranscript } = require('./transcriptionService');
const { rerankResults, warmUpReranker, isRerankerReady } = require('./rerankerService');
const { calculateFraudScore, logFraudCheck, checkUrlSafety, checkDomainAge } = require('./fraudDetectionService');
const OpenAI = require('openai');
const { Storage } = require('@google-cloud/storage');
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const { OAuth2Client } = require('google-auth-library');
const PgSession = require('connect-pg-simple')(session);
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const Stripe = require('stripe');

// Initialize Stripe
const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

// ── EMAIL RATE LIMITING ───────────────────────────────────────
// Strict rate limits for routes that trigger outbound emails
const emailRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour window
  max: 10, // max 10 email-triggering requests per hour per IP
  message: { error: 'Too many email requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── PROMPT INJECTION SANITIZATION ─────────────────────────────
// Patterns commonly used in prompt injection attacks
const PROMPT_INJECTION_PATTERNS = [
  /ignore\s+(previous|above|all)\s+(instructions?|prompts?)/i,
  /disregard\s+(previous|above|all)\s+(instructions?|prompts?)/i,
  /forget\s+(previous|above|all)\s+(instructions?|prompts?)/i,
  /new\s+instructions?:/i,
  /system\s*:\s*/i,
  /\[INST\]/i,
  /\[\/INST\]/i,
  /<\|im_start\|>/i,
  /<\|im_end\|>/i,
  /###\s*(system|user|assistant)/i,
  /you\s+are\s+now\s+/i,
  /act\s+as\s+if\s+/i,
  /pretend\s+(you|to)\s+/i,
  /roleplay\s+as\s+/i,
  /jailbreak/i,
  /DAN\s*mode/i,
];

function containsPromptInjection(text) {
  if (!text || typeof text !== 'string') return false;
  return PROMPT_INJECTION_PATTERNS.some(pattern => pattern.test(text));
}

function sanitizeForEmail(text) {
  if (!text || typeof text !== 'string') return text;
  // Remove potential HTML/script tags
  let sanitized = text.replace(/<[^>]*>/g, '');
  // Escape special characters
  sanitized = sanitized
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
  return sanitized;
}

const app = express();
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

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'postgres',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'Colleen1',
});

// Initialize email service with pool for recipient allowlist verification
setPool(pool);

let billingSupportTicketsTableReady;

function ensureBillingSupportTicketsTable() {
  if (!billingSupportTicketsTableReady) {
    billingSupportTicketsTableReady = pool.query(`
      CREATE TABLE IF NOT EXISTS billing_support_tickets (
        ticket_id TEXT PRIMARY KEY,
        seller_id UUID NOT NULL REFERENCES sellers(id) ON DELETE CASCADE,
        seller_name TEXT NOT NULL,
        contact_email TEXT NOT NULL,
        routed_to TEXT NOT NULL,
        priority TEXT NOT NULL DEFAULT 'normal',
        subject TEXT NOT NULL,
        description TEXT NOT NULL,
        queue TEXT NOT NULL DEFAULT 'billing-support',
        status TEXT NOT NULL DEFAULT 'submitted',
        created_by_id TEXT,
        created_by_email TEXT,
        created_by_role TEXT,
        auth_type TEXT,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS idx_billing_support_tickets_seller_id
        ON billing_support_tickets (seller_id, created_at DESC);
    `).catch((err) => {
      billingSupportTicketsTableReady = undefined;
      throw err;
    });
  }
  return billingSupportTicketsTableReady;
}

// ── GEO LOGGING & AD EVENTS ───────────────────────────────────

let geoLogTablesReady;

function ensureGeoLogTables() {
  if (!geoLogTablesReady) {
    geoLogTablesReady = pool.query(`
      CREATE TABLE IF NOT EXISTS ad_events (
        id SERIAL PRIMARY KEY,
        event_type VARCHAR(20) NOT NULL,
        ad_id UUID,
        seller_id UUID,
        buyer_session_id VARCHAR(255),
        buyer_ip VARCHAR(45),
        buyer_city VARCHAR(100),
        buyer_state VARCHAR(100),
        buyer_country VARCHAR(100),
        user_agent TEXT,
        referrer TEXT,
        timestamp TIMESTAMPTZ DEFAULT NOW()
      );

      -- Fix ad_id column if it was created as INTEGER
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'ad_events' AND column_name = 'ad_id' AND data_type = 'integer'
        ) THEN
          ALTER TABLE ad_events DROP COLUMN ad_id;
          ALTER TABLE ad_events ADD COLUMN ad_id UUID;
        END IF;
      END $$;

      CREATE INDEX IF NOT EXISTS idx_ad_events_timestamp
        ON ad_events (timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_ad_events_ad_id
        ON ad_events (ad_id, timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_ad_events_seller_id
        ON ad_events (seller_id, timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_ad_events_type
        ON ad_events (event_type, timestamp DESC);

      CREATE TABLE IF NOT EXISTS seller_geo_log (
        id SERIAL PRIMARY KEY,
        seller_id UUID REFERENCES sellers(id) ON DELETE CASCADE,
        ip VARCHAR(45),
        city VARCHAR(100),
        state VARCHAR(100),
        country VARCHAR(100),
        geo_match BOOLEAN,
        is_vpn BOOLEAN DEFAULT false,
        event_type VARCHAR(20) DEFAULT 'registration',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_seller_geo_log_seller_id
        ON seller_geo_log (seller_id, created_at DESC);

      -- Add is_vpn and event_type columns if missing (for existing tables)
      ALTER TABLE seller_geo_log ADD COLUMN IF NOT EXISTS is_vpn BOOLEAN DEFAULT false;
      ALTER TABLE seller_geo_log ADD COLUMN IF NOT EXISTS event_type VARCHAR(20) DEFAULT 'registration';

      CREATE TABLE IF NOT EXISTS buyer_geo_log (
        id SERIAL PRIMARY KEY,
        session_id VARCHAR(255),
        ip VARCHAR(45),
        city VARCHAR(100),
        state VARCHAR(100),
        country VARCHAR(100),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_buyer_geo_log_session_id
        ON buyer_geo_log (session_id, created_at DESC);

      -- Add geo-related columns to sellers table if missing
      ALTER TABLE sellers ADD COLUMN IF NOT EXISTS location VARCHAR(255);
      ALTER TABLE sellers ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT false;
      ALTER TABLE sellers ADD COLUMN IF NOT EXISTS geo_verified BOOLEAN DEFAULT false;

      -- Add email verification columns to sellers table
      ALTER TABLE sellers ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT false;
      ALTER TABLE sellers ADD COLUMN IF NOT EXISTS email_verification_token VARCHAR(255);
      ALTER TABLE sellers ADD COLUMN IF NOT EXISTS email_verification_expires TIMESTAMPTZ;

      -- Add approval status column for admin review workflow
      ALTER TABLE sellers ADD COLUMN IF NOT EXISTS approval_status VARCHAR(20) DEFAULT 'pending_review';
    `).catch((err) => {
      geoLogTablesReady = undefined;
      console.error('Failed to create geo log tables:', err.message);
    });
  }
  return geoLogTablesReady;
}

// ── STRIPE SUBSCRIPTIONS TABLE ────────────────────────────────
let subscriptionsTableReady;

function ensureSubscriptionsTable() {
  if (!subscriptionsTableReady) {
    subscriptionsTableReady = pool.query(`
      CREATE TABLE IF NOT EXISTS subscriptions (
        id SERIAL PRIMARY KEY,
        seller_id UUID REFERENCES sellers(id) ON DELETE CASCADE,
        stripe_customer_id VARCHAR(255),
        stripe_subscription_id VARCHAR(255),
        plan VARCHAR(20) DEFAULT 'free',
        status VARCHAR(20) DEFAULT 'active',
        impressions_included INTEGER DEFAULT 100,
        impression_overage_rate DECIMAL(10,4) DEFAULT 0.25,
        current_period_start TIMESTAMPTZ,
        current_period_end TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_seller_id
        ON subscriptions (seller_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_stripe_customer_id
        ON subscriptions (stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_stripe_subscription_id
        ON subscriptions (stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL;

      -- Payment history table for tracking all payments
      CREATE TABLE IF NOT EXISTS payment_history (
        id SERIAL PRIMARY KEY,
        seller_id UUID REFERENCES sellers(id) ON DELETE CASCADE,
        stripe_invoice_id VARCHAR(255),
        amount_cents INTEGER,
        currency VARCHAR(3) DEFAULT 'usd',
        status VARCHAR(20),
        description TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_payment_history_seller_id
        ON payment_history (seller_id, created_at DESC);

      -- Add stories_included column if missing
      ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS stories_included INTEGER DEFAULT 1;
    `).catch((err) => {
      subscriptionsTableReady = undefined;
      console.error('Failed to create subscriptions table:', err.message);
    });
  }
  return subscriptionsTableReady;
}

// ── BUYER ACCOUNTS TABLE ──────────────────────────────────────
let buyerAccountsTableReady;

function ensureBuyerAccountsTable() {
  if (!buyerAccountsTableReady) {
    buyerAccountsTableReady = pool.query(`
      CREATE TABLE IF NOT EXISTS buyer_accounts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        google_id VARCHAR(255) UNIQUE,
        email VARCHAR(255) UNIQUE,
        name VARCHAR(255),
        avatar_url TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        last_login TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_buyer_accounts_google_id
        ON buyer_accounts (google_id);
      CREATE INDEX IF NOT EXISTS idx_buyer_accounts_email
        ON buyer_accounts (email);
    `).catch((err) => {
      buyerAccountsTableReady = undefined;
      console.error('Failed to create buyer_accounts table:', err.message);
    });
  }
  return buyerAccountsTableReady;
}

// ── SELLER REVIEWS TABLE ──────────────────────────────────────
let sellerReviewsTableReady;

function ensureSellerReviewsTable() {
  if (!sellerReviewsTableReady) {
    sellerReviewsTableReady = (async () => {
      // Check if table exists with wrong column type (ad_id should be UUID, not INTEGER)
      const check = await pool.query(`
        SELECT data_type FROM information_schema.columns
        WHERE table_name = 'seller_reviews' AND column_name = 'ad_id'
      `);
      if (check.rows.length > 0 && check.rows[0].data_type !== 'uuid') {
        console.log('[Migration] Dropping seller_reviews table - ad_id has wrong type:', check.rows[0].data_type);
        await pool.query('DROP TABLE IF EXISTS seller_reviews');
      }

      await pool.query(`
        CREATE TABLE IF NOT EXISTS seller_reviews (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          seller_id UUID NOT NULL,
          buyer_account_id UUID NOT NULL,
          ad_id UUID,
          rating INTEGER CHECK (rating BETWEEN 1 AND 5),
          comment VARCHAR(280),
          verified_match BOOLEAN DEFAULT true,
          helpful_count INTEGER DEFAULT 0,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_seller_reviews_seller
          ON seller_reviews (seller_id);
        CREATE INDEX IF NOT EXISTS idx_seller_reviews_buyer
          ON seller_reviews (buyer_account_id);
        CREATE INDEX IF NOT EXISTS idx_seller_reviews_ad
          ON seller_reviews (ad_id);
      `);
      console.log('[Migration] seller_reviews table ready with UUID columns');
    })().catch((err) => {
      sellerReviewsTableReady = undefined;
      console.error('Failed to create seller_reviews table:', err.message);
    });
  }
  return sellerReviewsTableReady;
}

// ── FRAUD LOGS TABLE ─────────────────────────────────────────
let fraudLogsTableReady;

function ensureFraudLogsTable() {
  if (!fraudLogsTableReady) {
    fraudLogsTableReady = pool.query(`
      CREATE TABLE IF NOT EXISTS fraud_logs (
        id SERIAL PRIMARY KEY,
        ip_address VARCHAR(45),
        url TEXT,
        entity_type VARCHAR(20),
        entity_id UUID,
        total_score INTEGER,
        action VARCHAR(20),
        ip_reputation_score INTEGER,
        ip_reputation_details TEXT,
        url_safety_score INTEGER,
        url_safety_details TEXT,
        domain_age_score INTEGER,
        domain_age_details TEXT,
        multi_account_score INTEGER,
        multi_account_details TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_fraud_logs_created_at
        ON fraud_logs (created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_fraud_logs_entity
        ON fraud_logs (entity_type, entity_id);
      CREATE INDEX IF NOT EXISTS idx_fraud_logs_action
        ON fraud_logs (action, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_fraud_logs_ip
        ON fraud_logs (ip_address);
    `).catch((err) => {
      fraudLogsTableReady = undefined;
      console.error('Failed to create fraud_logs table:', err.message);
    });
  }
  return fraudLogsTableReady;
}

// ── AD EMBEDDINGS TRANSCRIPT COLUMNS ─────────────────────────
let adEmbeddingsTranscriptReady;

async function ensureAdEmbeddingsTranscriptColumns() {
  if (!adEmbeddingsTranscriptReady) {
    adEmbeddingsTranscriptReady = (async () => {
      try {
        // Add transcript columns
        await pool.query(`
          ALTER TABLE ad_embeddings ADD COLUMN IF NOT EXISTS has_transcript BOOLEAN DEFAULT false;
          ALTER TABLE ad_embeddings ADD COLUMN IF NOT EXISTS transcript TEXT;
          ALTER TABLE ad_embeddings ADD COLUMN IF NOT EXISTS embedding_text TEXT;
        `);
        // Add unique constraint on ad_id for ON CONFLICT support
        await pool.query(`
          CREATE UNIQUE INDEX IF NOT EXISTS ad_embeddings_ad_id_unique ON ad_embeddings(ad_id);
        `);
        console.log('[Migration] ad_embeddings transcript columns and unique index ready');
      } catch (err) {
        adEmbeddingsTranscriptReady = undefined;
        console.error('Failed to migrate ad_embeddings:', err.message);
        throw err;
      }
    })();
  }
  return adEmbeddingsTranscriptReady;
}

// ── STRIPE PRODUCTS INITIALIZATION ────────────────────────────
// Plan configurations with story limits
const STRIPE_PLANS = {
  free: {
    name: 'Free',
    price: 0,
    stories: 1,
    impressions: 10,
    description: '1 Seller Story, 10 intent matches/month'
  },
  starter: {
    name: 'Starter',
    price: 2900, // $29.00 in cents
    stories: 5,
    impressions: 100,
    description: '5 Seller Stories, 100 intent matches/month'
  },
  pro: {
    name: 'Pro',
    price: 9900, // $99.00 in cents
    stories: 20,
    impressions: 500,
    description: '20 Seller Stories, 500 intent matches/month'
  },
  enterprise: {
    name: 'Enterprise',
    price: 29900, // $299.00 in cents
    stories: 999, // effectively unlimited
    impressions: 999999, // effectively unlimited
    description: 'Unlimited Seller Stories & intent matches/month'
  }
};

// Cache for Stripe price IDs
let stripePriceIds = {};

async function ensureStripeProducts() {
  if (!stripe) {
    console.log('Stripe not configured, skipping product setup');
    return;
  }

  try {
    // Check for existing products
    const existingProducts = await stripe.products.list({ active: true, limit: 100 });
    const existingPrices = await stripe.prices.list({ active: true, limit: 100 });

    for (const [planKey, planConfig] of Object.entries(STRIPE_PLANS)) {
      // Skip free plan - no Stripe product needed
      if (planKey === 'free' || planConfig.price === 0) continue;

      const productName = `PinkCurve ${planConfig.name}`;
      let product = existingProducts.data.find(p => p.name === productName);

      if (!product) {
        product = await stripe.products.create({
          name: productName,
          description: planConfig.description,
          metadata: {
            plan: planKey,
            stories: String(planConfig.stories),
            impressions: String(planConfig.impressions)
          }
        });
        console.log(`Created Stripe product: ${productName}`);
      }

      // Find or create price
      let price = existingPrices.data.find(
        p => p.product === product.id && p.unit_amount === planConfig.price && p.recurring?.interval === 'month'
      );

      if (!price) {
        price = await stripe.prices.create({
          product: product.id,
          unit_amount: planConfig.price,
          currency: 'usd',
          recurring: { interval: 'month' },
          metadata: { plan: planKey }
        });
        console.log(`Created Stripe price for ${productName}: $${planConfig.price / 100}/mo`);
      }

      stripePriceIds[planKey] = price.id;
    }

    console.log('Stripe products initialized:', stripePriceIds);
  } catch (err) {
    console.error('Failed to initialize Stripe products:', err.message);
  }
}

/**
 * Log seller geolocation data on registration
 * Compares claimed location (from form) with detected location (from IP)
 * @param {string} sellerId - Seller UUID
 * @param {Request} req - Express request object
 * @param {string|null} claimedLocation - Location provided by seller in registration form
 */
async function logSellerGeo(sellerId, req, claimedLocation = null) {
  try {
    await ensureGeoLogTables();
    const ip = getClientIp(req);
    const geo = resolveGeo(ip);

    // Build detected location string
    const locationParts = [geo.city, geo.state, geo.country].filter(Boolean);
    const detectedLocation = locationParts.join(', ');

    // Determine geo_match by comparing claimed vs detected
    // Match if: geo lookup succeeded AND (no claimed location OR claimed contains matching parts)
    let geoMatch = false;
    if (geo.country) {
      if (!claimedLocation) {
        // No claimed location - just verify geo lookup worked
        geoMatch = true;
      } else {
        // Compare claimed with detected (case-insensitive partial match)
        const claimed = claimedLocation.toLowerCase();
        const matchesCity = geo.city && claimed.includes(geo.city.toLowerCase());
        const matchesState = geo.state && claimed.includes(geo.state.toLowerCase());
        const matchesCountry = geo.country && claimed.includes(geo.country.toLowerCase());
        geoMatch = matchesCity || matchesState || matchesCountry;
      }
    }

    // Insert into geo log
    await pool.query(
      `INSERT INTO seller_geo_log (seller_id, ip, city, state, country, geo_match, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [sellerId, ip, geo.city, geo.state, geo.country, geoMatch]
    );

    // Update seller's verification status
    // Only set location if not already provided by user
    // Set BOTH is_verified and geo_verified when geo match succeeds
    if (detectedLocation) {
      await pool.query(
        `UPDATE sellers
         SET location = COALESCE(NULLIF(location, ''), $2),
             geo_verified = $3,
             is_verified = CASE WHEN $3 = true THEN true ELSE is_verified END,
             updated_at = NOW()
         WHERE id = $1`,
        [sellerId, detectedLocation, geoMatch]
      );
    }

    console.log(`Logged seller geo: ${sellerId} from ${ip} - claimed: "${claimedLocation || 'none'}", detected: "${detectedLocation}", match: ${geoMatch}`);
  } catch (err) {
    console.error('Failed to log seller geo:', err.message);
  }
}

/**
 * Check if IP is a VPN/proxy using ip-api.com
 * @param {string} ip - IP address to check
 * @returns {Promise<boolean>} true if VPN/proxy detected
 */
async function checkVpnStatus(ip) {
  // Skip check for localhost/private IPs
  if (!ip || ip === '127.0.0.1' || ip === '::1' || ip.startsWith('192.168.') || ip.startsWith('10.') || ip.startsWith('172.')) {
    return false;
  }

  try {
    const response = await fetch(`http://ip-api.com/json/${ip}?fields=proxy,hosting`);
    if (!response.ok) return false;
    const data = await response.json();
    // Flag as VPN if proxy=true OR hosting=true (datacenter IP)
    return data.proxy === true || data.hosting === true;
  } catch (err) {
    console.error(`VPN check failed for ${ip}:`, err.message);
    return false;
  }
}

/**
 * Log seller login with geo monitoring and suspicious activity detection
 * Auto-suspends sellers with 3+ geo mismatches in 30 days
 * @param {string} sellerId - Seller UUID
 * @param {object} seller - Seller record with location
 * @param {Request} req - Express request object
 * @returns {Promise<{suspended: boolean, reason?: string}>}
 */
async function logSellerLoginGeo(sellerId, seller, req) {
  try {
    await ensureGeoLogTables();
    const ip = getClientIp(req);
    const geo = resolveGeo(ip);
    const isVpn = await checkVpnStatus(ip);

    // Determine geo_match by comparing with registered location
    let geoMatch = true;
    if (seller.location && geo.country) {
      const claimed = seller.location.toLowerCase();
      const matchesCity = geo.city && claimed.includes(geo.city.toLowerCase());
      const matchesState = geo.state && claimed.includes(geo.state.toLowerCase());
      const matchesCountry = geo.country && claimed.includes(geo.country.toLowerCase());
      geoMatch = matchesCity || matchesState || matchesCountry;
    }

    // Log the login event
    await pool.query(
      `INSERT INTO seller_geo_log (seller_id, ip, city, state, country, geo_match, is_vpn, event_type, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'login', NOW())`,
      [sellerId, ip, geo.city, geo.state, geo.country, geoMatch, isVpn]
    );

    console.log(`Login geo log: seller=${sellerId}, ip=${ip}, city=${geo.city}, match=${geoMatch}, vpn=${isVpn}`);

    // Count mismatches in last 30 days (VPN counts double)
    const mismatchResult = await pool.query(
      `SELECT
         SUM(CASE WHEN geo_match = false AND is_vpn = false THEN 1 ELSE 0 END) +
         SUM(CASE WHEN geo_match = false AND is_vpn = true THEN 2 ELSE 0 END) +
         SUM(CASE WHEN is_vpn = true THEN 1 ELSE 0 END) as weighted_count
       FROM seller_geo_log
       WHERE seller_id = $1
       AND created_at > NOW() - INTERVAL '30 days'`,
      [sellerId]
    );

    const weightedMismatches = parseInt(mismatchResult.rows[0]?.weighted_count || 0, 10);

    // Auto-suspend if weighted mismatches >= 3
    if (weightedMismatches >= 3) {
      // Get recent login locations for the notification
      const recentLogins = await pool.query(
        `SELECT city, state, country, ip, geo_match, is_vpn, created_at
         FROM seller_geo_log
         WHERE seller_id = $1
         ORDER BY created_at DESC
         LIMIT 5`,
        [sellerId]
      );

      // Suspend the seller
      await pool.query(
        `UPDATE sellers SET approval_status = 'suspended', updated_at = NOW() WHERE id = $1`,
        [sellerId]
      );

      // Send admin notification
      const locationsList = recentLogins.rows.map(r =>
        `${r.city || 'Unknown'}, ${r.state || ''}, ${r.country || ''} (${r.geo_match ? 'Match' : 'MISMATCH'}${r.is_vpn ? ', VPN' : ''})`
      ).join('<br>');

      const { sendAutoSuspensionNotification } = require('./emailService');
      await sendAutoSuspensionNotification({
        name: seller.name,
        email: seller.email,
        registeredLocation: seller.location || 'Not provided',
        recentLocations: locationsList,
        mismatchCount: weightedMismatches
      });

      console.log(`AUTO-SUSPENDED seller ${sellerId} (${seller.email}) due to ${weightedMismatches} weighted geo mismatches`);

      return { suspended: true, reason: 'Account suspended pending security review due to suspicious login locations.' };
    }

    return { suspended: false };
  } catch (err) {
    console.error('Failed to log seller login geo:', err.message);
    return { suspended: false };
  }
}

/**
 * Log buyer geolocation data on click
 */
async function logBuyerGeo(sessionId, req) {
  try {
    await ensureGeoLogTables();
    const ip = getClientIp(req);
    const geo = resolveGeo(ip);

    await pool.query(
      `INSERT INTO buyer_geo_log (session_id, ip, city, state, country, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [sessionId, ip, geo.city, geo.state, geo.country]
    );
    console.log(`Logged buyer geo: ${sessionId} from ${ip} (${geo.city}, ${geo.state}, ${geo.country})`);
  } catch (err) {
    console.error('Failed to log buyer geo:', err.message);
  }
}

/**
 * Log ad event (impression or click) with full geo and request context
 * @param {string} eventType - 'impression' or 'click'
 * @param {object} params - Event parameters
 * @param {Request} req - Express request object
 */
async function logAdEvent(eventType, params, req) {
  try {
    await ensureGeoLogTables();
    const ip = getClientIp(req);
    const geo = resolveGeo(ip);
    const userAgent = req.headers['user-agent'] || null;
    const referrer = req.headers['referer'] || req.headers['referrer'] || null;

    await pool.query(
      `INSERT INTO ad_events (event_type, ad_id, seller_id, buyer_session_id, buyer_ip, buyer_city, buyer_state, buyer_country, user_agent, referrer, timestamp)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
      [
        eventType,
        params.adId || null,
        params.sellerId || null,
        params.sessionId || null,
        ip,
        geo.city || null,
        geo.state || null,
        geo.country || null,
        userAgent,
        referrer
      ]
    );
    console.log(`Ad event logged: ${eventType} for ad ${params.adId || 'N/A'} from ${ip} (${geo.city || 'unknown'})`);
  } catch (err) {
    console.error('Failed to log ad event:', err.message);
  }
}

app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:3000', credentials: true }));
// Skip JSON parsing for Stripe webhook (needs raw body for signature verification)
app.use((req, res, next) => {
  if (req.originalUrl === '/api/stripe/webhook') {
    next();
  } else {
    express.json()(req, res, next);
  }
});
app.use(express.urlencoded({ extended: true }));

app.use(session({
  store: new PgSession({ pool, tableName: 'session' }),
  secret: process.env.SESSION_SECRET || 'ad-engine-secret-key-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000, httpOnly: true, secure: false, sameSite: 'lax' },
}));

app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
  try {
    const { rows } = await pool.query(
      `SELECT sa.*, s.name as seller_name, s.industry, s.plan
       FROM seller_accounts sa LEFT JOIN sellers s ON sa.seller_id = s.id WHERE sa.id = $1`, [id]
    );
    done(null, rows[0] || null);
  } catch (err) { done(err); }
});

passport.use(new LocalStrategy({ usernameField: 'email', passwordField: 'password' },
  async (email, password, done) => {
    try {
      const { rows } = await pool.query('SELECT * FROM seller_accounts WHERE email = $1', [email]);
      const user = rows[0];
      if (!user) return done(null, false, { message: 'No account found with that email.' });
      if (!user.password_hash) return done(null, false, { message: 'Please sign in with Google.' });
      const match = await bcrypt.compare(password, user.password_hash);
      if (!match) return done(null, false, { message: 'Incorrect password.' });
      await pool.query('UPDATE seller_accounts SET last_login=now() WHERE id=$1', [user.id]);
      return done(null, user);
    } catch (err) { return done(err); }
  }
));

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_ID !== 'your-google-client-id') {
  passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_CALLBACK_URL || 'http://localhost:3001/auth/google/callback',
  }, async (accessToken, refreshToken, profile, done) => {
    try {
      const email = profile.emails[0].value;
      const googleId = profile.id;
      const avatarUrl = profile.photos?.[0]?.value;
      const displayName = profile.displayName;
      let { rows } = await pool.query('SELECT * FROM seller_accounts WHERE google_id=$1 OR email=$2', [googleId, email]);
      let user = rows[0];
      if (user) {
        await pool.query('UPDATE seller_accounts SET google_id=$1,avatar_url=$2,last_login=now() WHERE id=$3', [googleId, avatarUrl, user.id]);
      } else {
        const sellerRes = await pool.query(
          `INSERT INTO sellers (id,name,email,industry,plan,balance,contact_info,status,approval_status,created_at,updated_at)
           VALUES (uuid_generate_v4(),$1,$2,'General','starter',0,'{}','active','pending_review',now(),now()) RETURNING *`,
          [displayName, email]
        );
        const accountRes = await pool.query(
          `INSERT INTO seller_accounts (id,seller_id,email,google_id,google_email,avatar_url,role,is_verified,last_login,created_at,updated_at)
           VALUES (uuid_generate_v4(),$1,$2,$3,$4,$5,'seller',true,now(),now(),now()) RETURNING *`,
          [sellerRes.rows[0].id, email, googleId, email, avatarUrl]
        );
        user = accountRes.rows[0];

        // Send admin notification for new Google OAuth registration
        sendNewSellerAdminNotification({
          name: displayName,
          email,
          industry: 'General',
          location: null
        });
      }
      return done(null, user);
    } catch (err) { return done(err); }
  }));
}


// ── Role-based access control ─────────────────────────────────
function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

// Check if seller is approved (admins always pass, sellers must be approved)
async function checkSellerApproved(req, res, next) {
  // Admins bypass approval check
  if (req.user?.role === 'admin') return next();

  const sellerId = req.user?.seller_id;
  if (!sellerId) return next(); // No seller_id means not a seller account

  try {
    const result = await pool.query(
      'SELECT approval_status FROM sellers WHERE id = $1',
      [sellerId]
    );
    if (result.rows.length > 0) {
      const status = result.rows[0].approval_status;
      if (status !== 'approved') {
        let message = 'Your account is pending admin review. You will be notified when approved.';
        if (status === 'rejected') {
          message = 'Your account application was not approved.';
        } else if (status === 'suspended') {
          message = 'Your account has been suspended.';
        }
        return res.status(403).json({ error: message, approval_status: status });
      }
    }
    next();
  } catch (err) {
    console.error('Error checking seller approval:', err);
    next(); // Fail open on error to not break existing functionality
  }
}

// Get seller_id for current user (admin gets null = all, seller gets their id)
async function getSellerFilter(req) {
  if (req.user?.role === 'admin') return null;
  // seller_id is included in JWT token
  return req.user?.seller_id || null;
}

function generateToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role, seller_id: user.seller_id },
    process.env.SESSION_SECRET || 'ad-engine-secret-key',
    { expiresIn: '7d' }
  );
}

function buildServicePrincipal() {
  return {
    id: 'mcp-service',
    email: 'mcp-service@internal',
    role: 'admin',
    seller_id: null,
    auth_type: 'service',
  };
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '').trim());
}

function requireAuth(req, res, next) {
  if (req.isAuthenticated()) return next();

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    const serviceToken = (process.env.MCP_SERVICE_TOKEN || '').trim();

    if (serviceToken && token === serviceToken) {
      req.user = buildServicePrincipal();
      return next();
    }

    try {
      const decoded = jwt.verify(token, process.env.SESSION_SECRET || 'ad-engine-secret-key');
      req.user = decoded;
      return next();
    } catch {
      return res.status(401).json({ error: 'Invalid token' });
    }
  }
  res.status(401).json({ error: 'Not authenticated' });
}

function safeUser(user) {
  const { password_hash, ...safe } = user;
  return safe;
}

// ── BUYER JWT AUTH ────────────────────────────────────────────
function generateBuyerToken(buyer) {
  return jwt.sign(
    { id: buyer.id, email: buyer.email, type: 'buyer' },
    process.env.SESSION_SECRET || 'ad-engine-secret-key',
    { expiresIn: '30d' }
  );
}

function verifyBuyerToken(req, res, next) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    try {
      const decoded = jwt.verify(token, process.env.SESSION_SECRET || 'ad-engine-secret-key');
      if (decoded.type !== 'buyer') {
        return res.status(401).json({ error: 'Invalid buyer token' });
      }
      req.buyer = decoded;
      return next();
    } catch {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
  }
  res.status(401).json({ error: 'Buyer authentication required' });
}

// ── AUTH ROUTES ───────────────────────────────────────────────
app.post('/auth/register', async (req, res) => {
  const { name, email, password, industry, location } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password are required.' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  try {
    // Ensure email verification columns and fraud logs table exist
    await ensureGeoLogTables();
    await ensureFraudLogsTable();

    // Fraud detection check before registration
    const clientIp = getClientIp(req);
    const fraudResult = await calculateFraudScore(clientIp, null, pool);

    // Block registration if fraud score >= 60
    if (fraudResult.action === 'block') {
      // Log the blocked attempt
      await logFraudCheck(pool, {
        ip: clientIp,
        url: null,
        entityType: 'registration',
        entityId: null,
        fraudResult
      });
      console.log(`[Fraud] Blocked registration attempt from IP ${clientIp}, score: ${fraudResult.totalScore}`);
      return res.status(403).json({
        error: 'Registration temporarily unavailable. Please try again later or contact support.',
        fraud_blocked: true
      });
    }

    const existing = await pool.query('SELECT id FROM seller_accounts WHERE email=$1', [email]);
    if (existing.rows.length) return res.status(409).json({ error: 'An account with this email already exists.' });

    // Generate email verification token
    const verificationToken = crypto.randomUUID();
    const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    const hash = await bcrypt.hash(password, 12);
    const sellerRes = await pool.query(
      `INSERT INTO sellers (id,name,email,industry,location,plan,balance,contact_info,status,email_verified,email_verification_token,email_verification_expires,approval_status,created_at,updated_at)
       VALUES (uuid_generate_v4(),$1,$2,$3,$4,'starter',0,'{}','active',false,$5,$6,'pending_review',now(),now()) RETURNING *`,
      [name, email, industry || 'General', location || null, verificationToken, verificationExpires]
    );
    const accountRes = await pool.query(
      `INSERT INTO seller_accounts (id,seller_id,email,password_hash,role,is_verified,created_at,updated_at)
       VALUES (uuid_generate_v4(),$1,$2,$3,'seller',true,now(),now()) RETURNING *`,
      [sellerRes.rows[0].id, email, hash]
    );

    // Log seller geolocation on registration (pass claimed location for comparison)
    logSellerGeo(sellerRes.rows[0].id, req, location || null);

    // Log fraud check result (for review-flagged or allowed registrations)
    await logFraudCheck(pool, {
      ip: clientIp,
      url: null,
      entityType: 'registration',
      entityId: sellerRes.rows[0].id,
      fraudResult
    });
    if (fraudResult.action === 'review') {
      console.log(`[Fraud] Flagged registration for review: seller ${sellerRes.rows[0].id}, score: ${fraudResult.totalScore}`);
    }

    // Send verification email
    sendVerificationEmail(email, name, verificationToken);

    // Send admin notification email for new seller registration
    sendNewSellerAdminNotification({
      name,
      email,
      industry: industry || 'General',
      location: location || null
    });

    // NUCLEAR OPTION: Do NOT auto-login after registration
    // Pending sellers must manually log in after admin approval
    // This prevents any possibility of accessing the dashboard before approval
    res.json({
      success: true,
      requiresLogin: true,
      approval_status: 'pending_review',
      message: 'Registration successful! Please check your email to verify your account. Your account is pending admin review - you will be notified when approved.'
    });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Registration failed.' }); }
});

app.post('/auth/login', (req, res, next) => {
  passport.authenticate('local', async (err, user, info) => {
    if (err) return res.status(500).json({ error: 'Login error.' });
    if (!user) return res.status(401).json({ error: info?.message || 'Invalid credentials.' });
    req.login(user, async (loginErr) => {
      if (loginErr) return res.status(500).json({ error: 'Session error.' });
      const token = generateToken(user);
      const safeUserObj = safeUser(user);

      // Look up seller's email_verified, approval_status, and location
      let emailVerified = true; // Default for admin accounts
      let approvalStatus = 'approved'; // Default for admin accounts
      let seller = null;

      if (user.seller_id) {
        try {
          const sellerRes = await pool.query(
            'SELECT id, name, email, location, email_verified, approval_status FROM sellers WHERE id = $1',
            [user.seller_id]
          );
          if (sellerRes.rows.length) {
            seller = sellerRes.rows[0];
            emailVerified = seller.email_verified === true;
            approvalStatus = seller.approval_status || 'pending_review';

            // Geo monitoring: log login location and check for suspicious activity
            const geoResult = await logSellerLoginGeo(user.seller_id, seller, req);

            // If auto-suspended due to suspicious locations, return 403
            if (geoResult.suspended) {
              req.logout(() => {});
              return res.status(403).json({
                error: geoResult.reason,
                approval_status: 'suspended'
              });
            }
          }
        } catch (e) {
          console.error('Failed to check seller status:', e);
        }
      }

      res.json({
        success: true,
        user: { ...safeUserObj, email_verified: emailVerified, approval_status: approvalStatus },
        token,
        email_verified: emailVerified,
        approval_status: approvalStatus
      });
    });
  })(req, res, next);
});

app.post('/auth/logout', (req, res) => {
  req.logout(() => { req.session.destroy(); res.json({ success: true }); });
});

// ── EMAIL VERIFICATION ROUTES ────────────────────────────────────
app.get('/auth/verify-email', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: 'Verification token is required.' });

  try {
    await ensureGeoLogTables(); // Ensure columns exist

    const result = await pool.query(
      `SELECT id, name, email_verified, email_verification_expires, geo_verified
       FROM sellers WHERE email_verification_token = $1`,
      [token]
    );

    if (!result.rows.length) {
      return res.status(400).json({ error: 'Invalid or expired verification link.' });
    }

    const seller = result.rows[0];

    if (seller.email_verified) {
      return res.json({ success: true, seller_name: seller.name, message: 'Email already verified.' });
    }

    if (new Date(seller.email_verification_expires) < new Date()) {
      return res.status(400).json({ error: 'Verification link has expired. Please request a new one.' });
    }

    // Update seller: set email_verified = true, clear token, update is_verified if geo_verified
    const isFullyVerified = seller.geo_verified === true;
    await pool.query(
      `UPDATE sellers SET
         email_verified = true,
         email_verification_token = NULL,
         email_verification_expires = NULL,
         is_verified = $2,
         updated_at = NOW()
       WHERE id = $1`,
      [seller.id, isFullyVerified]
    );

    res.json({
      success: true,
      seller_name: seller.name,
      is_verified: isFullyVerified,
      message: isFullyVerified
        ? 'Email verified! Your account is now fully verified.'
        : 'Email verified! Complete geo verification to fully verify your account.'
    });
  } catch (err) {
    console.error('Email verification error:', err);
    res.status(500).json({ error: 'Verification failed. Please try again.' });
  }
});

// Rate limiter for resend verification (3 per hour)
const resendVerificationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3,
  message: { error: 'Too many verification requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

app.post('/auth/resend-verification', requireAuth, resendVerificationLimiter, async (req, res) => {
  try {
    await ensureGeoLogTables();

    const sellerId = req.user?.seller_id;
    if (!sellerId) {
      return res.status(400).json({ error: 'No seller account found.' });
    }

    const sellerRes = await pool.query(
      'SELECT id, name, email, email_verified FROM sellers WHERE id = $1',
      [sellerId]
    );

    if (!sellerRes.rows.length) {
      return res.status(404).json({ error: 'Seller not found.' });
    }

    const seller = sellerRes.rows[0];

    if (seller.email_verified) {
      return res.json({ success: true, message: 'Email is already verified.' });
    }

    // Generate new token
    const verificationToken = crypto.randomUUID();
    const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await pool.query(
      `UPDATE sellers SET
         email_verification_token = $2,
         email_verification_expires = $3,
         updated_at = NOW()
       WHERE id = $1`,
      [seller.id, verificationToken, verificationExpires]
    );

    // Send verification email
    const sent = await sendVerificationEmail(seller.email, seller.name, verificationToken);

    if (sent) {
      res.json({ success: true, message: 'Verification email sent. Please check your inbox.' });
    } else {
      res.status(500).json({ error: 'Failed to send verification email.' });
    }
  } catch (err) {
    console.error('Resend verification error:', err);
    res.status(500).json({ error: 'Failed to resend verification email.' });
  }
});

app.get('/auth/me', async (req, res) => {
  // Helper to add email_verified and approval_status to user object
  async function addSellerStatus(user) {
    if (!user.seller_id) return { ...user, email_verified: true, approval_status: 'approved' };
    try {
      const sellerRes = await pool.query(
        'SELECT email_verified, approval_status FROM sellers WHERE id = $1',
        [user.seller_id]
      );
      if (sellerRes.rows.length) {
        const emailVerified = sellerRes.rows[0].email_verified === true;
        const approvalStatus = sellerRes.rows[0].approval_status || 'pending_review';
        return { ...user, email_verified: emailVerified, approval_status: approvalStatus };
      }
      return { ...user, email_verified: true, approval_status: 'approved' };
    } catch {
      return { ...user, email_verified: true, approval_status: 'approved' };
    }
  }

  if (req.isAuthenticated()) {
    const userWithStatus = await addSellerStatus(safeUser(req.user));
    return res.json({ user: userWithStatus });
  }

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    const serviceToken = (process.env.MCP_SERVICE_TOKEN || '').trim();

    if (serviceToken && token === serviceToken) {
      return res.json({ user: buildServicePrincipal() });
    }

    try {
      const decoded = jwt.verify(token, process.env.SESSION_SECRET || 'ad-engine-secret-key');
      const userWithStatus = await addSellerStatus(decoded);
      return res.json({ user: userWithStatus });
    } catch {
      return res.status(401).json({ error: 'Invalid token' });
    }
  }
  res.status(401).json({ error: 'Not authenticated' });
});

app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));
app.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: `${process.env.CLIENT_URL || 'http://localhost:3000'}/login?error=google` }),
  (req, res) => res.redirect(process.env.CLIENT_URL || 'http://localhost:3000')
);

// ── API ROUTES (protected) ────────────────────────────────────
app.get('/api/sellers', requireAuth, async (req, res) => {
  const sellerFilter = await getSellerFilter(req);
  let sql = `SELECT s.*, COUNT(DISTINCT p.id) as product_count, COUNT(DISTINCT a.id) as ad_count
    FROM sellers s
    LEFT JOIN products p ON p.seller_id = s.id
    LEFT JOIN ads a ON a.product_id = p.id`;
  const params = [];
  if (sellerFilter) { params.push(sellerFilter); sql += ` WHERE s.id = $1`; }
  sql += ` GROUP BY s.id ORDER BY s.created_at DESC`;
  const { rows } = await pool.query(sql, params);
  res.json(rows);
});

app.get('/api/sellers/:id/billing-status', requireAuth, async (req, res) => {
  try {
    if (!isUuid(req.params.id)) {
      return res.status(400).json({ error: 'Seller id must be a valid UUID' });
    }

    const sellerFilter = await getSellerFilter(req);
    if (sellerFilter && sellerFilter !== req.params.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const sellerSql = `
      SELECT s.*,
             COUNT(DISTINCT p.id) as product_count,
             COUNT(DISTINCT a.id) as ad_count,
             COALESCE(SUM(a.spent), 0) as ad_spend_total
      FROM sellers s
      LEFT JOIN products p ON p.seller_id = s.id
      LEFT JOIN ads a ON a.product_id = p.id
      WHERE s.id = $1
      GROUP BY s.id
    `;
    const sellerRes = await pool.query(sellerSql, [req.params.id]);
    const seller = sellerRes.rows[0];
    if (!seller) {
      return res.status(404).json({ error: 'Seller not found' });
    }

    let recentTransactions = [];
    let transactionSummary = {
      transaction_count: 0,
      total_charges: 0,
      total_credits: 0,
      last_transaction_at: null,
      source: 'unavailable',
    };

    try {
      const txRes = await pool.query(
        `SELECT *
         FROM billing_transactions
         WHERE seller_id = $1
         ORDER BY COALESCE(created_at, updated_at, now()) DESC
         LIMIT 10`,
        [req.params.id]
      );
      recentTransactions = txRes.rows;

      const summaryRes = await pool.query(
        `SELECT
           COUNT(*) as transaction_count,
           COALESCE(SUM(CASE WHEN amount >= 0 THEN amount ELSE 0 END), 0) as total_charges,
           COALESCE(SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END), 0) as total_credits,
           MAX(COALESCE(created_at, updated_at)) as last_transaction_at
         FROM billing_transactions
         WHERE seller_id = $1`,
        [req.params.id]
      );
      transactionSummary = {
        ...summaryRes.rows[0],
        source: 'billing_transactions',
      };
    } catch (txErr) {
      console.warn('Billing transaction lookup unavailable:', txErr.message);
    }

    res.json({
      seller_id: seller.id,
      seller_name: seller.name,
      email: seller.email,
      plan: seller.plan,
      status: seller.status,
      is_verified: seller.is_verified,
      balance: seller.balance,
      product_count: parseInt(seller.product_count || 0, 10),
      ad_count: parseInt(seller.ad_count || 0, 10),
      ad_spend_total: parseFloat(seller.ad_spend_total || 0),
      transaction_summary: {
        transaction_count: parseInt(transactionSummary.transaction_count || 0, 10),
        total_charges: parseFloat(transactionSummary.total_charges || 0),
        total_credits: parseFloat(transactionSummary.total_credits || 0),
        last_transaction_at: transactionSummary.last_transaction_at,
        source: transactionSummary.source,
      },
      recent_transactions: recentTransactions,
    });
  } catch (err) {
    console.error('Error loading seller billing status:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/sellers', requireAuth, async (req, res) => {
  const { name, email, industry, plan, balance, contact_info } = req.body;
  const { rows } = await pool.query(
    `INSERT INTO sellers (id,name,email,industry,plan,balance,contact_info,status,created_at,updated_at)
     VALUES (uuid_generate_v4(),$1,$2,$3,$4,$5,$6,'active',now(),now()) RETURNING *`,
    [name, email, industry, plan, balance || 0, JSON.stringify(contact_info || {})]
  );
  res.json(rows[0]);
});
app.put('/api/sellers/:id', requireAuth, async (req, res) => {
  const { name, email, industry, plan, balance, location, is_verified, business_registration } = req.body;
  const { rows } = await pool.query(
    `UPDATE sellers SET name=$1,email=$2,industry=$3,plan=$4,balance=$5,location=$6,is_verified=$7,business_registration=$8,verified_at=CASE WHEN $7=true AND verified_at IS NULL THEN now() ELSE verified_at END,updated_at=now() WHERE id=$9 RETURNING *`,
    [name, email, industry, plan, balance, location || null, is_verified || false, business_registration || null, req.params.id]
  );
  res.json(rows[0]);
});
app.delete('/api/sellers/:id', requireAuth, requireAdmin, async (req, res) => {
  const sellerId = req.params.id;
  try {
    // Get all product IDs for this seller
    const productsRes = await pool.query('SELECT id FROM products WHERE seller_id = $1', [sellerId]);
    const productIds = productsRes.rows.map(r => r.id);

    if (productIds.length > 0) {
      // Get all ad IDs for those products
      const adsRes = await pool.query('SELECT id FROM ads WHERE product_id = ANY($1)', [productIds]);
      const adIds = adsRes.rows.map(r => r.id);

      if (adIds.length > 0) {
        // Delete ad_embeddings for those ads
        await pool.query('DELETE FROM ad_embeddings WHERE ad_id = ANY($1)', [adIds]);
        // Delete ad_matches for those ads
        await pool.query('DELETE FROM ad_matches WHERE ad_id = ANY($1)', [adIds]);
        // Delete ads
        await pool.query('DELETE FROM ads WHERE id = ANY($1)', [adIds]);
      }

      // Delete products
      await pool.query('DELETE FROM products WHERE id = ANY($1)', [productIds]);
    }

    // Delete seller (cascades to seller_geo_log, billing_support_tickets, seller_accounts)
    await pool.query('DELETE FROM sellers WHERE id = $1', [sellerId]);

    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting seller:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/products', requireAuth, checkSellerApproved, async (req, res) => {
  const sellerFilter = await getSellerFilter(req);
  let sql = `SELECT p.*, s.name as seller_name FROM products p JOIN sellers s ON p.seller_id=s.id`;
  const params = [];
  if (sellerFilter) { params.push(sellerFilter); sql += ` WHERE p.seller_id = $1`; }
  sql += ` ORDER BY p.created_at DESC`;
  const { rows } = await pool.query(sql, params);
  res.json(rows);
});

app.post('/api/products', requireAuth, checkSellerApproved, async (req, res) => {
  const { seller_id, title, description, price, currency, category, attributes, product_url } = req.body;
  const { rows } = await pool.query(
    `INSERT INTO products (id,seller_id,title,description,price,currency,category,attributes,product_url,status,created_at,updated_at)
   VALUES (uuid_generate_v4(),$1,$2,$3,$4,$5,$6,$7,$8,'active',now(),now()) RETURNING *`,
    [seller_id, title, description, price, currency || 'USD', category, JSON.stringify(attributes || {}), product_url || null]
  );
  res.json(rows[0]);
});

app.put('/api/products/:id', requireAuth, checkSellerApproved, async (req, res) => {
  try {
    const { title, description, price, category, status, product_url, seller_id } = req.body;
    const { rows } = await pool.query(
      `UPDATE products
       SET title=$1, description=$2, price=$3, category=$4,
           status=COALESCE($5, status),
           product_url=$6,
           seller_id=COALESCE($7, seller_id),
           updated_at=now()
       WHERE id=$8 RETURNING *`,
      [title, description, price, category, status || null, product_url || null, seller_id || null, req.params.id]
    );
    if (!rows[0]) {
      return res.status(404).json({ error: 'Product not found' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error('Error updating product:', err);
    res.status(500).json({ error: err.message });
  }
});
app.delete('/api/products/:id', requireAuth, checkSellerApproved, async (req, res) => {
  await pool.query('DELETE FROM products WHERE id=$1', [req.params.id]);
  res.json({ success: true });
});

app.get('/api/ads', requireAuth, checkSellerApproved, async (req, res) => {
  const sellerFilter = await getSellerFilter(req);
  let sql = `SELECT a.*, p.title as product_title, p.category, p.product_url, p.image_url as product_image_url, s.name as seller_name, s.location as seller_location, s.is_verified as seller_verified
    FROM ads a JOIN products p ON a.product_id=p.id JOIN sellers s ON p.seller_id=s.id`;
  const params = [];
  if (sellerFilter) { params.push(sellerFilter); sql += ` WHERE p.seller_id = $1`; }
  sql += ` ORDER BY a.created_at DESC`;
  const { rows } = await pool.query(sql, params);
  res.json(rows);
});

app.get('/api/ads/:id', requireAuth, checkSellerApproved, async (req, res) => {
  try {
    if (!isUuid(req.params.id)) {
      return res.status(400).json({ error: 'Ad id must be a valid UUID' });
    }

    const sellerFilter = await getSellerFilter(req);
    let sql = `SELECT a.*, p.title as product_title, p.category, p.product_url, p.image_url as product_image_url,
                      s.name as seller_name, s.location as seller_location, s.is_verified as seller_verified,
                      p.seller_id
               FROM ads a
               JOIN products p ON a.product_id = p.id
               JOIN sellers s ON p.seller_id = s.id
               WHERE a.id = $1`;
    const params = [req.params.id];
    if (sellerFilter) {
      sql += ' AND p.seller_id = $2';
      params.push(sellerFilter);
    }

    const { rows } = await pool.query(sql, params);
    if (!rows[0]) {
      return res.status(404).json({ error: 'Ad not found' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error('Error loading ad by id:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/ads', requireAuth, checkSellerApproved, async (req, res) => {
  try {
    const sellerId = req.user.seller_id;

    // Check story limit for non-admin users
    if (sellerId && req.user.role !== 'admin') {
      await ensureSubscriptionsTable();

      // Get seller's subscription plan
      const subRes = await pool.query(
        'SELECT plan, stories_included FROM subscriptions WHERE seller_id = $1',
        [sellerId]
      );

      const subscription = subRes.rows[0];
      const plan = subscription?.plan || 'free';
      const planConfig = STRIPE_PLANS[plan] || STRIPE_PLANS.free;
      // Use planConfig as source of truth for stories limit
      const storiesLimit = planConfig.stories;

      // Count seller's active ads/stories (999+ = effectively unlimited)
      if (storiesLimit < 999) {
        const countRes = await pool.query(`
          SELECT COUNT(*) as count
          FROM ads a
          JOIN products p ON a.product_id = p.id
          WHERE p.seller_id = $1 AND a.status != 'deleted'
        `, [sellerId]);

        const storiesUsed = parseInt(countRes.rows[0]?.count || 0, 10);

        if (storiesUsed >= storiesLimit) {
          return res.status(403).json({
            error: 'Story limit reached. Upgrade your plan to add more Seller Stories.',
            upgrade_required: true,
            stories_used: storiesUsed,
            stories_included: storiesLimit,
            current_plan: plan
          });
        }
      }
    }

    const { product_id, format, headline, body_copy, intent_tags, cost_per_match, daily_budget, total_budget } = req.body;

    // Fraud detection: check product URL safety and domain age
    await ensureFraudLogsTable();
    const productRes = await pool.query('SELECT product_url FROM products WHERE id = $1', [product_id]);
    const productUrl = productRes.rows[0]?.product_url;

    if (productUrl) {
      const [urlSafetyResult, domainAgeResult] = await Promise.all([
        checkUrlSafety(productUrl),
        checkDomainAge(productUrl)
      ]);

      const clientIp = getClientIp(req);
      const totalScore = urlSafetyResult.score + domainAgeResult.score;
      const action = totalScore >= 60 ? 'block' : (totalScore >= 30 ? 'review' : 'allow');

      // Log the fraud check
      await logFraudCheck(pool, {
        ip: clientIp,
        url: productUrl,
        entityType: 'ad_submission',
        entityId: null, // Ad not created yet
        fraudResult: {
          totalScore,
          action,
          results: {
            ipReputation: { score: 0, details: 'Not checked for ads' },
            urlSafety: urlSafetyResult,
            domainAge: domainAgeResult,
            multipleAccounts: { score: 0, details: 'Not checked for ads', count: 0 }
          },
          timestamp: new Date().toISOString()
        }
      });

      // Block ad creation if URL is flagged as unsafe by Google Safe Browsing
      if (!urlSafetyResult.safe) {
        console.log(`[Fraud] Blocked ad submission with unsafe URL: ${productUrl}`);
        return res.status(403).json({
          error: 'The product URL has been flagged as potentially unsafe. Please verify your URL and try again.',
          fraud_blocked: true
        });
      }

      // Log warning for new domains but don't block
      if (domainAgeResult.score >= 15) {
        console.log(`[Fraud] Ad submission from new domain: ${productUrl}, age score: ${domainAgeResult.score}`);
      }
    }

    const { rows } = await pool.query(
      `INSERT INTO ads (id,product_id,format,headline,body_copy,intent_tags,cost_per_match,daily_budget,total_budget,spent,status,created_at,updated_at)
       VALUES (uuid_generate_v4(),$1,$2,$3,$4,$5,$6,$7,$8,0,'active',now(),now()) RETURNING *`,
      [product_id, format, headline, body_copy, JSON.stringify(intent_tags || []), cost_per_match || 0.01, daily_budget || 50, total_budget || 500]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error('Error creating ad:', err);
    res.status(500).json({ error: 'Failed to create ad' });
  }
});
app.put('/api/ads/:id', requireAuth, checkSellerApproved, async (req, res) => {
  const { headline, body_copy, format, cost_per_match, daily_budget, status } = req.body;
  const { rows } = await pool.query(
    `UPDATE ads SET headline=$1,body_copy=$2,format=$3,cost_per_match=$4,daily_budget=$5,status=$6,updated_at=now() WHERE id=$7 RETURNING *`,
    [headline, body_copy, format, cost_per_match, daily_budget, status, req.params.id]
  );
  res.json(rows[0]);
});
app.delete('/api/ads/:id', requireAuth, checkSellerApproved, async (req, res) => {
  await pool.query('DELETE FROM ads WHERE id=$1', [req.params.id]);
  res.json({ success: true });
});

app.get('/api/buyers', requireAuth, requireAdmin, async (req, res) => {
  try {
    // Join buyers with their most recent geo location via buyer_sessions
    const { rows } = await pool.query(`
      SELECT
        b.*,
        geo.city,
        geo.state,
        geo.country,
        geo.ip as last_ip
      FROM buyers b
      LEFT JOIN LATERAL (
        SELECT bgl.city, bgl.state, bgl.country, bgl.ip
        FROM buyer_sessions bs
        JOIN buyer_geo_log bgl ON bgl.session_id = bs.id::text
        WHERE bs.buyer_id = b.id
        ORDER BY bgl.created_at DESC
        LIMIT 1
      ) geo ON true
      ORDER BY b.created_at DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error('Error fetching buyers:', err);
    res.status(500).json({ error: err.message });
  }
});

// Registered buyers (Google Sign-In)
app.get('/api/admin/registered-buyers', requireAuth, requireAdmin, async (req, res) => {
  try {
    await ensureBuyerAccountsTable();
    const { rows } = await pool.query(`
      SELECT id, google_id, email, name, avatar_url, created_at, last_login
      FROM buyer_accounts
      ORDER BY created_at DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error('Error fetching registered buyers:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/stats', requireAuth, checkSellerApproved, async (req, res) => {
  try {
    const sellerFilter = await getSellerFilter(req);
    if (sellerFilter) {
      const [products, ads, matches] = await Promise.all([
        pool.query('SELECT COUNT(*) FROM products WHERE seller_id=$1', [sellerFilter]),
        pool.query('SELECT COUNT(*), COALESCE(SUM(spent),0) as spent FROM ads a JOIN products p ON a.product_id=p.id WHERE p.seller_id=$1', [sellerFilter]),
        pool.query('SELECT COUNT(*) FROM ad_matches m JOIN ads a ON m.ad_id=a.id JOIN products p ON a.product_id=p.id WHERE p.seller_id=$1', [sellerFilter]),
      ]);
      res.json({
        products: parseInt(products.rows[0].count),
        ads: parseInt(ads.rows[0].count),
        spent: parseFloat(ads.rows[0].spent),
        matches: parseInt(matches.rows[0].count),
      });
    } else {
      const [sellers, products, ads, buyers, matches] = await Promise.all([
        pool.query('SELECT COUNT(*) FROM sellers'),
        pool.query('SELECT COUNT(*) FROM products'),
        pool.query('SELECT COUNT(*) FROM ads'),
        pool.query('SELECT COUNT(*) FROM buyers'),
        pool.query('SELECT COUNT(*) FROM ad_matches'),
      ]);
      res.json({
        sellers: parseInt(sellers.rows[0].count),
        products: parseInt(products.rows[0].count),
        ads: parseInt(ads.rows[0].count),
        buyers: parseInt(buyers.rows[0].count),
        matches: parseInt(matches.rows[0].count),
      });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/billing/support-tickets', requireAuth, async (req, res) => {
  try {
    await ensureBillingSupportTicketsTable();

    const sellerFilter = await getSellerFilter(req);
    const requestedSellerId = String(req.query.seller_id || '').trim() || null;
    const limit = Math.max(1, Math.min(parseInt(req.query.limit || '50', 10) || 50, 200));

    if (requestedSellerId && !isUuid(requestedSellerId)) {
      return res.status(400).json({ error: 'seller_id must be a valid UUID' });
    }

    if (sellerFilter && requestedSellerId && sellerFilter !== requestedSellerId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const effectiveSellerId = sellerFilter || requestedSellerId;
    const params = [limit];
    let sql = `
      SELECT ticket_id, seller_id, seller_name, contact_email, routed_to,
             priority, subject, description, queue, status,
             created_by_id, created_by_email, created_by_role, auth_type,
             metadata, created_at, updated_at
      FROM billing_support_tickets
    `;

    if (effectiveSellerId) {
      params.unshift(effectiveSellerId);
      sql += ' WHERE seller_id = $1 ORDER BY created_at DESC LIMIT $2';
    } else {
      sql += ' ORDER BY created_at DESC LIMIT $1';
    }

    const { rows } = await pool.query(sql, params);
    res.json({
      count: rows.length,
      seller_scope: effectiveSellerId,
      tickets: rows,
    });
  } catch (err) {
    console.error('Error listing billing support tickets:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/billing/support-tickets', requireAuth, async (req, res) => {
  try {
    const { seller_id, subject, description, email, priority } = req.body;
    if (!seller_id || !subject || !description) {
      return res.status(400).json({ error: 'seller_id, subject, and description are required.' });
    }
    if (!isUuid(seller_id)) {
      return res.status(400).json({ error: 'seller_id must be a valid UUID' });
    }

    const sellerFilter = await getSellerFilter(req);
    if (sellerFilter && sellerFilter !== seller_id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const sellerRes = await pool.query(
      'SELECT id, name, email, plan, status FROM sellers WHERE id = $1',
      [seller_id]
    );
    const seller = sellerRes.rows[0];
    if (!seller) {
      return res.status(404).json({ error: 'Seller not found' });
    }

    await ensureBillingSupportTicketsTable();

    const ticketId = `bill_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const supportEmail = (process.env.SUPPORT_EMAIL || '').trim() || seller.email;
    const createdAt = new Date().toISOString();
    const normalizedPriority = String(priority || 'normal').trim() || 'normal';
    const contactEmail = (email || seller.email || '').trim();
    const createdBy = req.user || {};
    const metadata = {
      seller_plan: seller.plan,
      seller_status: seller.status,
      requester_role: createdBy.role || null,
    };

    await pool.query(
      `INSERT INTO billing_support_tickets (
         ticket_id,
         seller_id,
         seller_name,
         contact_email,
         routed_to,
         priority,
         subject,
         description,
         queue,
         status,
         created_by_id,
         created_by_email,
         created_by_role,
         auth_type,
         metadata,
         created_at,
         updated_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8,
         'billing-support', 'submitted',
         $9, $10, $11, $12, $13::jsonb, $14, $14
       )`,
      [
        ticketId,
        seller_id,
        seller.name,
        contactEmail,
        supportEmail,
        normalizedPriority,
        subject,
        description,
        createdBy.id || null,
        createdBy.email || null,
        createdBy.role || null,
        createdBy.auth_type || null,
        JSON.stringify(metadata),
        createdAt,
      ]
    );

    res.status(201).json({
      ticket_id: ticketId,
      status: 'submitted',
      queue: 'billing-support',
      seller_id,
      seller_name: seller.name,
      contact_email: contactEmail,
      routed_to: supportEmail,
      priority: normalizedPriority,
      subject,
      description,
      created_at: createdAt,
      persistence: 'database',
      note: 'Support ticket persisted in billing_support_tickets.',
    });
  } catch (err) {
    console.error('Error creating billing support ticket:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── IMAGE GENERATION ─────────────────────────────────────────
app.post('/api/ads/:id/generate-image', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT a.*, p.title as product_title, p.description as product_desc, p.category
       FROM ads a JOIN products p ON a.product_id = p.id WHERE a.id = $1`,
      [req.params.id]
    );
    const ad = rows[0];
    if (!ad) return res.status(404).json({ error: 'Ad not found' });

    const prompt = `Professional digital advertisement for "${ad.product_title}". 
      Headline: "${ad.headline}". 
      Category: ${ad.category}. 
      Style: clean modern commercial photography, white background, product-focused, 
      high quality, suitable for e-commerce. No text overlays.`;

    const response = await openai.images.generate({
      model: 'gpt-image-1',
      prompt,
      n: 1,
      size: '1024x1024',
      quality: 'auto',
    });

    const base64Image = `data:image/png;base64,${response.data[0].b64_json}`;

    // Upload to GCS and save URL
    const filename = `${req.params.id}.png`;
    const imageUrl = await uploadImageToGCS(base64Image, filename);
    await pool.query('UPDATE ads SET media_url=$1, updated_at=now() WHERE id=$2', [imageUrl, req.params.id]);

    res.json({ success: true, image_url: imageUrl });

  } catch (err) {
    console.error('DALL-E error:', err);
    res.status(500).json({ error: err.message || 'Image generation failed' });
  }
});





// ── FILE UPLOAD & MODERATION ──────────────────────────────────

// Multer config — memory storage (files go straight to GCS)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB max
  fileFilter: (req, file, cb) => {
    const allowed = [
      'image/jpeg', 'image/png', 'image/webp', 'image/gif',
      'video/mp4', 'video/webm', 'video/quicktime',
    ];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${file.mimetype} not allowed. Use JPG, PNG, WebP, MP4, WebM.`));
    }
  },
});

// ── Content moderation with GPT-4o vision ────────────────────
async function moderateImage(base64Image, mimeType) {
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: { url: `data:${mimeType};base64,${base64Image}` },
          },
          {
            type: 'text',
            text: `You are an ad content moderator. Analyze this image and return a JSON object with:
{
  "approved": true/false,
  "reason": "brief explanation",
  "issues": ["list of issues if any"],
  "categories": ["detected content categories"]
}

Reject if the image contains:
- Adult/sexual content
- Graphic violence or gore
- Hate speech or discrimination
- Misleading health claims
- Illegal products or services
- Malware or phishing indicators
- Competitor brand infringement

Approve if it is a legitimate product advertisement.
Return ONLY the JSON object, no other text.`,
          },
        ],
      }],
      max_tokens: 200,
    });

    const text = response.choices[0].message.content.trim();
    return JSON.parse(text);
  } catch (err) {
    console.error('Moderation error:', err);
    // Default to pending review if moderation fails
    return { approved: null, reason: 'Moderation service unavailable — sent to manual review', issues: [] };
  }
}

// ── Upload product image ──────────────────────────────────────
app.post('/api/products/:id/upload-image', requireAuth, checkSellerApproved, upload.single('file'), async (req, res) => {
  try {
    const { id } = req.params;
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'No file uploaded' });
    const { rows } = await pool.query('SELECT * FROM products WHERE id=$1', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Product not found' });
    const base64 = file.buffer.toString('base64');
    let moderationResult = { approved: true, reason: 'Auto-approved', issues: [] };
    if (file.mimetype.startsWith('image/')) moderationResult = await moderateImage(base64, file.mimetype);
    if (moderationResult.approved === false) return res.status(400).json({ error: 'Image rejected: ' + moderationResult.reason });
    const ext = path.extname(file.originalname) || '.jpg';
    const filename = `products/${id}${ext}`;
    const gcsFile = gcsBucket.file(filename);
    await gcsFile.save(file.buffer, { metadata: { contentType: file.mimetype } });
    const imageUrl = `https://storage.googleapis.com/${process.env.GCP_BUCKET_NAME}/${filename}`;
    await pool.query('UPDATE products SET image_url=$1, updated_at=now() WHERE id=$2', [imageUrl, id]);
    res.json({ success: true, image_url: imageUrl, moderation: moderationResult });
  } catch (err) {
    console.error('Product image upload error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Upload image ad ───────────────────────────────────────────
app.post('/api/ads/:id/upload-image', requireAuth, upload.single('file'), async (req, res) => {
  try {
    const { id } = req.params;
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'No file uploaded' });

    // Check ad exists
    const { rows } = await pool.query('SELECT * FROM ads WHERE id=$1', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Ad not found' });

    const base64 = file.buffer.toString('base64');

    // Step 1: Content moderation
    let moderationResult = { approved: true, reason: 'Auto-approved', issues: [] };
    if (file.mimetype.startsWith('image/')) {
      moderationResult = await moderateImage(base64, file.mimetype);
    }

    // Step 2: Upload to GCS
    const ext = path.extname(file.originalname) || '.jpg';
    const filename = `ads/${id}${ext}`;
    const gcsFile = gcsBucket.file(filename);
    await gcsFile.save(file.buffer, { metadata: { contentType: file.mimetype } });
    const mediaUrl = `https://storage.googleapis.com/${process.env.GCP_BUCKET_NAME}/${filename}`;

    // Step 3: Determine ad status based on moderation
    let newStatus = 'active';
    let moderationStatus = 'approved';

    if (moderationResult.approved === false) {
      newStatus = 'rejected';
      moderationStatus = 'rejected';
    } else if (moderationResult.approved === null) {
      newStatus = 'pending_review';
      moderationStatus = 'pending';
    }

    // Step 4: Update ad
    await pool.query(
      `UPDATE ads SET 
        media_url=$1, 
        status=$2,
        format=CASE WHEN format='text' THEN 'image' ELSE format END,
        updated_at=now() 
       WHERE id=$3`,
      [mediaUrl, newStatus, id]
    );

    // Step 5: Log moderation result
    await pool.query(
      `INSERT INTO ad_moderation_log (id, ad_id, status, reason, issues, created_at)
       VALUES (uuid_generate_v4(), $1, $2, $3, $4, now())`,
      [id, moderationStatus, moderationResult.reason, JSON.stringify(moderationResult.issues || [])]
    ).catch(() => { }); // ignore if table doesn't exist yet

    res.json({
      success: true,
      media_url: mediaUrl,
      status: newStatus,
      moderation: moderationResult,
    });

  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: err.message || 'Upload failed' });
  }
});

// ── Upload video ad ───────────────────────────────────────────
app.post('/api/ads/:id/upload-video', requireAuth, upload.fields([
  { name: 'video', maxCount: 1 },
  { name: 'thumbnail', maxCount: 1 },
]), async (req, res) => {
  try {
    const { id } = req.params;
    const videoFile = req.files?.video?.[0];
    const thumbnailFile = req.files?.thumbnail?.[0];

    if (!videoFile) return res.status(400).json({ error: 'No video file uploaded' });

    // Check ad exists
    const { rows } = await pool.query('SELECT * FROM ads WHERE id=$1', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Ad not found' });

    // Upload video to GCS
    const videoExt = path.extname(videoFile.originalname) || '.mp4';
    const videoFilename = `ads/videos/${id}${videoExt}`;
    const gcsVideo = gcsBucket.file(videoFilename);
    await gcsVideo.save(videoFile.buffer, { metadata: { contentType: videoFile.mimetype } });
    const videoUrl = `https://storage.googleapis.com/${process.env.GCP_BUCKET_NAME}/${videoFilename}`;

    // Upload thumbnail if provided
    let thumbnailUrl = null;
    if (thumbnailFile) {
      const thumbFilename = `ads/thumbnails/${id}.jpg`;
      const gcsThumb = gcsBucket.file(thumbFilename);
      await gcsThumb.save(thumbnailFile.buffer, { metadata: { contentType: thumbnailFile.mimetype } });
      thumbnailUrl = `https://storage.googleapis.com/${process.env.GCP_BUCKET_NAME}/${thumbFilename}`;

      // Moderate thumbnail image
      const base64Thumb = thumbnailFile.buffer.toString('base64');
      const moderation = await moderateImage(base64Thumb, thumbnailFile.mimetype);
      if (moderation.approved === false) {
        return res.status(400).json({ error: 'Thumbnail rejected: ' + moderation.reason });
      }
    }

    // Update ad
    await pool.query(
      `UPDATE ads SET 
        media_url=$1,
        thumbnail_url=$2,
        format='video',
        status='pending_review',
        updated_at=now()
       WHERE id=$3`,
      [videoUrl, thumbnailUrl, id]
    );

    res.json({
      success: true,
      video_url: videoUrl,
      thumbnail_url: thumbnailUrl,
      status: 'pending_review',
      message: 'Video uploaded successfully. Pending admin review before going live.',
    });

  } catch (err) {
    console.error('Video upload error:', err);
    res.status(500).json({ error: err.message || 'Video upload failed' });
  }
});

// ── ADMIN REVIEW QUEUE ────────────────────────────────────────
app.get('/api/admin/pending-ads', requireAuth, async (req, res) => {
  const { rows } = await pool.query(`
    SELECT a.*, p.title as product_title, s.name as seller_name, s.location as seller_location, s.is_verified as seller_verified
    FROM ads a
    JOIN products p ON a.product_id = p.id
    JOIN sellers s ON p.seller_id = s.id
    WHERE a.status IN ('pending_review', 'rejected')
    ORDER BY a.updated_at DESC
  `);
  res.json(rows);
});

app.post('/api/admin/ads/:id/approve', requireAuth, emailRateLimiter, async (req, res) => {
  await pool.query(
    `UPDATE ads SET status='active', updated_at=now() WHERE id=$1`,
    [req.params.id]
  );

  try {
    const result = await pool.query(
      `SELECT p.title, s.email, s.name
       FROM ads a
       JOIN products p ON a.product_id = p.id
       JOIN sellers s ON p.seller_id = s.id
       WHERE a.id = $1`,
      [req.params.id]
    );
    if (result.rows[0]) {
      const { title, email, name } = result.rows[0];
      // Sanitize inputs before sending email
      const sanitizedTitle = sanitizeForEmail(title);
      const sanitizedName = sanitizeForEmail(name);
      sendAdApprovedEmail(email, sanitizedName, sanitizedTitle);
    }
  } catch (emailErr) {
    console.error('Could not send approval email:', emailErr);
  }

  res.json({ success: true, status: 'active' });
});

app.post('/api/admin/ads/:id/reject', requireAuth, async (req, res) => {
  const { reason } = req.body;
  await pool.query(
    `UPDATE ads SET status='rejected', updated_at=now() WHERE id=$1`,
    [req.params.id]
  );
  res.json({ success: true, status: 'rejected', reason });
});

// ── SELLER APPROVAL QUEUE ─────────────────────────────────────

// Get pending sellers for admin review
app.get('/api/admin/sellers/pending', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        s.id, s.name, s.email, s.industry, s.location, s.plan,
        s.email_verified, s.geo_verified, s.is_verified,
        s.approval_status, s.created_at,
        gl.geo_match
      FROM sellers s
      LEFT JOIN LATERAL (
        SELECT geo_match FROM seller_geo_log
        WHERE seller_id = s.id
        ORDER BY created_at DESC LIMIT 1
      ) gl ON true
      WHERE s.approval_status = 'pending_review'
      ORDER BY s.created_at DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error('Error fetching pending sellers:', err);
    res.status(500).json({ error: 'Failed to fetch pending sellers' });
  }
});

// Get count of pending sellers (for badge)
app.get('/api/admin/sellers/pending/count', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT COUNT(*) as count FROM sellers WHERE approval_status = 'pending_review'`
    );
    res.json({ count: parseInt(rows[0].count, 10) });
  } catch (err) {
    console.error('Error fetching pending count:', err);
    res.status(500).json({ error: 'Failed to fetch pending count' });
  }
});

// Approve seller
app.put('/api/admin/sellers/:id/approve', requireAuth, requireAdmin, emailRateLimiter, async (req, res) => {
  try {
    if (!isUuid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid seller ID' });
    }

    const result = await pool.query(
      `UPDATE sellers SET approval_status = 'approved', updated_at = now()
       WHERE id = $1 RETURNING id, name, email`,
      [req.params.id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Seller not found' });
    }

    const { name, email } = result.rows[0];
    sendSellerApprovedEmail(email, name);

    res.json({ success: true, approval_status: 'approved' });
  } catch (err) {
    console.error('Error approving seller:', err);
    res.status(500).json({ error: 'Failed to approve seller' });
  }
});

// Reject seller
app.put('/api/admin/sellers/:id/reject', requireAuth, requireAdmin, emailRateLimiter, async (req, res) => {
  try {
    if (!isUuid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid seller ID' });
    }

    const result = await pool.query(
      `UPDATE sellers SET approval_status = 'rejected', updated_at = now()
       WHERE id = $1 RETURNING id, name, email`,
      [req.params.id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Seller not found' });
    }

    const { name, email } = result.rows[0];
    sendSellerRejectedEmail(email, name);

    res.json({ success: true, approval_status: 'rejected' });
  } catch (err) {
    console.error('Error rejecting seller:', err);
    res.status(500).json({ error: 'Failed to reject seller' });
  }
});

// Suspend seller
app.put('/api/admin/sellers/:id/suspend', requireAuth, requireAdmin, emailRateLimiter, async (req, res) => {
  try {
    if (!isUuid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid seller ID' });
    }

    const result = await pool.query(
      `UPDATE sellers SET approval_status = 'suspended', updated_at = now()
       WHERE id = $1 RETURNING id, name, email`,
      [req.params.id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Seller not found' });
    }

    const { name, email } = result.rows[0];
    sendSellerSuspendedEmail(email, name);

    res.json({ success: true, approval_status: 'suspended' });
  } catch (err) {
    console.error('Error suspending seller:', err);
    res.status(500).json({ error: 'Failed to suspend seller' });
  }
});

// Unsuspend (re-approve) seller
app.put('/api/admin/sellers/:id/unsuspend', requireAuth, requireAdmin, async (req, res) => {
  try {
    if (!isUuid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid seller ID' });
    }

    const result = await pool.query(
      `UPDATE sellers SET approval_status = 'approved', updated_at = now()
       WHERE id = $1 RETURNING id`,
      [req.params.id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Seller not found' });
    }

    res.json({ success: true, approval_status: 'approved' });
  } catch (err) {
    console.error('Error unsuspending seller:', err);
    res.status(500).json({ error: 'Failed to unsuspend seller' });
  }
});

// ── GEO VERIFICATION ROUTES ──────────────────────────────────

// Admin: Get ad events (impressions and clicks)
app.get('/api/admin/ad-events', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { event_type, ad_id, seller_id, start_date, end_date, limit = 500 } = req.query;

    let sql = `
      SELECT
        ae.id,
        ae.event_type,
        ae.ad_id,
        a.headline as ad_title,
        ae.seller_id,
        s.name as seller_name,
        ae.buyer_session_id,
        b.device_id as buyer_device_id,
        ae.buyer_ip,
        ae.buyer_city,
        ae.buyer_state,
        ae.buyer_country,
        ae.user_agent,
        ae.referrer,
        ae.timestamp
      FROM ad_events ae
      LEFT JOIN ads a ON ae.ad_id = a.id
      LEFT JOIN sellers s ON ae.seller_id = s.id
      LEFT JOIN buyer_sessions bs ON ae.buyer_session_id = bs.id::text
      LEFT JOIN buyers b ON bs.buyer_id = b.id
      WHERE 1=1
    `;
    const params = [];

    if (event_type && event_type !== 'all') {
      params.push(event_type);
      sql += ` AND ae.event_type = $${params.length}`;
    }

    if (ad_id) {
      params.push(ad_id);
      sql += ` AND ae.ad_id = $${params.length}`;
    }

    if (seller_id) {
      params.push(seller_id);
      sql += ` AND ae.seller_id = $${params.length}`;
    }

    if (start_date) {
      params.push(start_date);
      sql += ` AND ae.timestamp >= $${params.length}`;
    }

    if (end_date) {
      params.push(end_date);
      sql += ` AND ae.timestamp <= $${params.length}`;
    }

    params.push(parseInt(limit) || 500);
    sql += ` ORDER BY ae.timestamp DESC LIMIT $${params.length}`;

    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error('Error fetching ad events:', err);
    res.status(500).json({ error: err.message });
  }
});

// Admin: Get seller geo logs with seller info
app.get('/api/admin/seller-geo-logs', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        sgl.id,
        sgl.seller_id,
        s.name as seller_name,
        s.email as seller_email,
        s.location as claimed_location,
        sgl.ip,
        sgl.city as detected_city,
        sgl.state as detected_state,
        sgl.country as detected_country,
        sgl.geo_match,
        sgl.is_vpn,
        sgl.event_type,
        sgl.created_at
      FROM seller_geo_log sgl
      LEFT JOIN sellers s ON sgl.seller_id = s.id
      ORDER BY sgl.created_at DESC
      LIMIT 100
    `);
    res.json(rows);
  } catch (err) {
    console.error('Error fetching seller geo logs:', err);
    res.status(500).json({ error: err.message });
  }
});

// Admin: Get login history for a specific seller
app.get('/api/admin/seller-login-history/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    if (!isUuid(id)) {
      return res.status(400).json({ error: 'Seller ID must be a valid UUID' });
    }

    // Get seller info
    const sellerRes = await pool.query(
      'SELECT id, name, email, location FROM sellers WHERE id = $1',
      [id]
    );
    if (!sellerRes.rows.length) {
      return res.status(404).json({ error: 'Seller not found' });
    }
    const seller = sellerRes.rows[0];

    // Get all login/registration geo logs for this seller
    const { rows: logs } = await pool.query(`
      SELECT
        id,
        ip,
        city,
        state,
        country,
        geo_match,
        is_vpn,
        event_type,
        created_at
      FROM seller_geo_log
      WHERE seller_id = $1
      ORDER BY created_at DESC
      LIMIT 50
    `, [id]);

    // Calculate mismatch stats
    const mismatchCount = logs.filter(l => !l.geo_match).length;
    const vpnCount = logs.filter(l => l.is_vpn).length;

    res.json({
      seller: {
        id: seller.id,
        name: seller.name,
        email: seller.email,
        registered_location: seller.location
      },
      stats: {
        total_logins: logs.length,
        mismatches: mismatchCount,
        vpn_logins: vpnCount
      },
      logs
    });
  } catch (err) {
    console.error('Error fetching seller login history:', err);
    res.status(500).json({ error: err.message });
  }
});

// Admin: Get buyer geo logs
app.get('/api/admin/buyer-geo-logs', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        id,
        session_id,
        ip,
        city,
        state,
        country,
        created_at
      FROM buyer_geo_log
      ORDER BY created_at DESC
      LIMIT 100
    `);
    res.json(rows);
  } catch (err) {
    console.error('Error fetching buyer geo logs:', err);
    res.status(500).json({ error: err.message });
  }
});

// Admin: Get fraud logs
app.get('/api/admin/fraud-logs', requireAuth, requireAdmin, async (req, res) => {
  try {
    await ensureFraudLogsTable();
    const { action, entity_type, limit = 100 } = req.query;

    let sql = `
      SELECT
        id,
        ip_address,
        url,
        entity_type,
        entity_id,
        total_score,
        action,
        ip_reputation_score,
        ip_reputation_details,
        url_safety_score,
        url_safety_details,
        domain_age_score,
        domain_age_details,
        multi_account_score,
        multi_account_details,
        created_at
      FROM fraud_logs
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;

    if (action) {
      sql += ` AND action = $${paramIndex++}`;
      params.push(action);
    }
    if (entity_type) {
      sql += ` AND entity_type = $${paramIndex++}`;
      params.push(entity_type);
    }

    sql += ` ORDER BY created_at DESC LIMIT $${paramIndex}`;
    params.push(parseInt(limit, 10));

    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error('Error fetching fraud logs:', err);
    res.status(500).json({ error: err.message });
  }
});

// Seller: Get own most recent geo log entry
app.get('/api/sellers/my-geo', requireAuth, async (req, res) => {
  try {
    const sellerId = req.user?.seller_id;
    if (!sellerId) {
      return res.status(400).json({ error: 'No seller associated with this account' });
    }

    const { rows } = await pool.query(`
      SELECT
        city,
        state,
        country,
        ip,
        created_at
      FROM seller_geo_log
      WHERE seller_id = $1
      ORDER BY created_at DESC
      LIMIT 1
    `, [sellerId]);

    if (rows.length === 0) {
      return res.json({ city: null, state: null, country: null });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error('Error fetching seller geo:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── EXTENSION ENDPOINT ───────────────────────────────────────
// Accepts raw page context from extension, extracts intent server-side
// Buyers don't need OpenAI API key — server handles everything
app.post('/api/extension/match', async (req, res) => {
  const { page_title, page_url, page_text, search_query, history_topics, bookmark_topics, device_id, limit = 6 } = req.body;

  if (!page_title && !page_url && !search_query) {
    return res.status(400).json({ error: 'Page context required' });
  }

  try {
    // Step 1: Extract intent from page context using GPT
    const contextPrompt = `You are a privacy-first buyer intent extractor.

Analyze this browsing context and extract the buyer's shopping intent as 5-10 keywords.
Focus on: products of interest, categories, price signals, features mentioned.
Return ONLY a comma-separated list of keywords. No explanation.

Page title: ${page_title || ''}
Page URL: ${page_url || ''}
Search query on page: ${search_query || ''}
Page content: ${(page_text || '').slice(0, 500)}
Recent browsing topics: ${(history_topics || []).slice(0, 10).join(', ')}
Bookmark topics: ${(bookmark_topics || []).slice(0, 10).join(', ')}`;

    const gptResponse = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: contextPrompt }],
      max_tokens: 100,
      temperature: 0.3,
    });

    const intent = gptResponse.choices[0].message.content.trim();

    // Step 2: Get candidate ads
    const { rows: candidates } = await pool.query(`
      SELECT a.id, a.headline, a.body_copy, a.format, a.media_url,
             a.cost_per_match, a.intent_tags,
             p.title as product_title, p.description as product_desc,
             p.price, p.category, p.currency,
             s.name as seller_name, s.industry
      FROM ads a
      JOIN products p ON a.product_id = p.id
      JOIN sellers s ON p.seller_id = s.id
      WHERE a.status = 'active'
      ORDER BY a.cost_per_match DESC
      LIMIT 50
    `);

    if (!candidates.length) return res.json({ matches: [], intent });

    // Step 3: Match ads to intent using GPT
    const adList = candidates.map((a, i) =>
      `[${i}] "${a.headline}" — ${a.product_title} (${a.category}) — Tags: ${Array.isArray(a.intent_tags) ? a.intent_tags.join(', ') : a.intent_tags
      } — Price: $${a.price}`
    ).join('\n');

    const matchPrompt = `You are a buyer intent matching engine. Be generous with matching.

Buyer intent keywords: "${intent}"

Available ads:
${adList}

Return the top ${limit} most relevant ad indices as a JSON array ordered by relevance.
Be inclusive — if loosely related, include it.
Respond ONLY with a JSON array like: [3, 0, 7, 2]
No explanation.`;

    const matchResponse = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: matchPrompt }],
      max_tokens: 200,
      temperature: 0.3,
    });

    let indices = [];
    try {
      indices = JSON.parse(matchResponse.choices[0].message.content.trim());
    } catch {
      indices = candidates.slice(0, limit).map((_, i) => i);
    }

    const matches = indices
      .filter(i => i >= 0 && i < candidates.length)
      .slice(0, limit)
      .map((idx, rank) => ({
        ...candidates[idx],
        relevance_score: Math.max(0.95 - rank * 0.05, 0.5),
        rank_position: rank + 1,
      }));

    // Step 4: Log matches anonymously
    if (device_id) {
      try {
        const buyerRes = await pool.query(`
          INSERT INTO buyers (id, device_id, consent_version, consent_given_at, model_version, platform, last_active, created_at)
          VALUES (uuid_generate_v4(), $1, 'v2.0', now(), 'gpt-4o-mini', 'chrome-extension', now(), now())
          ON CONFLICT (device_id) DO UPDATE SET last_active = now()
          RETURNING id
        `, [device_id]);
        const buyerId = buyerRes.rows[0].id;

        const sessionRes = await pool.query(`
          INSERT INTO buyer_sessions (id, buyer_id, platform, site_url, search_query, started_at)
          VALUES (uuid_generate_v4(), $1, 'chrome-extension', $2, $3, now())
          RETURNING id
        `, [buyerId, page_url, intent]);
        const sessionId = sessionRes.rows[0].id;

        for (const match of matches) {
          await pool.query(`
            INSERT INTO ad_matches (id, buyer_id, session_id, ad_id, relevance_score, rank_position, status, matched_at)
            VALUES (uuid_generate_v4(), $1, $2, $3, $4, $5, 'served', now())
          `, [buyerId, sessionId, match.id, match.relevance_score, match.rank_position]);
          await pool.query(`UPDATE ads SET spent = spent + cost_per_match WHERE id = $1`, [match.id]);
        }
      } catch (logErr) {
        console.error('Match logging error:', logErr.message);
      }
    }

    res.json({ success: true, intent, matches });

  } catch (err) {
    console.error('Extension match error:', err);
    res.status(500).json({ error: err.message || 'Matching failed' });
  }
});


// ── PGVECTOR SEMANTIC SEARCH ──────────────────────────────────

// Generate embedding for a query
async function generateQueryEmbedding(text) {
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text,
  });
  return response.data[0].embedding;
}

// Search ads using pgvector cosine similarity
async function semanticSearch(queryText, limit = 12, category = null, forReranking = false) {
  // Generate embedding for the query
  const embedding = await generateQueryEmbedding(queryText);
  const vectorStr = `[${embedding.join(',')}]`;

  // For reranking, fetch more candidates (20) so reranker can pick best 5
  const fetchLimit = forReranking ? Math.max(limit * 4, 20) : limit;

  let sql = `
    SELECT
      a.id, a.headline, a.body_copy, a.format, a.media_url,
      a.cost_per_match, a.intent_tags, a.status, a.thumbnail_url,
      p.title as product_title, p.price, p.category, p.currency, p.product_url, p.image_url as product_image_url,
      s.id as seller_id, s.name as seller_name, s.industry, s.location as seller_location, s.is_verified as seller_verified,
      ae.transcript,
      1 - (ae.embedding <=> $1::vector) as similarity_score
    FROM ad_embeddings ae
    JOIN ads a ON ae.ad_id = a.id
    JOIN products p ON a.product_id = p.id
    JOIN sellers s ON p.seller_id = s.id
    WHERE a.status = 'active'
    AND ae.embedding IS NOT NULL
  `;

  const params = [vectorStr];

  if (category) {
    params.push(category);
    sql += ` AND p.category = $${params.length}`;
  }

  // Lower threshold for reranking (0.20) to get more candidates for BGE to evaluate
  // Without reranking, use higher threshold (0.35) to filter noise
  const similarityThreshold = forReranking ? 0.20 : 0.35;
  sql += ` AND (1 - (ae.embedding <=> $1::vector)) > ${similarityThreshold}`;
  sql += ` ORDER BY ae.embedding <=> $1::vector LIMIT $${params.length + 1}`;
  params.push(fetchLimit);

  const { rows } = await pool.query(sql, params);
  return rows.map((row, rank) => ({
    ...row,
    relevance_score: Math.max(parseFloat(row.similarity_score), 0),
    rank_position: rank + 1,
  }));
}

// ── Buyer Google Sign-In ──────────────────────────────────────
const googleOAuthClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

app.post('/api/buyer/auth/google', async (req, res) => {
  const { credential } = req.body;
  if (!credential) {
    return res.status(400).json({ error: 'Google credential required' });
  }

  try {
    // Ensure buyer_accounts table exists
    await ensureBuyerAccountsTable();

    // Verify the Google ID token
    const ticket = await googleOAuthClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();

    const googleId = payload.sub;
    const email = payload.email;
    const name = payload.name || email.split('@')[0];
    const avatarUrl = payload.picture || null;

    // Check if buyer exists
    let { rows } = await pool.query(
      'SELECT * FROM buyer_accounts WHERE google_id = $1 OR email = $2',
      [googleId, email]
    );

    let buyer;
    if (rows.length > 0) {
      // Update existing buyer
      buyer = rows[0];
      await pool.query(
        'UPDATE buyer_accounts SET google_id = $1, name = $2, avatar_url = $3, last_login = NOW() WHERE id = $4',
        [googleId, name, avatarUrl, buyer.id]
      );
      buyer.name = name;
      buyer.avatar_url = avatarUrl;
    } else {
      // Create new buyer
      const insertRes = await pool.query(
        `INSERT INTO buyer_accounts (google_id, email, name, avatar_url)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [googleId, email, name, avatarUrl]
      );
      buyer = insertRes.rows[0];
    }

    const token = generateBuyerToken(buyer);

    res.json({
      token,
      buyer: {
        id: buyer.id,
        name: buyer.name,
        email: buyer.email,
        avatar_url: buyer.avatar_url,
      },
    });
  } catch (err) {
    console.error('[BuyerAuth] Google Sign-In error:', err);
    res.status(401).json({ error: 'Invalid Google credential' });
  }
});

// ── Semantic search endpoint for buyer search ─────────────────
app.post('/api/buyer/semantic-match', async (req, res) => {
  const { query, category, device_id, limit = 5, rerank = true } = req.body;
  if (!query && !category) return res.status(400).json({ error: 'Query or category required' });

  try {
    const searchText = query || category;

    // Get candidates from pgvector (more if reranking)
    const candidates = await semanticSearch(searchText, limit, category, rerank);

    console.log(`[SemanticSearch] Query: "${searchText}", pgvector returned ${candidates.length} candidates`);
    if (candidates.length > 0) {
      console.log(`[SemanticSearch] Top 5 similarities: ${candidates.slice(0, 5).map(c => c.similarity_score.toFixed(3)).join(', ')}`);
    }

    // Apply BGE reranker if enabled AND model is ready (non-blocking check)
    let matches;
    const useReranker = rerank && candidates.length > 0 && isRerankerReady();

    if (useReranker) {
      matches = await rerankResults(searchText, candidates, limit);
      // Update rank_position after reranking
      matches = matches.map((m, idx) => ({ ...m, rank_position: idx + 1 }));
      console.log(`[Reranker] Reranked to ${matches.length} results, scores: ${matches.map(m => (m.rerank_score || 0).toFixed(3)).join(', ')}`);
    } else {
      // Fall back to pgvector ordering (reranker not ready or disabled)
      matches = candidates.slice(0, limit);
      if (rerank && !isRerankerReady()) {
        console.log('[SemanticSearch] Reranker not ready, using pgvector ordering');
      }
    }

    // Log session anonymously
    if (device_id && matches.length > 0) {
      try {
        const buyerRes = await pool.query(`
          INSERT INTO buyers (id, device_id, consent_version, consent_given_at, model_version, platform, last_active, created_at)
          VALUES (uuid_generate_v4(), $1, 'v2.0', now(), 'text-embedding-3-small', 'web', now(), now())
          ON CONFLICT (device_id) DO UPDATE SET last_active = now()
          RETURNING id
        `, [device_id]);
        const buyerId = buyerRes.rows[0].id;

        const sessionRes = await pool.query(`
          INSERT INTO buyer_sessions (id, buyer_id, platform, site_url, search_query, started_at)
          VALUES (uuid_generate_v4(), $1, 'web', 'ad-engine', $2, now())
          RETURNING id
        `, [buyerId, query || category]);
        const sessionId = sessionRes.rows[0].id;

        for (const match of matches) {
          await pool.query(`
            INSERT INTO ad_matches (id, buyer_id, session_id, ad_id, relevance_score, rank_position, status, matched_at)
            VALUES (uuid_generate_v4(), $1, $2, $3, $4, $5, 'served', now())
          `, [buyerId, sessionId, match.id, match.rerank_score || match.relevance_score, match.rank_position]);
          await pool.query(`UPDATE ads SET spent = spent + cost_per_match WHERE id = $1`, [match.id]);
        }
      } catch (logErr) {
        console.error('Match logging error:', logErr.message);
      }
    }

    res.json({
      matches,
      query,
      category,
      total: matches.length,
      engine: useReranker ? 'pgvector+bge-reranker' : 'pgvector'
    });
  } catch (err) {
    console.error('Semantic search error:', err);
    res.status(500).json({ error: err.message || 'Semantic search failed' });
  }
});

// ── Semantic search for extension ────────────────────────────
app.post('/api/extension/semantic-match', async (req, res) => {
  const { page_title, page_url, page_text, search_query, history_topics, bookmark_topics, device_id, limit = 6 } = req.body;

  try {
    // Step 1: Extract intent with GPT (one call only)
    const contextPrompt = `Extract 5-10 buyer intent keywords from this browsing context.
Return ONLY comma-separated keywords, no explanation.

Page: ${page_title || ''}
URL: ${page_url || ''}
Search: ${search_query || ''}
Content: ${(page_text || '').slice(0, 300)}
History: ${(history_topics || []).slice(0, 5).join(', ')}
Bookmarks: ${(bookmark_topics || []).slice(0, 5).join(', ')}`;

    const intentResponse = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: contextPrompt }],
      max_tokens: 80,
      temperature: 0.2,
    });
    const intent = intentResponse.choices[0].message.content.trim();

    // Step 2: Use pgvector for fast semantic matching
    const matches = await semanticSearch(intent, limit);

    // Step 3: Log anonymously
    if (device_id && matches.length > 0) {
      try {
        const buyerRes = await pool.query(`
          INSERT INTO buyers (id, device_id, consent_version, consent_given_at, model_version, platform, last_active, created_at)
          VALUES (uuid_generate_v4(), $1, 'v2.0', now(), 'text-embedding-3-small', 'chrome-extension', now(), now())
          ON CONFLICT (device_id) DO UPDATE SET last_active = now()
          RETURNING id
        `, [device_id]);
        const buyerId = buyerRes.rows[0].id;

        const sessionRes = await pool.query(`
          INSERT INTO buyer_sessions (id, buyer_id, platform, site_url, search_query, started_at)
          VALUES (uuid_generate_v4(), $1, 'chrome-extension', $2, $3, now())
          RETURNING id
        `, [buyerId, page_url, intent]);
        const sessionId = sessionRes.rows[0].id;

        for (const match of matches) {
          await pool.query(`
            INSERT INTO ad_matches (id, buyer_id, session_id, ad_id, relevance_score, rank_position, status, matched_at)
            VALUES (uuid_generate_v4(), $1, $2, $3, $4, $5, 'served', now())
          `, [buyerId, sessionId, match.id, match.relevance_score, match.rank_position]);
          await pool.query(`UPDATE ads SET spent = spent + cost_per_match WHERE id = $1`, [match.id]);
        }
      } catch (logErr) {
        console.error('Logging error:', logErr.message);
      }
    }

    res.json({ success: true, intent, matches, engine: 'pgvector' });
  } catch (err) {
    console.error('Extension semantic match error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── BUYER MATCHING ENGINE ─────────────────────────────────────
// Top ads by cost_per_match (featured/sponsored)
app.get('/api/buyer/featured', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT a.id, a.headline, a.body_copy, a.format, a.media_url,
             a.cost_per_match, a.intent_tags, a.thumbnail_url,
             p.title as product_title, p.price, p.category, p.currency, p.product_url, p.image_url as product_image_url,
             s.id as seller_id, s.name as seller_name, s.location as seller_location, s.is_verified as seller_verified
      FROM ads a
      JOIN products p ON a.product_id = p.id
      JOIN sellers s ON p.seller_id = s.id
      WHERE a.status = 'active'
      ORDER BY a.cost_per_match DESC
      LIMIT 20
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all categories for browsing
app.get('/api/buyer/categories', async (req, res) => {
  const { rows } = await pool.query(`
    SELECT DISTINCT p.category, COUNT(a.id) as ad_count
    FROM ads a
    JOIN products p ON a.product_id = p.id
    WHERE a.status = 'active'
    GROUP BY p.category
    ORDER BY ad_count DESC
  `);
  res.json(rows);
});

// GPT-powered ad matching
app.post('/api/buyer/match', async (req, res) => {
  const { query, category, device_id, limit = 12 } = req.body;
  if (!query && !category) return res.status(400).json({ error: 'Query or category required' });

  try {
    // Fetch candidate ads from database
    let sql = `
      SELECT a.id, a.headline, a.body_copy, a.format, a.media_url,
             a.cost_per_match, a.intent_tags,
             p.title as product_title, p.description as product_desc,
             p.price, p.category, p.currency,
             s.name as seller_name, s.industry
      FROM ads a
      JOIN products p ON a.product_id = p.id
      JOIN sellers s ON p.seller_id = s.id
      WHERE a.status = 'active'
    `;
    const params = [];
    if (category) {
      params.push(category);
      sql += ` AND p.category = $${params.length}`;
    }
    sql += ` ORDER BY a.cost_per_match DESC LIMIT 50`;

    const { rows: candidates } = await pool.query(sql, params);
    if (!candidates.length) return res.json({ matches: [], query, category });

    // Use GPT to rank and match ads to buyer intent
    const adList = candidates.map((a, i) =>
      `[${i}] "${a.headline}" — ${a.product_title} (${a.category}) — Tags: ${Array.isArray(a.intent_tags) ? a.intent_tags.join(', ') : a.intent_tags
      } — Price: $${a.price}`
    ).join('\n');

    const gptPrompt = `You are a buyer intent matching engine for a privacy-first ad platform.

Buyer search query: "${query || ''}"
${category ? `Category filter: ${category}` : ''}

Available ads (index: headline — product — tags — price):
${adList}

Return the top ${limit} most relevant ad indices as a JSON array, ordered by relevance.
Consider: semantic similarity, intent match, category fit, price relevance.
Respond ONLY with a JSON array of indices like: [3, 0, 7, 2, ...]
No explanation, just the JSON array.`;

    const gptResponse = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: gptPrompt }],
      max_tokens: 200,
      temperature: 0.3,
    });

    let indices = [];
    try {
      const text = gptResponse.choices[0].message.content.trim();
      indices = JSON.parse(text);
    } catch {
      // Fallback to first N results if GPT parsing fails
      indices = candidates.slice(0, limit).map((_, i) => i);
    }

    // Map indices back to ads with relevance scores
    const matches = indices
      .filter(i => i >= 0 && i < candidates.length)
      .slice(0, limit)
      .map((idx, rank) => ({
        ...candidates[idx],
        relevance_score: Math.max(0.95 - rank * 0.05, 0.5),
        rank_position: rank + 1,
      }));

    // Log the match session anonymously
    if (device_id) {
      try {
        // Upsert buyer by device_id
        const buyerRes = await pool.query(`
          INSERT INTO buyers (id, device_id, consent_version, consent_given_at, model_version, platform, last_active, created_at)
          VALUES (uuid_generate_v4(), $1, 'v2.0', now(), 'gpt-4o-mini', 'web', now(), now())
          ON CONFLICT (device_id) DO UPDATE SET last_active = now()
          RETURNING id
        `, [device_id]);
        const buyerId = buyerRes.rows[0].id;

        // Log session
        const sessionRes = await pool.query(`
          INSERT INTO buyer_sessions (id, buyer_id, platform, site_url, search_query, started_at)
          VALUES (uuid_generate_v4(), $1, 'web', 'ad-engine', $2, now())
          RETURNING id
        `, [buyerId, query || category]);
        const sessionId = sessionRes.rows[0].id;

        // Log matches and impressions
        for (const match of matches) {
          await pool.query(`
            INSERT INTO ad_matches (id, buyer_id, session_id, ad_id, relevance_score, rank_position, status, matched_at)
            VALUES (uuid_generate_v4(), $1, $2, $3, $4, $5, 'served', now())
          `, [buyerId, sessionId, match.id, match.relevance_score, match.rank_position]);

          // Deduct cost from ad spend
          await pool.query(`
            UPDATE ads SET spent = spent + cost_per_match WHERE id = $1
          `, [match.id]);

          // Log impression event to ad_events
          logAdEvent('impression', {
            adId: match.id,
            sellerId: null, // Will be looked up in logAdEvent if needed
            sessionId: sessionId
          }, req);
        }
      } catch (logErr) {
        console.error('Match logging error:', logErr.message);
      }
    }

    res.json({ matches, query, category, total: matches.length });
  } catch (err) {
    console.error('Matching error:', err);
    res.status(500).json({ error: err.message || 'Matching failed' });
  }
});

// Log click event
app.post('/api/buyer/click', emailRateLimiter, async (req, res) => {
  const { match_id, ad_id, session_id } = req.body;
  try {
    let sessionIdForGeo = session_id || null;
    let sellerId = null;

    if (match_id) {
      // Get session_id from match and update status
      const matchRes = await pool.query(
        `UPDATE ad_matches SET status='clicked' WHERE id=$1 RETURNING session_id`,
        [match_id]
      );
      if (matchRes.rows[0] && matchRes.rows[0].session_id) {
        sessionIdForGeo = matchRes.rows[0].session_id;
      }
    }

    // Log buyer geolocation on click
    if (sessionIdForGeo) {
      logBuyerGeo(sessionIdForGeo, req);
    }

    if (ad_id) {
      try {
        const result = await pool.query(
          `SELECT p.title, s.email, s.name, s.id as seller_id
           FROM ads a
           JOIN products p ON a.product_id = p.id
           JOIN sellers s ON p.seller_id = s.id
           WHERE a.id = $1`,
          [ad_id]
        );
        if (result.rows[0]) {
          const { title, email, name, seller_id } = result.rows[0];
          sellerId = seller_id;
          // Sanitize inputs before sending email
          const sanitizedTitle = sanitizeForEmail(title);
          const sanitizedName = sanitizeForEmail(name);
          sendMatchNotificationEmail(email, sanitizedName, sanitizedTitle, 'click');
        }
      } catch (emailErr) {
        console.error('Could not send click email:', emailErr);
      }

      // Log click event to ad_events
      logAdEvent('click', {
        adId: ad_id,
        sellerId,
        sessionId: sessionIdForGeo
      }, req);
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── SELLER REVIEWS ROUTES ─────────────────────────────────────

// Create a review (requires buyer authentication)
app.post('/api/buyer/reviews', verifyBuyerToken, async (req, res) => {
  const { seller_id, ad_id, rating, comment } = req.body;
  const buyerAccountId = req.buyer.id;

  if (!seller_id || !rating) {
    return res.status(400).json({ error: 'seller_id and rating are required' });
  }
  if (rating < 1 || rating > 5) {
    return res.status(400).json({ error: 'Rating must be between 1 and 5' });
  }
  if (comment && comment.length > 280) {
    return res.status(400).json({ error: 'Comment must be 280 characters or less' });
  }

  try {
    await ensureSellerReviewsTable();
    await ensureBuyerAccountsTable();

    // Verify seller exists
    const sellerCheck = await pool.query('SELECT id FROM sellers WHERE id = $1::uuid', [seller_id]);
    if (sellerCheck.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid seller_id' });
    }

    // Check if buyer already reviewed this seller
    const existing = await pool.query(
      'SELECT id FROM seller_reviews WHERE seller_id = $1::uuid AND buyer_account_id = $2::uuid',
      [seller_id, buyerAccountId]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'You have already reviewed this seller' });
    }

    // Insert the review
    const result = await pool.query(
      `INSERT INTO seller_reviews (seller_id, buyer_account_id, ad_id, rating, comment, verified_match)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, true)
       RETURNING *`,
      [seller_id, buyerAccountId, ad_id || null, rating, comment || null]
    );

    res.json({ success: true, review: result.rows[0] });
  } catch (err) {
    console.error('Error creating review:', err);
    // Return more specific error message
    if (err.code === '23503') {
      return res.status(400).json({ error: 'Invalid seller or buyer reference' });
    }
    if (err.code === '23505') {
      return res.status(409).json({ error: 'You have already reviewed this seller' });
    }
    res.status(500).json({ error: `Failed to create review: ${err.message}` });
  }
});

// Get reviews for a seller (public)
app.get('/api/reviews/seller/:seller_id', async (req, res) => {
  const { seller_id } = req.params;

  try {
    await ensureSellerReviewsTable();

    const { rows } = await pool.query(`
      SELECT
        sr.id,
        sr.rating,
        sr.comment,
        sr.verified_match,
        sr.helpful_count,
        sr.created_at,
        ba.name as buyer_name,
        a.headline as ad_headline
      FROM seller_reviews sr
      LEFT JOIN buyer_accounts ba ON sr.buyer_account_id = ba.id
      LEFT JOIN ads a ON sr.ad_id = a.id
      WHERE sr.seller_id = $1::uuid
      ORDER BY sr.created_at DESC
    `, [seller_id]);

    // Calculate stats
    const stats = await pool.query(`
      SELECT
        COUNT(*) as total_reviews,
        ROUND(AVG(rating)::numeric, 1) as average_rating
      FROM seller_reviews
      WHERE seller_id = $1::uuid
    `, [seller_id]);

    // Format buyer names as "First L."
    const reviews = rows.map(r => ({
      ...r,
      buyer_display_name: r.buyer_name
        ? r.buyer_name.split(' ')[0] + (r.buyer_name.split(' ')[1] ? ' ' + r.buyer_name.split(' ')[1].charAt(0) + '.' : '')
        : 'Anonymous'
    }));

    res.json({
      reviews,
      total_reviews: parseInt(stats.rows[0].total_reviews),
      average_rating: parseFloat(stats.rows[0].average_rating) || 0
    });
  } catch (err) {
    console.error('Error fetching seller reviews:', err);
    res.status(500).json({ error: 'Failed to fetch reviews' });
  }
});

// Get reviews for a specific ad (public)
app.get('/api/reviews/ad/:ad_id', async (req, res) => {
  const { ad_id } = req.params;

  try {
    await ensureSellerReviewsTable();

    const { rows } = await pool.query(`
      SELECT
        sr.id,
        sr.rating,
        sr.comment,
        sr.verified_match,
        sr.helpful_count,
        sr.created_at,
        ba.name as buyer_name,
        a.headline as ad_headline
      FROM seller_reviews sr
      LEFT JOIN buyer_accounts ba ON sr.buyer_account_id = ba.id
      LEFT JOIN ads a ON sr.ad_id = a.id
      WHERE sr.ad_id = $1
      ORDER BY sr.created_at DESC
    `, [ad_id]);

    // Calculate stats for this ad
    const stats = await pool.query(`
      SELECT
        COUNT(*) as total_reviews,
        ROUND(AVG(rating)::numeric, 1) as average_rating
      FROM seller_reviews
      WHERE ad_id = $1
    `, [ad_id]);

    // Format buyer names as "First L."
    const reviews = rows.map(r => ({
      ...r,
      buyer_display_name: r.buyer_name
        ? r.buyer_name.split(' ')[0] + (r.buyer_name.split(' ')[1] ? ' ' + r.buyer_name.split(' ')[1].charAt(0) + '.' : '')
        : 'Anonymous'
    }));

    res.json({
      reviews,
      total_reviews: parseInt(stats.rows[0].total_reviews),
      average_rating: parseFloat(stats.rows[0].average_rating) || 0
    });
  } catch (err) {
    console.error('Error fetching ad reviews:', err);
    res.status(500).json({ error: 'Failed to fetch reviews' });
  }
});

// Mark review as helpful (public, one per session)
app.post('/api/reviews/:review_id/helpful', async (req, res) => {
  const { review_id } = req.params;

  try {
    await ensureSellerReviewsTable();

    const result = await pool.query(
      'UPDATE seller_reviews SET helpful_count = helpful_count + 1 WHERE id = $1 RETURNING helpful_count',
      [review_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Review not found' });
    }

    res.json({ success: true, helpful_count: result.rows[0].helpful_count });
  } catch (err) {
    console.error('Error marking review helpful:', err);
    res.status(500).json({ error: 'Failed to update review' });
  }
});

// ── ANALYTICS ROUTES ─────────────────────────────────────────

// Platform overview stats
app.get('/api/analytics/overview', requireAuth, checkSellerApproved, async (req, res) => {
  try {
    const { start, end } = req.query;
    // Use parameterized queries to prevent SQL injection
    const useCustomRange = start && end;

    const [sellers, products, ads, buyers, revenue, matches] = await Promise.all([
      useCustomRange
        ? pool.query(`SELECT COUNT(*) FROM sellers WHERE created_at BETWEEN $1 AND $2`, [start, end])
        : pool.query(`SELECT COUNT(*) FROM sellers WHERE created_at >= now() - interval '30 days'`),
      useCustomRange
        ? pool.query(`SELECT COUNT(*) FROM products WHERE created_at BETWEEN $1 AND $2`, [start, end])
        : pool.query(`SELECT COUNT(*) FROM products WHERE created_at >= now() - interval '30 days'`),
      useCustomRange
        ? pool.query(`SELECT COUNT(*) FROM ads WHERE created_at BETWEEN $1 AND $2`, [start, end])
        : pool.query(`SELECT COUNT(*) FROM ads WHERE created_at >= now() - interval '30 days'`),
      useCustomRange
        ? pool.query(`SELECT COUNT(*) FROM buyers WHERE created_at BETWEEN $1 AND $2`, [start, end])
        : pool.query(`SELECT COUNT(*) FROM buyers WHERE created_at >= now() - interval '30 days'`),
      pool.query(`SELECT COALESCE(SUM(spent),0) as total FROM ads`),
      useCustomRange
        ? pool.query(`SELECT COUNT(*) FROM ad_matches WHERE matched_at BETWEEN $1 AND $2`, [start, end])
        : pool.query(`SELECT COUNT(*) FROM ad_matches WHERE matched_at >= now() - interval '30 days'`),
    ]);

    res.json({
      sellers: parseInt(sellers.rows[0].count),
      products: parseInt(products.rows[0].count),
      ads: parseInt(ads.rows[0].count),
      buyers: parseInt(buyers.rows[0].count),
      revenue: parseFloat(revenue.rows[0].total),
      matches: parseInt(matches.rows[0].count),
    });
  } catch (err) {
    console.error('Analytics overview error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Daily spend trend (line chart)
app.get('/api/analytics/spend-trend', requireAuth, checkSellerApproved, async (req, res) => {
  try {
    const { start, end } = req.query;
    const startDate = start || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const endDate = end || new Date().toISOString().split('T')[0];

    const { rows } = await pool.query(`
      SELECT
        date_trunc('day', updated_at)::date as date,
        SUM(spent) as total_spent,
        COUNT(*) as ad_count
      FROM ads
      WHERE updated_at BETWEEN $1 AND $2::date + interval '1 day'
      GROUP BY date_trunc('day', updated_at)::date
      ORDER BY date ASC
    `, [startDate, endDate]);

    res.json(rows);
  } catch (err) {
    console.error('Analytics spend-trend error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Top sellers by spend (bar chart)
app.get('/api/analytics/top-sellers', requireAuth, checkSellerApproved, async (req, res) => {
  try {
    const { limit = 10 } = req.query;
    const { rows } = await pool.query(`
      SELECT
        s.name as seller_name,
        s.industry,
        COUNT(a.id) as ad_count,
        COALESCE(SUM(a.spent), 0) as total_spent,
        COALESCE(SUM(a.daily_budget), 0) as total_budget
      FROM sellers s
      LEFT JOIN products p ON p.seller_id = s.id
      LEFT JOIN ads a ON a.product_id = p.id
      GROUP BY s.id, s.name, s.industry
      ORDER BY total_spent DESC
      LIMIT $1
    `, [limit]);
    res.json(rows);
  } catch (err) {
    console.error('Analytics top-sellers error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Top performing ads (bar chart)
app.get('/api/analytics/top-ads', requireAuth, checkSellerApproved, async (req, res) => {
  try {
    const { limit = 10 } = req.query;
    const { rows } = await pool.query(`
      SELECT
        a.headline,
        a.format,
        a.spent,
        a.daily_budget,
        a.cost_per_match,
        p.title as product_title,
        s.name as seller_name,
        CASE WHEN a.daily_budget > 0
             THEN ROUND((a.spent / a.daily_budget * 100)::numeric, 1)
             ELSE 0 END as budget_used_pct
      FROM ads a
      JOIN products p ON a.product_id = p.id
      JOIN sellers s ON p.seller_id = s.id
      ORDER BY a.spent DESC
      LIMIT $1
    `, [limit]);
    res.json(rows);
  } catch (err) {
    console.error('Analytics top-ads error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Ads by format (donut chart)
app.get('/api/analytics/ads-by-format', requireAuth, checkSellerApproved, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        format,
        COUNT(*) as count,
        COALESCE(SUM(spent), 0) as total_spent
      FROM ads
      GROUP BY format
      ORDER BY count DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error('Analytics ads-by-format error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Ads by category (bar chart)
app.get('/api/analytics/ads-by-category', requireAuth, checkSellerApproved, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        p.category,
        COUNT(a.id) as ad_count,
        COALESCE(SUM(a.spent), 0) as total_spent
      FROM ads a
      JOIN products p ON a.product_id = p.id
      GROUP BY p.category
      ORDER BY ad_count DESC
      LIMIT 10
    `);
    res.json(rows);
  } catch (err) {
    console.error('Analytics ads-by-category error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Buyers by platform (donut chart)
app.get('/api/analytics/buyers-by-platform', requireAuth, checkSellerApproved, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        platform,
        COUNT(*) as count
      FROM buyers
      GROUP BY platform
      ORDER BY count DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error('Analytics buyers-by-platform error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Sellers by plan (donut chart)
app.get('/api/analytics/sellers-by-plan', requireAuth, checkSellerApproved, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        plan,
        COUNT(*) as count,
        SUM(balance) as total_balance
      FROM sellers
      GROUP BY plan
      ORDER BY count DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error('Analytics sellers-by-plan error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Buyer activity over time
app.get('/api/analytics/buyer-trend', requireAuth, checkSellerApproved, async (req, res) => {
  try {
    const { start, end } = req.query;
    const startDate = start || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const endDate = end || new Date().toISOString().split('T')[0];

    const { rows } = await pool.query(`
      SELECT
        date_trunc('day', created_at)::date as date,
        COUNT(*) as new_buyers
      FROM buyers
      WHERE created_at BETWEEN $1 AND $2::date + interval '1 day'
      GROUP BY date_trunc('day', created_at)::date
      ORDER BY date ASC
    `, [startDate, endDate]);
    res.json(rows);
  } catch (err) {
    console.error('Analytics buyer-trend error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── STRIPE BILLING ROUTES ─────────────────────────────────────

// Create Stripe Checkout session for subscription
app.post('/api/stripe/create-checkout-session', requireAuth, checkSellerApproved, async (req, res) => {
  if (!stripe) {
    return res.status(503).json({ error: 'Stripe is not configured' });
  }

  const { plan } = req.body;
  if (!plan || !STRIPE_PLANS[plan]) {
    return res.status(400).json({ error: 'Invalid plan selected' });
  }

  const priceId = stripePriceIds[plan];
  if (!priceId) {
    return res.status(503).json({ error: 'Plan pricing not available. Please try again later.' });
  }

  try {
    await ensureSubscriptionsTable();
    const sellerId = req.user.seller_id;

    // Get seller info
    const sellerRes = await pool.query('SELECT id, name, email FROM sellers WHERE id = $1', [sellerId]);
    if (!sellerRes.rows.length) {
      return res.status(404).json({ error: 'Seller not found' });
    }
    const seller = sellerRes.rows[0];

    // Check for existing subscription
    const subRes = await pool.query('SELECT stripe_customer_id FROM subscriptions WHERE seller_id = $1', [sellerId]);
    let customerId = subRes.rows[0]?.stripe_customer_id;

    // Create Stripe customer if not exists
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: seller.email,
        name: seller.name,
        metadata: { seller_id: sellerId }
      });
      customerId = customer.id;

      // Insert or update subscription record with customer ID
      await pool.query(`
        INSERT INTO subscriptions (seller_id, stripe_customer_id, plan, status, created_at)
        VALUES ($1, $2, 'free', 'active', NOW())
        ON CONFLICT (seller_id) DO UPDATE SET stripe_customer_id = $2
      `, [sellerId, customerId]);
    }

    // Create Checkout session
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [{
        price: priceId,
        quantity: 1
      }],
      mode: 'subscription',
      success_url: `${process.env.CLIENT_URL || 'https://ad-engine-4da45.web.app'}?stripe=success`,
      cancel_url: `${process.env.CLIENT_URL || 'https://ad-engine-4da45.web.app'}?stripe=cancel`,
      metadata: {
        seller_id: sellerId,
        plan: plan
      },
      subscription_data: {
        metadata: {
          seller_id: sellerId,
          plan: plan
        }
      }
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Stripe checkout error:', err);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

// Stripe webhook handler (NO auth - verified by Stripe signature)
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!stripe) {
    return res.status(503).send('Stripe not configured');
  }

  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  await ensureSubscriptionsTable();

  try {
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const subscription = event.data.object;
        const customerId = subscription.customer;
        const planKey = subscription.metadata?.plan || 'starter';
        const planConfig = STRIPE_PLANS[planKey] || STRIPE_PLANS.starter;

        await pool.query(`
          UPDATE subscriptions SET
            stripe_subscription_id = $1,
            plan = $2,
            status = $3,
            impressions_included = $4,
            stories_included = $5,
            current_period_start = to_timestamp($6),
            current_period_end = to_timestamp($7)
          WHERE stripe_customer_id = $8
        `, [
          subscription.id,
          planKey,
          subscription.status === 'active' ? 'active' : subscription.status,
          planConfig.impressions,
          planConfig.stories,
          subscription.current_period_start,
          subscription.current_period_end,
          customerId
        ]);

        console.log(`Subscription ${event.type}: ${subscription.id} -> ${planKey} (${planConfig.stories} stories, ${planConfig.impressions} impressions)`);
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        const freePlan = STRIPE_PLANS.free;
        await pool.query(`
          UPDATE subscriptions SET
            status = 'cancelled',
            plan = 'free',
            impressions_included = $2,
            stories_included = $3
          WHERE stripe_subscription_id = $1
        `, [subscription.id, freePlan.impressions, freePlan.stories]);

        console.log(`Subscription cancelled: ${subscription.id} -> free plan`);
        break;
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;
        const customerId = invoice.customer;

        // Get seller_id from subscription
        const subRes = await pool.query(
          'SELECT seller_id FROM subscriptions WHERE stripe_customer_id = $1',
          [customerId]
        );

        if (subRes.rows.length) {
          await pool.query(`
            INSERT INTO payment_history (seller_id, stripe_invoice_id, amount_cents, currency, status, description, created_at)
            VALUES ($1, $2, $3, $4, 'succeeded', $5, NOW())
          `, [
            subRes.rows[0].seller_id,
            invoice.id,
            invoice.amount_paid,
            invoice.currency,
            invoice.lines?.data?.[0]?.description || 'Subscription payment'
          ]);
        }

        console.log(`Payment succeeded: ${invoice.id} - $${invoice.amount_paid / 100}`);
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const customerId = invoice.customer;

        // Get seller info
        const subRes = await pool.query(`
          SELECT s.seller_id, sel.email, sel.name
          FROM subscriptions s
          JOIN sellers sel ON s.seller_id = sel.id
          WHERE s.stripe_customer_id = $1
        `, [customerId]);

        if (subRes.rows.length) {
          const seller = subRes.rows[0];

          // Log failed payment
          await pool.query(`
            INSERT INTO payment_history (seller_id, stripe_invoice_id, amount_cents, currency, status, description, created_at)
            VALUES ($1, $2, $3, $4, 'failed', $5, NOW())
          `, [
            seller.seller_id,
            invoice.id,
            invoice.amount_due,
            invoice.currency,
            'Payment failed'
          ]);

          // Send notification emails
          const { sendPaymentFailedEmail } = require('./emailService');
          if (typeof sendPaymentFailedEmail === 'function') {
            await sendPaymentFailedEmail(seller.email, seller.name, invoice.amount_due / 100);
          }
        }

        console.log(`Payment failed: ${invoice.id}`);
        break;
      }
    }

    res.json({ received: true });
  } catch (err) {
    console.error('Webhook processing error:', err);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// Get seller's subscription details
app.get('/api/seller/subscription', requireAuth, checkSellerApproved, async (req, res) => {
  try {
    await ensureSubscriptionsTable();
    const sellerId = req.user.seller_id;

    if (!sellerId) {
      return res.status(400).json({ error: 'No seller account linked' });
    }

    // Get subscription
    const subRes = await pool.query(`
      SELECT * FROM subscriptions WHERE seller_id = $1
    `, [sellerId]);

    let subscription = subRes.rows[0];

    // Create free subscription if none exists
    if (!subscription) {
      const freePlan = STRIPE_PLANS.free;
      await pool.query(`
        INSERT INTO subscriptions (seller_id, plan, status, impressions_included, stories_included, created_at)
        VALUES ($1, 'free', 'active', $2, $3, NOW())
      `, [sellerId, freePlan.impressions, freePlan.stories]);

      subscription = {
        seller_id: sellerId,
        plan: 'free',
        status: 'active',
        impressions_included: freePlan.impressions,
        stories_included: freePlan.stories,
        impression_overage_rate: 0.25
      };
    }

    // Get plan config for limits - planConfig is source of truth based on plan name
    const plan = subscription.plan || 'free';
    const planConfig = STRIPE_PLANS[plan] || STRIPE_PLANS.free;

    // Get impressions used this billing period
    const periodStart = subscription.current_period_start || new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const impressionsRes = await pool.query(`
      SELECT COUNT(*) as count
      FROM ad_events
      WHERE seller_id = $1
      AND event_type = 'impression'
      AND timestamp >= $2
    `, [sellerId, periodStart]);

    const impressionsUsed = parseInt(impressionsRes.rows[0]?.count || 0, 10);
    // Use planConfig as source of truth for limits based on plan name
    const impressionsIncluded = planConfig.impressions;
    const isUnlimitedImpressions = impressionsIncluded >= 999999;
    const impressionsRemaining = isUnlimitedImpressions ? 999999 : Math.max(0, impressionsIncluded - impressionsUsed);
    const overageCount = isUnlimitedImpressions ? 0 : Math.max(0, impressionsUsed - impressionsIncluded);
    const overageRate = parseFloat(subscription.impression_overage_rate || 0.25);
    const overageAmount = overageCount * overageRate;

    // Get stories used (count of active ads)
    const storiesRes = await pool.query(`
      SELECT COUNT(*) as count
      FROM ads a
      JOIN products p ON a.product_id = p.id
      WHERE p.seller_id = $1 AND a.status != 'deleted'
    `, [sellerId]);

    const storiesUsed = parseInt(storiesRes.rows[0]?.count || 0, 10);
    // Use planConfig as source of truth for limits based on plan name
    const storiesIncluded = planConfig.stories;
    const isUnlimitedStories = storiesIncluded >= 999;
    const storiesRemaining = isUnlimitedStories ? 999 : Math.max(0, storiesIncluded - storiesUsed);

    res.json({
      ...subscription,
      impressions_used: impressionsUsed,
      impressions_included: impressionsIncluded,
      impressions_remaining: impressionsRemaining,
      overage_count: overageCount,
      overage_amount: overageAmount,
      stories_used: storiesUsed,
      stories_included: storiesIncluded,
      stories_remaining: storiesRemaining,
      plans: STRIPE_PLANS
    });
  } catch (err) {
    console.error('Get subscription error:', err);
    res.status(500).json({ error: 'Failed to get subscription details' });
  }
});

// Get payment history for seller
app.get('/api/seller/payments', requireAuth, checkSellerApproved, async (req, res) => {
  try {
    const sellerId = req.user.seller_id;
    if (!sellerId) {
      return res.status(400).json({ error: 'No seller account linked' });
    }

    const { rows } = await pool.query(`
      SELECT * FROM payment_history
      WHERE seller_id = $1
      ORDER BY created_at DESC
      LIMIT 50
    `, [sellerId]);

    res.json(rows);
  } catch (err) {
    console.error('Get payments error:', err);
    res.status(500).json({ error: 'Failed to get payment history' });
  }
});

// Admin: Get revenue analytics
app.get('/api/admin/revenue', requireAuth, requireAdmin, async (req, res) => {
  try {
    await ensureSubscriptionsTable();

    // Total MRR by plan
    const mrrRes = await pool.query(`
      SELECT
        plan,
        COUNT(*) as count,
        SUM(CASE
          WHEN plan = 'starter' THEN 29
          WHEN plan = 'pro' THEN 99
          WHEN plan = 'enterprise' THEN 299
          ELSE 0
        END) as mrr
      FROM subscriptions
      WHERE status = 'active' AND plan != 'free'
      GROUP BY plan
    `);

    // Calculate totals
    const totalMrr = mrrRes.rows.reduce((sum, r) => sum + parseFloat(r.mrr || 0), 0);
    const totalActiveSubscriptions = mrrRes.rows.reduce((sum, r) => sum + parseInt(r.count || 0, 10), 0);

    // Recent payments
    const paymentsRes = await pool.query(`
      SELECT ph.*, s.name as seller_name, s.email as seller_email
      FROM payment_history ph
      JOIN sellers s ON ph.seller_id = s.id
      ORDER BY ph.created_at DESC
      LIMIT 20
    `);

    // Failed payments count
    const failedRes = await pool.query(`
      SELECT COUNT(*) as count
      FROM payment_history
      WHERE status = 'failed'
      AND created_at > NOW() - INTERVAL '30 days'
    `);

    // Subscriptions by plan for chart
    const planDistRes = await pool.query(`
      SELECT plan, COUNT(*) as count
      FROM subscriptions
      WHERE status = 'active'
      GROUP BY plan
    `);

    res.json({
      total_mrr: totalMrr,
      total_active_subscriptions: totalActiveSubscriptions,
      subscriptions_by_plan: mrrRes.rows,
      plan_distribution: planDistRes.rows,
      recent_payments: paymentsRes.rows,
      failed_payments_30d: parseInt(failedRes.rows[0]?.count || 0, 10)
    });
  } catch (err) {
    console.error('Admin revenue error:', err);
    res.status(500).json({ error: 'Failed to get revenue analytics' });
  }
});

// Cancel subscription (for seller portal)
app.post('/api/seller/subscription/cancel', requireAuth, checkSellerApproved, async (req, res) => {
  if (!stripe) {
    return res.status(503).json({ error: 'Stripe is not configured' });
  }

  try {
    const sellerId = req.user.seller_id;
    const subRes = await pool.query(
      'SELECT stripe_subscription_id FROM subscriptions WHERE seller_id = $1',
      [sellerId]
    );

    const stripeSubId = subRes.rows[0]?.stripe_subscription_id;
    if (!stripeSubId) {
      return res.status(400).json({ error: 'No active subscription to cancel' });
    }

    // Cancel at period end (don't immediately revoke access)
    await stripe.subscriptions.update(stripeSubId, {
      cancel_at_period_end: true
    });

    res.json({ success: true, message: 'Subscription will be cancelled at the end of the billing period' });
  } catch (err) {
    console.error('Cancel subscription error:', err);
    res.status(500).json({ error: 'Failed to cancel subscription' });
  }
});

// ── ADMIN: RETRANSCRIBE VIDEO ADS ────────────────────────────
// Regenerates embeddings for video ads using Whisper transcription
app.post('/api/admin/retranscribe-ads', requireAuth, async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    await ensureAdEmbeddingsTranscriptColumns();

    // Get all approved video ads
    const { rows: videoAds } = await pool.query(`
      SELECT a.id, a.headline, a.body_copy, a.intent_tags, a.format, a.media_url,
             p.title as product_title, p.category, p.price,
             s.name as seller_name, s.industry
      FROM ads a
      JOIN products p ON a.product_id = p.id
      JOIN sellers s ON p.seller_id = s.id
      WHERE a.status = 'active' AND a.format = 'video' AND a.media_url IS NOT NULL
      ORDER BY a.created_at DESC
    `);

    console.log(`[Retranscribe] Found ${videoAds.length} video ads to process`);

    let transcribed = 0;
    let skipped = 0;
    let failed = 0;
    let firstError = null;

    for (const ad of videoAds) {
      try {
        console.log(`[Retranscribe] Processing: ${ad.headline}`);

        // Transcribe video
        const transcript = await transcribeVideoAd(ad.media_url);
        const hasTranscript = isMeaningfulTranscript(transcript);

        // Build embedding text
        const embeddingText = buildAdTextWithTranscript(ad, transcript);

        // Generate new embedding
        const embResponse = await openai.embeddings.create({
          model: 'text-embedding-3-small',
          input: embeddingText,
        });
        const embedding = embResponse.data[0].embedding;
        const vectorStr = `[${embedding.join(',')}]`;

        // Upsert embedding with transcript
        await pool.query(`
          INSERT INTO ad_embeddings (id, ad_id, embedding, model_version, has_transcript, transcript, embedding_text, created_at)
          VALUES (uuid_generate_v4(), $1, $2::vector, 'text-embedding-3-small', $3, $4, $5, now())
          ON CONFLICT (ad_id) DO UPDATE SET
            embedding = $2::vector,
            model_version = 'text-embedding-3-small',
            has_transcript = $3,
            transcript = $4,
            embedding_text = $5,
            created_at = now()
        `, [ad.id, vectorStr, hasTranscript, transcript, embeddingText]);

        transcribed++;
        console.log(`[Retranscribe] ✅ ${ad.headline} (transcript: ${hasTranscript})`);

        // Rate limit
        await new Promise(r => setTimeout(r, 1000));

      } catch (err) {
        const errMsg = `${ad.headline}: ${err.message}`;
        console.error(`[Retranscribe] ❌ ${errMsg}`);
        if (!firstError) firstError = errMsg;
        failed++;
      }
    }

    res.json({
      success: true,
      total: videoAds.length,
      transcribed,
      skipped,
      failed,
      firstError,
    });

  } catch (err) {
    console.error('Retranscribe error:', err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3001;

// Initialize tables and Stripe products before starting server
async function startServer() {
  try {
    await ensureGeoLogTables();
    await ensureSubscriptionsTable();
    await ensureBillingSupportTicketsTable();
    await ensureAdEmbeddingsTranscriptColumns();
    await ensureBuyerAccountsTable();
    await ensureSellerReviewsTable();
    await ensureStripeProducts();
    console.log('Database tables and Stripe products initialized');
  } catch (err) {
    console.error('Initialization error:', err);
  }

  app.listen(PORT, () => {
    console.log(`Ad Engine API running on http://localhost:${PORT}`);

    // Warm up BGE reranker in background (avoid cold start latency)
    setTimeout(() => {
      warmUpReranker().catch(err => {
        console.error('[Startup] Reranker warm-up failed:', err.message);
      });
    }, 5000);
  });
}

startServer();
// Deployment 1783898744
