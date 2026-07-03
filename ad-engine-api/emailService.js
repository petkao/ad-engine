const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM = process.env.EMAIL_FROM || 'PinkCurve <onboarding@resend.dev>';

// TEST_EMAIL override: if set, all emails go to this address instead of real recipients
const TEST_EMAIL = process.env.TEST_EMAIL || null;

function getRecipient(originalEmail) {
    if (TEST_EMAIL) {
        console.log(`[TEST MODE] Redirecting email from ${originalEmail} to ${TEST_EMAIL}`);
        return TEST_EMAIL;
    }
    return originalEmail;
}

// Database pool for allowlist verification
let pool = null;

function setPool(dbPool) {
    pool = dbPool;
}

// ── PROMPT INJECTION SANITIZATION ─────────────────────────────
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

// ── RECIPIENT ALLOWLIST CHECK ─────────────────────────────────
// Verify email recipient exists in sellers table
async function isAllowedRecipient(email) {
    if (!pool) {
        console.warn('Email allowlist: No database pool configured, skipping check');
        return true; // Fail open if no pool (shouldn't happen in production)
    }
    if (!email || typeof email !== 'string') {
        return false;
    }
    try {
        const { rows } = await pool.query(
            'SELECT id FROM sellers WHERE email = $1 LIMIT 1',
            [email.toLowerCase().trim()]
        );
        return rows.length > 0;
    } catch (err) {
        console.error('Error checking recipient allowlist:', err);
        return false; // Fail closed on error
    }
}

async function sendAdApprovedEmail(sellerEmail, sellerName, adTitle) {
    try {
        // Check prompt injection in inputs
        if (containsPromptInjection(sellerName) || containsPromptInjection(adTitle)) {
            console.warn(`Blocked email to ${sellerEmail}: prompt injection detected`);
            return;
        }

        // Verify recipient is in sellers allowlist
        const allowed = await isAllowedRecipient(sellerEmail);
        if (!allowed) {
            console.warn(`Blocked email: ${sellerEmail} not in sellers allowlist`);
            return;
        }

        // Sanitize inputs for email content
        const safeName = sanitizeForEmail(sellerName);
        const safeTitle = sanitizeForEmail(adTitle);

        await resend.emails.send({
            from: FROM,
            to: getRecipient(sellerEmail),
            subject: `Your ad "${safeTitle}" is live on PinkCurve!`,
            html: `
        <div style="font-family: sans-serif; max-width: 500px; margin: 0 auto;">
          <h2 style="color: #ec4899;">Great news, ${safeName}!</h2>
          <p>Your ad <strong>"${safeTitle}"</strong> has been approved and is now live on PinkCurve.</p>
          <p>Buyers can now discover your product through our intent-matching engine.</p>
          <a href="https://ad-engine-4da45.web.app" style="display:inline-block;margin-top:16px;padding:10px 20px;background:linear-gradient(135deg,#ec4899,#a855f7);color:white;text-decoration:none;border-radius:6px;">View Dashboard</a>
        </div>
      `,
        });
        console.log(`Approval email sent to ${sellerEmail}`);
    } catch (err) {
        console.error('Failed to send approval email:', err);
    }
}

async function sendMatchNotificationEmail(sellerEmail, sellerName, adTitle, matchType) {
    try {
        // Check prompt injection in inputs
        if (containsPromptInjection(sellerName) || containsPromptInjection(adTitle)) {
            console.warn(`Blocked email to ${sellerEmail}: prompt injection detected`);
            return;
        }

        // Verify recipient is in sellers allowlist
        const allowed = await isAllowedRecipient(sellerEmail);
        if (!allowed) {
            console.warn(`Blocked email: ${sellerEmail} not in sellers allowlist`);
            return;
        }

        // Sanitize inputs for email content
        const safeName = sanitizeForEmail(sellerName);
        const safeTitle = sanitizeForEmail(adTitle);

        await resend.emails.send({
            from: FROM,
            to: getRecipient(sellerEmail),
            subject: `New activity on "${safeTitle}"`,
            html: `
        <div style="font-family: sans-serif; max-width: 500px; margin: 0 auto;">
          <h2 style="color: #ec4899;">Hi ${safeName},</h2>
          <p>Your ad <strong>"${safeTitle}"</strong> just got a new ${matchType === 'click' ? 'click' : 'match'} from a buyer on PinkCurve.</p>
          <a href="https://ad-engine-4da45.web.app" style="display:inline-block;margin-top:16px;padding:10px 20px;background:linear-gradient(135deg,#ec4899,#a855f7);color:white;text-decoration:none;border-radius:6px;">View Analytics</a>
        </div>
      `,
        });
        console.log(`Match notification sent to ${sellerEmail}`);
    } catch (err) {
        console.error('Failed to send match email:', err);
    }
}

async function sendVerificationEmail(sellerEmail, sellerName, verificationToken) {
    try {
        // Check prompt injection in inputs
        if (containsPromptInjection(sellerName)) {
            console.warn(`Blocked verification email to ${sellerEmail}: prompt injection detected`);
            return false;
        }

        // Sanitize inputs for email content
        const safeName = sanitizeForEmail(sellerName);
        const verifyUrl = `https://ad-engine-4da45.web.app/verify-email?token=${verificationToken}`;

        await resend.emails.send({
            from: FROM,
            to: getRecipient(sellerEmail),
            subject: 'Verify your PinkCurve seller account',
            html: `
        <div style="font-family: sans-serif; max-width: 500px; margin: 0 auto; padding: 20px;">
          <div style="text-align: center; margin-bottom: 24px;">
            <h1 style="font-size: 28px; font-weight: bold; background: linear-gradient(135deg, #ec4899, #a855f7); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">PinkCurve</h1>
          </div>
          <h2 style="color: #1e293b; margin-bottom: 16px;">Welcome, ${safeName}!</h2>
          <p style="color: #475569; line-height: 1.6;">Thanks for registering as a seller on PinkCurve. Please verify your email address to activate your account.</p>
          <div style="text-align: center; margin: 32px 0;">
            <a href="${verifyUrl}" style="display: inline-block; padding: 14px 32px; background: linear-gradient(135deg, #ec4899, #a855f7); color: white; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">Verify Email</a>
          </div>
          <p style="color: #64748b; font-size: 14px;">This link expires in 24 hours.</p>
          <p style="color: #64748b; font-size: 14px;">If you didn't create this account, you can safely ignore this email.</p>
          <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;">
          <p style="color: #94a3b8; font-size: 12px; text-align: center;">PinkCurve — Intent-Powered Advertising</p>
        </div>
      `,
        });
        console.log(`Verification email sent to ${sellerEmail}`);
        return true;
    } catch (err) {
        console.error('Failed to send verification email:', err);
        return false;
    }
}

module.exports = { sendAdApprovedEmail, sendMatchNotificationEmail, sendVerificationEmail, setPool };