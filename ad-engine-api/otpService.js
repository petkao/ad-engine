// Email OTP Verification Service
// Uses Resend email with in-memory OTP storage

const { Resend } = require('resend');
const crypto = require('crypto');

// Initialize Resend client
const resend = new Resend(process.env.RESEND_API_KEY);

// In-memory OTP storage: Map<email, { code, expiresAt, attempts }>
const otpStore = new Map();

// OTP settings
const OTP_LENGTH = 6;
const OTP_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes
const MAX_ATTEMPTS = 3;

/**
 * Generate a cryptographically secure 6-digit OTP
 * @returns {string} 6-digit code
 */
function generateOTP() {
  const code = crypto.randomInt(0, 1000000);
  return code.toString().padStart(OTP_LENGTH, '0');
}

/**
 * Clean up expired OTPs periodically
 */
function cleanupExpiredOTPs() {
  const now = Date.now();
  for (const [email, data] of otpStore.entries()) {
    if (data.expiresAt < now) {
      otpStore.delete(email);
    }
  }
}

// Run cleanup every 5 minutes
setInterval(cleanupExpiredOTPs, 5 * 60 * 1000);

/**
 * Send a verification code to an email address
 * @param {string} email - Email address to send to
 * @param {string} buyerName - Buyer's name for personalization
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function sendVerificationCode(email, buyerName = 'there') {
  if (!process.env.RESEND_API_KEY) {
    console.log('[OTP] Resend API key not configured');
    return { success: false, error: 'Email service not configured' };
  }

  // Validate email format
  if (!email || !email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
    return { success: false, error: 'Invalid email address' };
  }

  try {
    // Generate OTP
    const code = generateOTP();
    const expiresAt = Date.now() + OTP_EXPIRY_MS;

    // Store OTP
    otpStore.set(email.toLowerCase(), { code, expiresAt, attempts: 0 });

    console.log(`[OTP] Sending verification code to ${email}`);

    // Send email via Resend
    const { data, error } = await resend.emails.send({
      from: 'PinkCurve <noreply@pinkcurve.com>',
      to: email,
      subject: 'Your PinkCurve verification code',
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
          <div style="text-align: center; margin-bottom: 24px;">
            <span style="font-size: 24px; font-weight: 700; background: linear-gradient(135deg, #ec4899, #a855f7); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">PinkCurve</span>
          </div>
          <p style="color: #334155; font-size: 16px; margin-bottom: 24px;">Hi ${buyerName},</p>
          <p style="color: #334155; font-size: 16px; margin-bottom: 24px;">Your verification code is:</p>
          <div style="background: #f1f5f9; border-radius: 12px; padding: 24px; text-align: center; margin-bottom: 24px;">
            <span style="font-size: 32px; font-weight: 700; letter-spacing: 8px; color: #1e293b; font-family: monospace;">${code}</span>
          </div>
          <p style="color: #64748b; font-size: 14px; margin-bottom: 8px;">This code is valid for 10 minutes.</p>
          <p style="color: #64748b; font-size: 14px;">If you didn't request this code, you can safely ignore this email.</p>
          <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
          <p style="color: #94a3b8; font-size: 12px; text-align: center;">PinkCurve by Peter Kao Associates</p>
        </div>
      `,
      text: `Your PinkCurve verification code is: ${code}. Valid for 10 minutes.`
    });

    if (error) {
      console.error('[OTP] Resend error:', error);
      otpStore.delete(email.toLowerCase());
      return { success: false, error: 'Failed to send verification email' };
    }

    console.log(`[OTP] Email sent successfully, ID: ${data?.id}`);
    return { success: true };
  } catch (error) {
    console.error('[OTP] Error sending email:', error.message);
    otpStore.delete(email.toLowerCase());
    return { success: false, error: error.message || 'Failed to send verification email' };
  }
}

/**
 * Check a verification code
 * @param {string} email - Email address
 * @param {string} code - The verification code entered by user
 * @returns {{success: boolean, valid?: boolean, error?: string}}
 */
function checkVerificationCode(email, code) {
  // Validate inputs
  if (!email || !email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
    return { success: false, error: 'Invalid email address' };
  }

  if (!code || !code.match(/^\d{6}$/)) {
    return { success: false, error: 'Invalid verification code format. Must be 6 digits.' };
  }

  const normalizedEmail = email.toLowerCase();
  const stored = otpStore.get(normalizedEmail);

  if (!stored) {
    return { success: false, error: 'No verification code found. Please request a new code.' };
  }

  // Check expiry
  if (Date.now() > stored.expiresAt) {
    otpStore.delete(normalizedEmail);
    return { success: false, error: 'Verification code expired. Please request a new code.' };
  }

  // Check attempts
  if (stored.attempts >= MAX_ATTEMPTS) {
    otpStore.delete(normalizedEmail);
    return { success: false, error: 'Too many failed attempts. Please request a new code.' };
  }

  // Verify code (constant-time comparison to prevent timing attacks)
  const isValid = crypto.timingSafeEqual(
    Buffer.from(code.padStart(OTP_LENGTH, '0')),
    Buffer.from(stored.code.padStart(OTP_LENGTH, '0'))
  );

  if (isValid) {
    // Code verified - remove from store
    otpStore.delete(normalizedEmail);
    console.log(`[OTP] Code verified for ${normalizedEmail}`);
    return { success: true, valid: true };
  } else {
    // Increment attempts
    stored.attempts++;
    otpStore.set(normalizedEmail, stored);
    console.log(`[OTP] Invalid attempt ${stored.attempts}/${MAX_ATTEMPTS} for ${normalizedEmail}`);
    return { success: true, valid: false, error: 'Invalid verification code' };
  }
}

/**
 * Check if email OTP service is configured
 * @returns {boolean}
 */
function isConfigured() {
  return !!process.env.RESEND_API_KEY;
}

module.exports = {
  sendVerificationCode,
  checkVerificationCode,
  isConfigured
};
