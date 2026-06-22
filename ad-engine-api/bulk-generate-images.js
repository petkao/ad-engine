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

async function generateImage(ad) {
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
  });

  return `data:image/png;base64,${response.data[0].b64_json}`;
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function bulkGenerate() {
  // Get all ads without images
  const { rows: ads } = await pool.query(`
    SELECT a.id, a.headline, a.format,
           p.title as product_title, p.category
    FROM ads a
    JOIN products p ON a.product_id = p.id
    WHERE a.media_url IS NULL
    ORDER BY a.created_at ASC
  `);

  console.log(`\n🎨 Found ${ads.length} ads without images\n`);

  if (ads.length === 0) {
    console.log('✅ All ads already have images!');
    process.exit(0);
  }

  let success = 0;
  let failed  = 0;

  for (let i = 0; i < ads.length; i++) {
    const ad = ads[i];
    const num = `[${i + 1}/${ads.length}]`;

    try {
      process.stdout.write(`${num} Generating image for "${ad.headline}"... `);

      const imageUrl = await generateImage(ad);

      await pool.query(
        'UPDATE ads SET media_url=$1, updated_at=now() WHERE id=$2',
        [imageUrl, ad.id]
      );

      console.log('✅ Done');
      success++;

      // Wait 2 seconds between requests to avoid rate limiting
      if (i < ads.length - 1) await sleep(2000);

    } catch (err) {
      console.log(`❌ Failed: ${err.message}`);
      failed++;

      // Wait longer after an error
      await sleep(5000);
    }
  }

  console.log(`\n🏁 Bulk generation complete!`);
  console.log(`   ✅ Success: ${success}`);
  console.log(`   ❌ Failed:  ${failed}`);
  console.log(`   💰 Estimated cost: $${(success * 0.04).toFixed(2)}`);

  await pool.end();
}

bulkGenerate().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
