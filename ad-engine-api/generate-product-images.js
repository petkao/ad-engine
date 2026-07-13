require('dotenv').config();
const { Pool } = require('pg');
const OpenAI = require('openai');
const { Storage } = require('@google-cloud/storage');
const https = require('https');

const pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     process.env.DB_PORT     || 5432,
  database: process.env.DB_NAME     || 'postgres',
  user:     process.env.DB_USER     || 'postgres',
  password: process.env.DB_PASSWORD || 'Colleen1',
});

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const storage = new Storage({
  projectId: process.env.GCP_PROJECT_ID,
  keyFilename: process.env.GCP_KEY_FILE
});
const gcsBucket = storage.bucket(process.env.GCP_BUCKET_NAME || 'ad-engine-media-pka');

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function downloadImage(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve(Buffer.concat(chunks)));
      response.on('error', reject);
    }).on('error', reject);
  });
}

async function uploadToGCS(buffer, filename) {
  const file = gcsBucket.file(filename);
  await file.save(buffer, { metadata: { contentType: 'image/png' } });
  return `https://storage.googleapis.com/${gcsBucket.name}/${filename}`;
}

async function generateProductImages() {
  console.log('\n🖼️  Product Image Generator (DALL-E 3)\n');

  // Query products without images
  const { rows: products } = await pool.query(`
    SELECT id, title, description, category
    FROM products
    WHERE image_url IS NULL
    ORDER BY created_at ASC
  `);

  if (products.length === 0) {
    console.log('✅ All products already have images!');
    await pool.end();
    return;
  }

  console.log(`Found ${products.length} products without images\n`);

  let success = 0;
  let failed = 0;

  for (let i = 0; i < products.length; i++) {
    const product = products[i];
    const num = `[${i + 1}/${products.length}]`;

    try {
      process.stdout.write(`${num} Generating image for "${product.title}"... `);

      // Generate image with DALL-E 3
      const prompt = `Professional e-commerce product photo of: ${product.title}. White background, studio lighting, high quality.`;

      const response = await openai.images.generate({
        model: 'dall-e-3',
        prompt,
        n: 1,
        size: '1024x1024',
        quality: 'standard',
      });

      const imageUrl = response.data[0].url;

      // Download the generated image
      const imageBuffer = await downloadImage(imageUrl);

      // Upload to GCS
      const filename = `products/${product.id}.png`;
      const gcsUrl = await uploadToGCS(imageBuffer, filename);

      // Update database
      await pool.query(
        'UPDATE products SET image_url = $1, updated_at = now() WHERE id = $2',
        [gcsUrl, product.id]
      );

      console.log('✅');
      success++;

      // Rate limit - 1 second between requests
      if (i < products.length - 1) {
        await sleep(1000);
      }

    } catch (err) {
      console.log(`❌ Failed: ${err.message}`);
      failed++;
      // Wait longer after failure
      await sleep(2000);
    }
  }

  console.log('\n🏁 Image generation complete!');
  console.log(`   ✅ Generated: ${success}`);
  console.log(`   ❌ Failed: ${failed}`);
  console.log(`\n💰 Estimated cost: $${(success * 0.04).toFixed(2)} (DALL-E 3 standard @ $0.04/image)`);

  await pool.end();
}

generateProductImages().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
