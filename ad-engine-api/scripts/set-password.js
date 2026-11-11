#!/usr/bin/env node
/**
 * Set a new password for a seller/admin login (seller_accounts).
 *
 * The password is typed at a hidden prompt (never passed as an argument or
 * printed) and stored as a bcrypt hash with the same cost the app uses (12).
 *
 * Usage (production, through the Cloud SQL proxy):
 *   cloud-sql-proxy ad-engine-4da45:us-west1:ad-engine-db --port 5435 &
 *   DB_HOST=127.0.0.1 DB_PORT=5435 ENV_FILE=.env.production \
 *     node scripts/set-password.js someone@example.com
 *
 * Usage (local database, reads .env):
 *   node scripts/set-password.js someone@example.com
 */
const path = require('path');
const readline = require('readline');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

// Load DB settings; variables already set on the command line take precedence.
require('dotenv').config({ path: path.join(__dirname, '..', process.env.ENV_FILE || '.env') });

const MIN_LENGTH = 12;
const BCRYPT_COST = 12; // matches /auth/register in server.js

function promptHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    let muted = false;
    const write = rl._writeToOutput.bind(rl);
    rl._writeToOutput = (s) => { if (!muted) write(s); };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
    muted = true;
  });
}

async function main() {
  const email = (process.argv[2] || '').trim().toLowerCase();
  if (!email || !email.includes('@')) {
    console.error('Usage: node scripts/set-password.js <email>');
    process.exit(1);
  }
  if (!process.stdin.isTTY) {
    console.error('Run this in an interactive terminal so the password can be typed at a hidden prompt.');
    process.exit(1);
  }

  const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });

  try {
    const { rows } = await pool.query(
      'SELECT id, role FROM seller_accounts WHERE lower(email) = $1',
      [email]
    );
    if (rows.length !== 1) {
      console.error(rows.length ? `More than one account matches ${email}; nothing changed.` : `No account found for ${email}.`);
      process.exitCode = 1;
      return;
    }
    console.log(`Database: ${process.env.DB_NAME} on ${process.env.DB_HOST}:${process.env.DB_PORT || 5432}`);
    console.log(`Account:  ${email} (role: ${rows[0].role})`);

    const pw1 = await promptHidden(`New password (min ${MIN_LENGTH} characters): `);
    if (pw1.length < MIN_LENGTH) {
      console.error(`Too short; nothing changed.`);
      process.exitCode = 1;
      return;
    }
    const pw2 = await promptHidden('Repeat new password: ');
    if (pw1 !== pw2) {
      console.error('Passwords do not match; nothing changed.');
      process.exitCode = 1;
      return;
    }

    const hash = await bcrypt.hash(pw1, BCRYPT_COST);
    const result = await pool.query(
      'UPDATE seller_accounts SET password_hash = $1, updated_at = now() WHERE id = $2',
      [hash, rows[0].id]
    );
    console.log(result.rowCount === 1 ? 'Password updated.' : 'No row updated.');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
