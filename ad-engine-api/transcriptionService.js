/**
 * Whisper Transcription Service for Video Ads
 *
 * Transcribes video ad audio using OpenAI's Whisper API
 * to improve semantic search quality.
 */

const OpenAI = require('openai');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Download a file from URL to a temporary location
 */
async function downloadFile(url) {
  return new Promise((resolve, reject) => {
    const tempPath = path.join(os.tmpdir(), `video_${Date.now()}.mp4`);
    const file = fs.createWriteStream(tempPath);

    const protocol = url.startsWith('https') ? https : http;

    protocol.get(url, (response) => {
      // Handle redirects
      if (response.statusCode === 301 || response.statusCode === 302) {
        file.close();
        fs.unlinkSync(tempPath);
        return downloadFile(response.headers.location).then(resolve).catch(reject);
      }

      if (response.statusCode !== 200) {
        file.close();
        fs.unlinkSync(tempPath);
        return reject(new Error(`Failed to download: HTTP ${response.statusCode}`));
      }

      response.pipe(file);

      file.on('finish', () => {
        file.close();
        resolve(tempPath);
      });

      file.on('error', (err) => {
        fs.unlinkSync(tempPath);
        reject(err);
      });
    }).on('error', (err) => {
      fs.unlinkSync(tempPath);
      reject(err);
    });
  });
}

/**
 * Transcribe a video ad using Whisper API
 * @param {string} videoUrl - URL of the video file (GCS or other)
 * @returns {Promise<string|null>} - Transcript text or null if failed/silent
 */
async function transcribeVideoAd(videoUrl) {
  if (!videoUrl) {
    console.log('[Transcription] No video URL provided');
    return null;
  }

  let tempPath = null;

  try {
    console.log(`[Transcription] Downloading video: ${videoUrl}`);
    tempPath = await downloadFile(videoUrl);

    const stats = fs.statSync(tempPath);
    console.log(`[Transcription] Downloaded ${(stats.size / 1024 / 1024).toFixed(2)} MB`);

    // Whisper API has a 25MB limit
    if (stats.size > 25 * 1024 * 1024) {
      console.log('[Transcription] File too large for Whisper API (>25MB)');
      return null;
    }

    console.log('[Transcription] Sending to Whisper API...');
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tempPath),
      model: 'whisper-1',
      language: 'en',
      response_format: 'text',
    });

    console.log(`[Transcription] Result: "${transcription.substring(0, 100)}..."`);
    return transcription;

  } catch (err) {
    console.error('[Transcription] Error:', err.message);
    return null;
  } finally {
    // Clean up temp file
    if (tempPath && fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
    }
  }
}

/**
 * Check if transcript is meaningful (not just music/silence tags)
 * @param {string} text - Transcript text
 * @returns {boolean} - True if transcript has meaningful content
 */
function isMeaningfulTranscript(text) {
  if (!text || typeof text !== 'string') return false;

  // Remove common noise markers
  const noisePatterns = [
    /\[Music\]/gi,
    /\[Silence\]/gi,
    /\[Applause\]/gi,
    /\[Laughter\]/gi,
    /\[Background noise\]/gi,
    /\[Inaudible\]/gi,
    /♪+/g,
    /🎵+/g,
    /\*+/g,
  ];

  let clean = text.trim();
  noisePatterns.forEach(pattern => {
    clean = clean.replace(pattern, '');
  });

  // Remove extra whitespace
  clean = clean.replace(/\s+/g, ' ').trim();

  // Require at least 20 characters of real content
  return clean.length >= 20;
}

/**
 * Build enhanced embedding text with transcript
 * @param {object} ad - Ad object with headline, body_copy, intent_tags
 * @param {string|null} transcript - Video transcript if available
 * @returns {string} - Combined text for embedding
 */
function buildAdTextWithTranscript(ad, transcript) {
  const tags = Array.isArray(ad.intent_tags)
    ? ad.intent_tags.join(', ')
    : (() => { try { return JSON.parse(ad.intent_tags).join(', '); } catch { return ad.intent_tags || ''; } })();

  const parts = [
    `Headline: ${ad.headline}`,
    `Description: ${ad.body_copy || ''}`,
    `Product: ${ad.product_title || ''}`,
    `Category: ${ad.category || ''}`,
    `Industry: ${ad.industry || ''}`,
    `Intent tags: ${tags}`,
    `Price: $${ad.price || ''}`,
  ];

  // Add transcript if meaningful
  if (transcript && isMeaningfulTranscript(transcript)) {
    parts.push(`Video narration: ${transcript}`);
  }

  return parts.filter(Boolean).join('\n');
}

module.exports = {
  transcribeVideoAd,
  isMeaningfulTranscript,
  buildAdTextWithTranscript,
};
