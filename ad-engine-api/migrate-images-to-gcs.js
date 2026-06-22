require('dotenv').config();
const { Storage } = require('@google-cloud/storage');
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'postgres',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'Colleen1',
});

const storage = new Storage({
  projectId: process.env.GCP_PROJECT_ID,
  keyFilename: process.env.GCP_KEY_FILE,
});

const bucket = storage.bucket(process.env.GCP_BUCKET_NAME);

async function uploadBase64ToGCS(base64String, filename) {
  // Strip the data:image/png;base64, prefix
  const base64Data = base64String.replace(/^data:image\/\w+;base64,/, '');
  const buffer = Buffer.from(base64Data, 'base64');

  const file = bucket.file(`ads/${filename}`);
  await file.save(buffer, {
    metadata: { contentType: 'image/png' },
  });

  return `https://storage.googleapis.com/${process.env.GCP_BUCKET_NAME}/ads/${filename}`;
}

async function migrate() {
  // Get all ads with base64 images
  const { rows: ads } = await pool.query(`
    SELECT id, headline, media_url
    FROM ads
    WHERE media_url LIKE 'data:image%'
    ORDER BY created_at ASC
  `);

  console.log(`\n☁️  Found ${ads.length} ads with base64 images to migrate\n`);

  if (ads.length === 0) {
    console.log('✅ All images already migrated to GCS!');
    process.exit(0);
  }

  let success = 0;
  let failed = 0;

  for (let i = 0; i < ads.length; i++) {
    const ad = ads[i];
    const num = `[${i + 1}/${ads.length}]`;
    const filename = `${ad.id}.png`;

    try {
      process.stdout.write(`${num} Uploading "${ad.headline}"... `);

      const gcsUrl = await uploadBase64ToGCS(ad.media_url, filename);

      await pool.query(
        'UPDATE ads SET media_url=$1, updated_at=now() WHERE id=$2',
        [gcsUrl, ad.id]
      );

      console.log(`✅ ${gcsUrl}`);
      success++;

    } catch (err) {
      console.log(`❌ Failed: ${err.message}`);
      failed++;
    }
  }

  console.log(`\n🏁 Migration complete!`);
  console.log(`   ✅ Success: ${success}`);
  console.log(`   ❌ Failed:  ${failed}`);
  console.log(`\n📦 Images are now at:`);
  console.log(`   https://storage.googleapis.com/${process.env.GCP_BUCKET_NAME}/ads/`);

  await pool.end();
}

migrate().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
