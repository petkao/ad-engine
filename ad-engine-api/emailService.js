const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM = process.env.EMAIL_FROM || 'PinkCurve <onboarding@resend.dev>';

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
            to: sellerEmail,
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
            to: sellerEmail,
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

module.exports = { sendAdApprovedEmail, sendMatchNotificationEmail, setPool };