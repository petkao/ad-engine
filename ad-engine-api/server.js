require('dotenv').config();
const { sendAdApprovedEmail, sendMatchNotificationEmail, setPool } = require('./emailService');
const OpenAI = require('openai');
const { Storage } = require('@google-cloud/storage');
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const PgSession = require('connect-pg-simple')(session);
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');

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

app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:3000', credentials: true }));
app.use(express.json());
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
          `INSERT INTO sellers (id,name,email,industry,plan,balance,contact_info,status,created_at,updated_at)
           VALUES (uuid_generate_v4(),$1,$2,'General','starter',0,'{}','active',now(),now()) RETURNING *`,
          [displayName, email]
        );
        const accountRes = await pool.query(
          `INSERT INTO seller_accounts (id,seller_id,email,google_id,google_email,avatar_url,role,is_verified,last_login,created_at,updated_at)
           VALUES (uuid_generate_v4(),$1,$2,$3,$4,$5,'seller',true,now(),now(),now()) RETURNING *`,
          [sellerRes.rows[0].id, email, googleId, email, avatarUrl]
        );
        user = accountRes.rows[0];
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

// ── AUTH ROUTES ───────────────────────────────────────────────
app.post('/auth/register', async (req, res) => {
  const { name, email, password, industry } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password are required.' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  try {
    const existing = await pool.query('SELECT id FROM seller_accounts WHERE email=$1', [email]);
    if (existing.rows.length) return res.status(409).json({ error: 'An account with this email already exists.' });
    const hash = await bcrypt.hash(password, 12);
    const sellerRes = await pool.query(
      `INSERT INTO sellers (id,name,email,industry,plan,balance,contact_info,status,created_at,updated_at)
       VALUES (uuid_generate_v4(),$1,$2,$3,'starter',0,'{}','active',now(),now()) RETURNING *`,
      [name, email, industry || 'General']
    );
    const accountRes = await pool.query(
      `INSERT INTO seller_accounts (id,seller_id,email,password_hash,role,is_verified,created_at,updated_at)
       VALUES (uuid_generate_v4(),$1,$2,$3,'seller',true,now(),now()) RETURNING *`,
      [sellerRes.rows[0].id, email, hash]
    );
    req.login(accountRes.rows[0], (err) => {
      if (err) return res.status(500).json({ error: 'Login after register failed.' });
      res.json({ success: true, user: safeUser(accountRes.rows[0]), seller: sellerRes.rows[0] });
    });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Registration failed.' }); }
});

app.post('/auth/login', (req, res, next) => {
  passport.authenticate('local', (err, user, info) => {
    if (err) return res.status(500).json({ error: 'Login error.' });
    if (!user) return res.status(401).json({ error: info?.message || 'Invalid credentials.' });
    req.login(user, (err) => {
      if (err) return res.status(500).json({ error: 'Session error.' });
      const token = generateToken(user);
      res.json({ success: true, user: safeUser(user), token });
    });
  })(req, res, next);
});

app.post('/auth/logout', (req, res) => {
  req.logout(() => { req.session.destroy(); res.json({ success: true }); });
});

