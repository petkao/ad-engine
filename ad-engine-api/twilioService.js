// Twilio Phone Verification Service
// Uses Twilio Verify API for SMS verification codes

const twilio = require('twilio');

// Initialize Twilio client
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const verifyServiceSid = process.env.TWILIO_VERIFY_SERVICE_SID;

let client = null;

function getClient() {
  if (!client && accountSid && authToken) {
    client = twilio(accountSid, authToken);
  }
  return client;
}

/**
 * Send a verification code to a phone number
 * @param {string} phoneNumber - Phone number in E.164 format (e.g., +14155551234)
 * @returns {Promise<{success: boolean, sid?: string, error?: string}>}
 */
async function sendVerificationCode(phoneNumber) {
  const twilioClient = getClient();

  if (!twilioClient) {
    console.log('[Twilio] Client not configured, skipping verification');
    return { success: false, error: 'Twilio not configured' };
  }

  if (!verifyServiceSid) {
    console.log('[Twilio] Verify Service SID not configured');
    return { success: false, error: 'Verify service not configured' };
  }

  // Validate phone number format
  if (!phoneNumber || !phoneNumber.match(/^\+[1-9]\d{6,14}$/)) {
    return { success: false, error: 'Invalid phone number format. Use E.164 format (e.g., +14155551234)' };
  }

  try {
    console.log(`[Twilio] Sending verification to ${phoneNumber}`);

    const verification = await twilioClient.verify.v2
      .services(verifyServiceSid)
      .verifications
      .create({
        to: phoneNumber,
        channel: 'sms'
      });

    console.log(`[Twilio] Verification sent, status: ${verification.status}, SID: ${verification.sid}`);

    return {
      success: true,
      sid: verification.sid,
      status: verification.status
    };
  } catch (error) {
    console.error('[Twilio] Error sending verification:', error.message);

    // Handle specific Twilio errors
    if (error.code === 60200) {
      return { success: false, error: 'Invalid phone number' };
    }
    if (error.code === 60203) {
      return { success: false, error: 'Max send attempts reached. Please wait before retrying.' };
    }
    if (error.code === 60212) {
      return { success: false, error: 'Too many requests. Please wait before retrying.' };
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
  const twilioClient = getClient();

  if (!twilioClient) {
    console.log('[Twilio] Client not configured, skipping verification check');
    return { success: false, error: 'Twilio not configured' };
  }

  if (!verifyServiceSid) {
    return { success: false, error: 'Verify service not configured' };
  }

  // Validate inputs
  if (!phoneNumber || !phoneNumber.match(/^\+[1-9]\d{6,14}$/)) {
    return { success: false, error: 'Invalid phone number format' };
  }

  if (!code || !code.match(/^\d{4,8}$/)) {
    return { success: false, error: 'Invalid verification code format' };
  }

  try {
    console.log(`[Twilio] Checking verification for ${phoneNumber}`);

    const verificationCheck = await twilioClient.verify.v2
      .services(verifyServiceSid)
      .verificationChecks
      .create({
        to: phoneNumber,
        code: code
      });

    console.log(`[Twilio] Verification check status: ${verificationCheck.status}`);

    if (verificationCheck.status === 'approved') {
      return { success: true, valid: true };
    } else {
      return { success: true, valid: false, error: 'Invalid or expired code' };
    }
  } catch (error) {
    console.error('[Twilio] Error checking verification:', error.message);

    // Handle specific Twilio errors
    if (error.code === 20404) {
      return { success: false, error: 'Verification expired or not found. Please request a new code.' };
    }
    if (error.code === 60202) {
      return { success: false, error: 'Max check attempts reached. Please request a new code.' };
    }

    return { success: false, error: error.message || 'Failed to check verification code' };
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
  return !!(accountSid && authToken && verifyServiceSid);
}

module.exports = {
  sendVerificationCode,
  checkVerificationCode,
  formatPhoneE164,
  isConfigured
};
