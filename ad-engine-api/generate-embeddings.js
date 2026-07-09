require('dotenv').config();
const { Pool } = require('pg');
const OpenAI = require('openai');
const { transcribeVideoAd, isMeaningfulTranscript, buildAdTextWithTranscript } = require('./transcriptionService');

// --force flag: regenerate ALL embeddings even if they already exist
const FORCE_REGENERATE = process.argv.includes('--force');

const pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     process.env.DB_PORT     || 5432,
  database: process.env.DB_NAME     || 'postgres',
  user:     process.env.DB_USER     || 'postgres',
  password: process.env.DB_PASSWORD || 'Colleen1',
});

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function generateEmbedding(text) {
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text,
  });
  return response.data[0].embedding;
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function ensureTranscriptColumns() {
  await pool.query(`
    ALTER TABLE ad_embeddings ADD COLUMN IF NOT EXISTS has_transcript BOOLEAN DEFAULT false;
    ALTER TABLE ad_embeddings ADD COLUMN IF NOT EXISTS transcript TEXT;
    ALTER TABLE ad_embeddings ADD COLUMN IF NOT EXISTS embedding_text TEXT;
  `);
  // Add unique index for ON CONFLICT support
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS ad_embeddings_ad_id_unique ON ad_embeddings(ad_id);
  `);
}

async function generateAllEmbeddings() {
  // Ensure transcript columns exist
  await ensureTranscriptColumns();

  // Get all ads with video info
  const { rows: ads } = await pool.query(`
    SELECT a.id, a.headline, a.body_copy, a.intent_tags, a.format, a.media_url,
           p.title as product_title, p.category, p.price,
           s.name as seller_name, s.industry
    FROM ads a
    JOIN products p ON a.product_id = p.id
    JOIN sellers s ON p.seller_id = s.id
    ORDER BY a.created_at ASC
  `);

  const modeLabel = FORCE_REGENERATE ? '(FORCE MODE - regenerating all)' : '(skipping existing)';
  console.log(`\n🧠 Generating embeddings for ${ads.length} ads ${modeLabel}\n`);

  let success = 0;
  let failed  = 0;
  let skipped = 0;
  let transcribed = 0;

  for (let i = 0; i < ads.length; i++) {
    const ad  = ads[i];
    const num = `[${i + 1}/${ads.length}]`;

    // Check if embedding already exists (skip this check if --force)
    if (!FORCE_REGENERATE) {
      const existing = await pool.query(
        'SELECT id FROM ad_embeddings WHERE ad_id = $1', [ad.id]
      );

      if (existing.rows.length > 0) {
        console.log(`${num} ⏭️  Skipping "${ad.headline}" — already has embedding`);
        skipped++;
        continue;
      }
    }

    try {
      process.stdout.write(`${num} Embedding "${ad.headline}"... `);

      // For video ads, try to transcribe
      let transcript = null;
      if (ad.format === 'video' && ad.media_url) {
        console.log('🎬 (transcribing video...)');
        transcript = await transcribeVideoAd(ad.media_url);
        if (isMeaningfulTranscript(transcript)) {
          transcribed++;
          console.log(`   📝 Transcript: "${transcript.substring(0, 50)}..."`);
        }
      }

      // Build text with transcript
      const embeddingText = buildAdTextWithTranscript(ad, transcript);
      const embedding = await generateEmbedding(embeddingText);

      // Store embedding as pgvector format (upsert)
      const vectorStr = `[${embedding.join(',')}]`;
      const hasTranscript = isMeaningfulTranscript(transcript);

      await pool.query(
        `INSERT INTO ad_embeddings (id, ad_id, embedding, model_version, has_transcript, transcript, embedding_text, created_at)
         VALUES (uuid_generate_v4(), $1, $2::vector, 'text-embedding-3-small', $3, $4, $5, now())
         ON CONFLICT (ad_id) DO UPDATE SET
           embedding = $2::vector,
           model_version = 'text-embedding-3-small',
           has_transcript = $3,
           transcript = $4,
           embedding_text = $5,
           created_at = now()`,
        [ad.id, vectorStr, hasTranscript, transcript, embeddingText]
      );

      console.log('✅');
      success++;

      // Rate limit — 500ms between requests (longer for videos due to transcription)
      const delay = ad.format === 'video' ? 2000 : 500;
      if (i < ads.length - 1) await sleep(delay);

    } catch (err) {
      console.log(`❌ Failed: ${err.message}`);
      failed++;
      await sleep(2000);
    }
  }

  console.log(`\n🏁 Embedding generation complete!`);
  console.log(`   ✅ Generated: ${success}`);
  console.log(`   🎬 Transcribed: ${transcribed}`);
  console.log(`   ⏭️  Skipped:  ${skipped}`);
  console.log(`   ❌ Failed:   ${failed}`);
  console.log(`\n💰 Estimated cost:`);
  console.log(`   - Embeddings: $${(success * 0.00002).toFixed(4)}`);
  console.log(`   - Whisper: $${(transcribed * 0.006).toFixed(4)} (assuming ~1min avg)`);

  await pool.end();
}

generateAllEmbeddings().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
