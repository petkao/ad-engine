// Twilio Phone Verification Service
// Uses raw SMS with in-memory OTP storage (no Verify Service required)

const twilio = require('twilio');
const crypto = require('crypto');

// Initialize Twilio client
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER;

let client = null;

function getClient() {
  if (!client && accountSid && authToken) {
    client = twilio(accountSid, authToken);
  }
  return client;
}

// In-memory OTP storage: Map<phoneNumber, { code, expiresAt, attempts }>
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
  // crypto.randomInt generates a random integer in range [0, 999999]
  const code = crypto.randomInt(0, 1000000);
  return code.toString().padStart(OTP_LENGTH, '0');
}

/**
 * Clean up expired OTPs periodically
 */
function cleanupExpiredOTPs() {
  const now = Date.now();
  for (const [phone, data] of otpStore.entries()) {
    if (data.expiresAt < now) {
      otpStore.delete(phone);
    }
  }
}

// Run cleanup every 5 minutes
setInterval(cleanupExpiredOTPs, 5 * 60 * 1000);

/**
 * Send a verification code to a phone number via SMS
 * @param {string} phoneNumber - Phone number in E.164 format (e.g., +14155551234)
 * @returns {Promise<{success: boolean, sid?: string, error?: string}>}
 */
async function sendVerificationCode(phoneNumber) {
  const twilioClient = getClient();

  if (!twilioClient) {
    console.log('[Twilio] Client not configured, skipping verification');
    return { success: false, error: 'Twilio not configured' };
  }

  if (!twilioPhoneNumber) {
    console.log('[Twilio] Phone number not configured');
    return { success: false, error: 'Twilio phone number not configured' };
  }

  // Validate phone number format
  if (!phoneNumber || !phoneNumber.match(/^\+[1-9]\d{6,14}$/)) {
    return { success: false, error: 'Invalid phone number format. Use E.164 format (e.g., +14155551234)' };
  }

  try {
    // Generate OTP
    const code = generateOTP();
    const expiresAt = Date.now() + OTP_EXPIRY_MS;

    // Store OTP
    otpStore.set(phoneNumber, { code, expiresAt, attempts: 0 });

    console.log(`[Twilio] Sending OTP to ${phoneNumber}`);

    // Send SMS
    const message = await twilioClient.messages.create({
      body: `Your PinkCurve verification code is: ${code}. Valid for 10 minutes.`,
      from: twilioPhoneNumber,
      to: phoneNumber
    });

    console.log(`[Twilio] SMS sent, SID: ${message.sid}, status: ${message.status}`);

    return {
      success: true,
      sid: message.sid,
      status: message.status
    };
  } catch (error) {
    console.error('[Twilio] Error sending SMS:', error.message);

    // Clean up stored OTP on failure
    otpStore.delete(phoneNumber);

    // Handle specific Twilio errors
    if (error.code === 21211) {
      return { success: false, error: 'Invalid phone number' };
    }
    if (error.code === 21608) {
      return { success: false, error: 'Cannot send to this phone number' };
    }
    if (error.code === 21610) {
      return { success: false, error: 'Phone number has opted out of messages' };
    }

    return { success: false, error: error.message || 'Failed to send verification code' };
  }
}

/**
 * Check a verification code
 * @param {string} phoneNumber - Phone number in E.164 format
 * @param {string} code - The verification code entered by user
 * @returns {Promise<{success: boolean, valid?: boolean, error?: string}>}
 */
async function checkVerificationCode(phoneNumber, code) {
  // Validate inputs
  if (!phoneNumber || !phoneNumber.match(/^\+[1-9]\d{6,14}$/)) {
    return { success: false, error: 'Invalid phone number format' };
  }

  if (!code || !code.match(/^\d{6}$/)) {
    return { success: false, error: 'Invalid verification code format. Must be 6 digits.' };
  }

  const stored = otpStore.get(phoneNumber);

  if (!stored) {
    return { success: false, error: 'No verification code found. Please request a new code.' };
  }

  // Check expiry
  if (Date.now() > stored.expiresAt) {
    otpStore.delete(phoneNumber);
    return { success: false, error: 'Verification code expired. Please request a new code.' };
  }

  // Check attempts
  if (stored.attempts >= MAX_ATTEMPTS) {
    otpStore.delete(phoneNumber);
    return { success: false, error: 'Too many failed attempts. Please request a new code.' };
  }

  // Verify code (constant-time comparison to prevent timing attacks)
  const isValid = crypto.timingSafeEqual(
    Buffer.from(code.padStart(OTP_LENGTH, '0')),
    Buffer.from(stored.code.padStart(OTP_LENGTH, '0'))
  );

  if (isValid) {
    // Code verified - remove from store
    otpStore.delete(phoneNumber);
    console.log(`[Twilio] OTP verified for ${phoneNumber}`);
    return { success: true, valid: true };
  } else {
    // Increment attempts
    stored.attempts++;
    otpStore.set(phoneNumber, stored);
    console.log(`[Twilio] Invalid OTP attempt ${stored.attempts}/${MAX_ATTEMPTS} for ${phoneNumber}`);
    return { success: true, valid: false, error: 'Invalid verification code' };
  }
}

/**
 * Format phone number to E.164
 * @param {string} phone - Phone number (various formats)
 * @param {string} countryCode - Default country code (e.g., '1' for US)
 * @returns {string} Phone number in E.164 format
 */
function formatPhoneE164(phone, countryCode = '1') {
  if (!phone) return null;

  // Remove all non-digit characters except leading +
  let cleaned = phone.replace(/[^\d+]/g, '');

  // If already in E.164 format, return as is
  if (cleaned.startsWith('+')) {
    return cleaned;
  }

  // If starts with country code without +, add it
  if (cleaned.length === 11 && cleaned.startsWith('1')) {
    return '+' + cleaned;
  }

  // If 10 digits (US number without country code), add +1
  if (cleaned.length === 10) {
    return '+' + countryCode + cleaned;
  }

  // Return with + prefix
  return '+' + cleaned;
}

/**
 * Check if Twilio is properly configured
 * @returns {boolean}
 */
function isConfigured() {
  return !!(accountSid && authToken && twilioPhoneNumber);
}

module.exports = {
  sendVerificationCode,
  checkVerificationCode,
  formatPhoneE164,
  isConfigured
};
