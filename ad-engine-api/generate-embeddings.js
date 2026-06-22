require('dotenv').config();
const { Pool } = require('pg');
const OpenAI = require('openai');

const pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     process.env.DB_PORT     || 5432,
  database: process.env.DB_NAME     || 'postgres',
  user:     process.env.DB_USER     || 'postgres',
  password: process.env.DB_PASSWORD || 'Colleen1',
});

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Build text representation of ad for embedding
function buildAdText(ad) {
  const tags = Array.isArray(ad.intent_tags)
    ? ad.intent_tags.join(', ')
    : (() => { try { return JSON.parse(ad.intent_tags).join(', '); } catch { return ad.intent_tags || ''; } })();

  return [
    `Headline: ${ad.headline}`,
    `Description: ${ad.body_copy || ''}`,
    `Product: ${ad.product_title}`,
    `Category: ${ad.category}`,
    `Industry: ${ad.industry || ''}`,
    `Intent tags: ${tags}`,
    `Price: $${ad.price}`,
  ].filter(Boolean).join('\n');
}

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

async function generateAllEmbeddings() {
  // Get all ads
  const { rows: ads } = await pool.query(`
    SELECT a.id, a.headline, a.body_copy, a.intent_tags, a.format,
           p.title as product_title, p.category, p.price,
           s.name as seller_name, s.industry
    FROM ads a
    JOIN products p ON a.product_id = p.id
    JOIN sellers s ON p.seller_id = s.id
    ORDER BY a.created_at ASC
  `);

  console.log(`\n🧠 Generating embeddings for ${ads.length} ads\n`);

  let success = 0;
  let failed  = 0;
  let skipped = 0;

  for (let i = 0; i < ads.length; i++) {
    const ad  = ads[i];
    const num = `[${i + 1}/${ads.length}]`;

    // Check if embedding already exists
    const existing = await pool.query(
      'SELECT id FROM ad_embeddings WHERE ad_id = $1', [ad.id]
    );

    if (existing.rows.length > 0) {
      console.log(`${num} ⏭️  Skipping "${ad.headline}" — already has embedding`);
      skipped++;
      continue;
    }

    try {
      process.stdout.write(`${num} Embedding "${ad.headline}"... `);

      const text      = buildAdText(ad);
      const embedding = await generateEmbedding(text);

      // Store embedding as pgvector format
      const vectorStr = `[${embedding.join(',')}]`;

      await pool.query(
        `INSERT INTO ad_embeddings (id, ad_id, embedding, model_version, created_at)
         VALUES (uuid_generate_v4(), $1, $2::vector, 'text-embedding-3-small', now())
         ON CONFLICT DO NOTHING`,
        [ad.id, vectorStr]
      );

      console.log('✅');
      success++;

      // Rate limit — 500ms between requests
      if (i < ads.length - 1) await sleep(500);

    } catch (err) {
      console.log(`❌ Failed: ${err.message}`);
      failed++;
      await sleep(2000);
    }
  }

  console.log(`\n🏁 Embedding generation complete!`);
  console.log(`   ✅ Generated: ${success}`);
  console.log(`   ⏭️  Skipped:  ${skipped}`);
  console.log(`   ❌ Failed:   ${failed}`);
  console.log(`\n💰 Estimated cost: $${(success * 0.00002).toFixed(4)} (text-embedding-3-small is very cheap!)`);

  await pool.end();
}

generateAllEmbeddings().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