app.get('/auth/me', (req, res) => {
  if (req.isAuthenticated()) return res.json({ user: safeUser(req.user) });

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    const serviceToken = (process.env.MCP_SERVICE_TOKEN || '').trim();

    if (serviceToken && token === serviceToken) {
      return res.json({ user: buildServicePrincipal() });
    }

    try {
      const decoded = jwt.verify(token, process.env.SESSION_SECRET || 'ad-engine-secret-key');
      return res.json({ user: decoded });
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
app.delete('/api/sellers/:id', requireAuth, async (req, res) => {
  await pool.query('DELETE FROM ad_embeddings WHERE ad_id=$1', [req.params.id]);
  await pool.query('DELETE FROM ads WHERE id=$1', [req.params.id]);
  res.json({ success: true });
});

app.get('/api/products', requireAuth, async (req, res) => {
  const sellerFilter = await getSellerFilter(req);
  let sql = `SELECT p.*, s.name as seller_name FROM products p JOIN sellers s ON p.seller_id=s.id`;
  const params = [];
  if (sellerFilter) { params.push(sellerFilter); sql += ` WHERE p.seller_id = $1`; }
  sql += ` ORDER BY p.created_at DESC`;
  const { rows } = await pool.query(sql, params);
  res.json(rows);
});

app.post('/api/products', requireAuth, async (req, res) => {
  const { seller_id, title, description, price, currency, category, attributes, product_url } = req.body;
  const { rows } = await pool.query(
    `INSERT INTO products (id,seller_id,title,description,price,currency,category,attributes,product_url,status,created_at,updated_at)
   VALUES (uuid_generate_v4(),$1,$2,$3,$4,$5,$6,$7,$8,'active',now(),now()) RETURNING *`,
    [seller_id, title, description, price, currency || 'USD', category, JSON.stringify(attributes || {}), product_url || null]
  );
  res.json(rows[0]);
});

app.put('/api/products/:id', requireAuth, async (req, res) => {
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
app.delete('/api/products/:id', requireAuth, async (req, res) => {
  await pool.query('DELETE FROM products WHERE id=$1', [req.params.id]);
  res.json({ success: true });
});

app.get('/api/ads', requireAuth, async (req, res) => {
  const sellerFilter = await getSellerFilter(req);
  let sql = `SELECT a.*, p.title as product_title, p.category, p.product_url, p.image_url as product_image_url, s.name as seller_name, s.location as seller_location, s.is_verified as seller_verified
    FROM ads a JOIN products p ON a.product_id=p.id JOIN sellers s ON p.seller_id=s.id`;
  const params = [];
  if (sellerFilter) { params.push(sellerFilter); sql += ` WHERE p.seller_id = $1`; }
  sql += ` ORDER BY a.created_at DESC`;
  const { rows } = await pool.query(sql, params);
  res.json(rows);
});

app.get('/api/ads/:id', requireAuth, async (req, res) => {
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

app.post('/api/ads', requireAuth, async (req, res) => {
  const { product_id, format, headline, body_copy, intent_tags, cost_per_match, daily_budget, total_budget } = req.body;
  const { rows } = await pool.query(
    `INSERT INTO ads (id,product_id,format,headline,body_copy,intent_tags,cost_per_match,daily_budget,total_budget,spent,status,created_at,updated_at)
     VALUES (uuid_generate_v4(),$1,$2,$3,$4,$5,$6,$7,$8,0,'active',now(),now()) RETURNING *`,
    [product_id, format, headline, body_copy, JSON.stringify(intent_tags || []), cost_per_match || 0.01, daily_budget || 50, total_budget || 500]
  );
  res.json(rows[0]);
});
app.put('/api/ads/:id', requireAuth, async (req, res) => {
  const { headline, body_copy, format, cost_per_match, daily_budget, status } = req.body;
  const { rows } = await pool.query(
    `UPDATE ads SET headline=$1,body_copy=$2,format=$3,cost_per_match=$4,daily_budget=$5,status=$6,updated_at=now() WHERE id=$7 RETURNING *`,
    [headline, body_copy, format, cost_per_match, daily_budget, status, req.params.id]
  );
  res.json(rows[0]);
});
app.delete('/api/ads/:id', requireAuth, async (req, res) => {
  await pool.query('DELETE FROM ads WHERE id=$1', [req.params.id]);
  res.json({ success: true });
});

app.get('/api/buyers', requireAuth, requireAdmin, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM buyers ORDER BY created_at DESC');
  res.json(rows);
});

app.get('/api/stats', requireAuth, async (req, res) => {
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
app.post('/api/products/:id/upload-image', requireAuth, upload.single('file'), async (req, res) => {
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
async function semanticSearch(queryText, limit = 12, category = null) {
  // Generate embedding for the query
  const embedding = await generateQueryEmbedding(queryText);
  const vectorStr = `[${embedding.join(',')}]`;

  let sql = `
    SELECT 
      a.id, a.headline, a.body_copy, a.format, a.media_url,
      a.cost_per_match, a.intent_tags, a.status, a.thumbnail_url,
      p.title as product_title, p.price, p.category, p.currency, p.product_url, p.image_url as product_image_url,
      s.name as seller_name, s.industry, s.location as seller_location, s.is_verified as seller_verified,
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

  sql += ` AND (1 - (ae.embedding <=> $1::vector)) > 0.35`;
  sql += ` ORDER BY ae.embedding <=> $1::vector LIMIT $${params.length + 1}`;
  params.push(limit);

  const { rows } = await pool.query(sql, params);
  return rows.map((row, rank) => ({
    ...row,
    relevance_score: Math.max(parseFloat(row.similarity_score), 0),
    rank_position: rank + 1,
  }));
}

// ── Semantic search endpoint for buyer search ─────────────────
app.post('/api/buyer/semantic-match', async (req, res) => {
  const { query, category, device_id, limit = 12 } = req.body;
  if (!query && !category) return res.status(400).json({ error: 'Query or category required' });

  try {
    const searchText = query || category;
    const matches = await semanticSearch(searchText, limit, category);

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
          `, [buyerId, sessionId, match.id, match.relevance_score, match.rank_position]);
          await pool.query(`UPDATE ads SET spent = spent + cost_per_match WHERE id = $1`, [match.id]);
        }
      } catch (logErr) {
        console.error('Match logging error:', logErr.message);
      }
    }

    res.json({ matches, query, category, total: matches.length, engine: 'pgvector' });
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
             s.name as seller_name, s.location as seller_location, s.is_verified as seller_verified
      FROM ads a
      JOIN products p ON a.product_id = p.id
      JOIN sellers s ON p.seller_id = s.id
      WHERE a.status = 'active'
      ORDER BY a.cost_per_match DESC
      LIMIT 4
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

        // Log matches
        for (const match of matches) {
          await pool.query(`
            INSERT INTO ad_matches (id, buyer_id, session_id, ad_id, relevance_score, rank_position, status, matched_at)
            VALUES (uuid_generate_v4(), $1, $2, $3, $4, $5, 'served', now())
          `, [buyerId, sessionId, match.id, match.relevance_score, match.rank_position]);

          // Deduct cost from ad spend
          await pool.query(`
            UPDATE ads SET spent = spent + cost_per_match WHERE id = $1
          `, [match.id]);
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
  const { match_id, ad_id } = req.body;
  try {
    if (match_id) {
      await pool.query(`UPDATE ad_matches SET status='clicked' WHERE id=$1`, [match_id]);
    }

    if (ad_id) {
      try {
        const result = await pool.query(
          `SELECT p.title, s.email, s.name
           FROM ads a
           JOIN products p ON a.product_id = p.id
           JOIN sellers s ON p.seller_id = s.id
           WHERE a.id = $1`,
          [ad_id]
        );
        if (result.rows[0]) {
          const { title, email, name } = result.rows[0];
          // Sanitize inputs before sending email
          const sanitizedTitle = sanitizeForEmail(title);
          const sanitizedName = sanitizeForEmail(name);
          sendMatchNotificationEmail(email, sanitizedName, sanitizedTitle, 'click');
        }
      } catch (emailErr) {
        console.error('Could not send click email:', emailErr);
      }
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── ANALYTICS ROUTES ─────────────────────────────────────────

// Platform overview stats
app.get('/api/analytics/overview', requireAuth, async (req, res) => {
  const { start, end } = req.query;
  const dateFilter = start && end
    ? `WHERE created_at BETWEEN '${start}' AND '${end}'`
    : `WHERE created_at >= now() - interval '30 days'`;

  const [sellers, products, ads, buyers, revenue, matches] = await Promise.all([
    pool.query(`SELECT COUNT(*) FROM sellers ${dateFilter}`),
    pool.query(`SELECT COUNT(*) FROM products ${dateFilter}`),
    pool.query(`SELECT COUNT(*) FROM ads ${dateFilter}`),
    pool.query(`SELECT COUNT(*) FROM buyers ${dateFilter}`),
    pool.query(`SELECT COALESCE(SUM(spent),0) as total FROM ads`),
    // pool.query(`SELECT COUNT(*) FROM ad_matches ${dateFilter}`),
    pool.query(`SELECT COUNT(*) FROM ad_matches ${dateFilter.replace('created_at', 'matched_at')}`)

  ]);

  res.json({
    sellers: parseInt(sellers.rows[0].count),
    products: parseInt(products.rows[0].count),
    ads: parseInt(ads.rows[0].count),
    buyers: parseInt(buyers.rows[0].count),
    revenue: parseFloat(revenue.rows[0].total),
    matches: parseInt(matches.rows[0].count),
  });
});

// Daily spend trend (line chart)
app.get('/api/analytics/spend-trend', requireAuth, async (req, res) => {
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
});

// Top sellers by spend (bar chart)
app.get('/api/analytics/top-sellers', requireAuth, async (req, res) => {
  const { start, end, limit = 10 } = req.query;
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
});

// Top performing ads (bar chart)
app.get('/api/analytics/top-ads', requireAuth, async (req, res) => {
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
});

// Ads by format (donut chart)
app.get('/api/analytics/ads-by-format', requireAuth, async (req, res) => {
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
});

// Ads by category (bar chart)
app.get('/api/analytics/ads-by-category', requireAuth, async (req, res) => {
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
});

// Buyers by platform (donut chart)
app.get('/api/analytics/buyers-by-platform', requireAuth, async (req, res) => {
  const { rows } = await pool.query(`
    SELECT 
      platform,
      COUNT(*) as count
    FROM buyers
    GROUP BY platform
    ORDER BY count DESC
  `);
  res.json(rows);
});

// Sellers by plan (donut chart)
app.get('/api/analytics/sellers-by-plan', requireAuth, async (req, res) => {
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
});

// Buyer activity over time
app.get('/api/analytics/buyer-trend', requireAuth, async (req, res) => {
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
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Ad Engine API running on http://localhost:${PORT}`));
