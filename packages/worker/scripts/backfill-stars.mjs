/**
 * One-time backfill: push existing OmniDrive-only stars to Google Drive.
 *
 * Problem: Before commit "feat: sync starred state bidirectionally with Google Drive",
 * starring in OmniDrive was D1-only (no Google API call). After deploy, the first
 * sync would fetch `starred: false` from Google and UPSERT overwrites D1's
 * `is_starred=1` → `0`, silently deleting the user's star.
 *
 * This script pushes existing D1 stars to Google so the first sync's overwrite
 * is a no-op (1→1, not 1→0).
 *
 * Usage:
 *   # Local D1
 *   node scripts/backfill-stars.mjs --local
 *
 *   # Remote (production) D1
 *   node scripts/backfill-stars.mjs --remote
 *
 * Required env vars (read from .dev.vars or environment):
 *   TOKEN_ENCRYPTION_KEY  — used to decrypt stored OAuth tokens
 *   GOOGLE_CLIENT_ID      — Google OAuth client ID
 *   GOOGLE_CLIENT_SECRET  — Google OAuth client secret
 *
 * Run this BEFORE deploying the starred-sync commit. After it completes,
 * Google's starred state matches D1, so the first post-deploy sync is a no-op.
 */

import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// ─── Config ───

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const IV_LENGTH = 12;
const ALGORITHM = 'AES-GCM';

// ─── Env loading (from .dev.vars or process.env) ───

function loadEnvVars() {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const devVarsPath = join(scriptDir, '..', '.dev.vars');

  let devVars = {};
  try {
    const content = readFileSync(devVarsPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed
        .slice(eqIdx + 1)
        .trim()
        .replace(/^["']|["']$/g, '');
      devVars[key] = value;
    }
  } catch {
    // .dev.vars doesn't exist — fall through to process.env
  }

  const env = {
    TOKEN_ENCRYPTION_KEY: process.env.TOKEN_ENCRYPTION_KEY ?? devVars.TOKEN_ENCRYPTION_KEY,
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID ?? devVars.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET ?? devVars.GOOGLE_CLIENT_SECRET,
  };

  if (!env.TOKEN_ENCRYPTION_KEY) {
    console.error('❌ TOKEN_ENCRYPTION_KEY not found. Set it in .dev.vars or environment.');
    process.exit(1);
  }
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    console.error('❌ GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not found.');
    process.exit(1);
  }

  return env;
}

// ─── Crypto (matches worker's lib/crypto.ts exactly) ───

async function getKey(secret) {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HKDF' },
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: enc.encode('omnidrive-token-v1'),
      info: new Uint8Array(0),
    },
    baseKey,
    { name: ALGORITHM, length: 256 },
    false,
    ['decrypt'],
  );
}

async function decrypt(encoded, secret) {
  const key = await getKey(secret);
  // Strip version prefix if present (v1:), otherwise treat as legacy base64
  const raw = encoded.includes(':') ? encoded.split(':').slice(1).join(':') : encoded;
  const combined = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));

  const iv = combined.slice(0, IV_LENGTH);
  const ciphertext = combined.slice(IV_LENGTH);

  const plaintext = await crypto.subtle.decrypt({ name: ALGORITHM, iv }, key, ciphertext);
  return new TextDecoder().decode(plaintext);
}

// ─── D1 queries via wrangler ───

function queryD1(flag, sql) {
  const cmd = `npx wrangler d1 execute omnidrive ${flag} --json --command="${sql.replace(/"/g, '\\"')}"`;
  const output = execSync(cmd, { encoding: 'utf-8' });
  // wrangler --json returns an array of result objects; take the first
  try {
    const parsed = JSON.parse(output);
    if (Array.isArray(parsed) && parsed.length > 0 && Array.isArray(parsed[0].results)) {
      return parsed[0].results;
    }
    return [];
  } catch {
    return [];
  }
}

// ─── Token refresh (OAuth + service account) ───

async function refreshAccessToken(env, refreshToken) {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Token refresh failed (${response.status}): ${text}`);
  }

  const data = await response.json();
  return data.access_token;
}

// ─── Service account token (matches worker's lib/google-service-account.ts) ───

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';

function base64UrlEncode(bytes) {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pemToPkcs8(pem) {
  const b64 = pem
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s/g, '');
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function importPrivateKey(pem) {
  return crypto.subtle.importKey(
    'pkcs8',
    pemToPkcs8(pem),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

async function createSignedJwt(clientEmail, privateKey) {
  const header = base64UrlEncode(
    new TextEncoder().encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })),
  );
  const now = Math.floor(Date.now() / 1000);
  const payload = base64UrlEncode(
    new TextEncoder().encode(
      JSON.stringify({
        iss: clientEmail,
        scope: DRIVE_SCOPE,
        aud: TOKEN_URL,
        iat: now,
        exp: now + 3600,
      }),
    ),
  );

  const signingInput = `${header}.${payload}`;
  const key = await importPrivateKey(privateKey);
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(signingInput),
  );

  return `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`;
}

async function fetchServiceAccountAccessToken(credentials) {
  const assertion = await createSignedJwt(credentials.clientEmail, credentials.privateKey);
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });

  if (!response.ok) {
    throw new Error(`Service account auth failed (${response.status}): ${await response.text()}`);
  }

  const data = await response.json();
  return data.access_token;
}

// ─── Star file/folder via Google API ───

async function starFile(accessToken, fileId) {
  const response = await fetch(`${DRIVE_API}/files/${fileId}?supportsAllDrives=true`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ starred: true }),
  });

  if (!response.ok && response.status !== 404) {
    const text = await response.text();
    throw new Error(`Star failed for ${fileId} (${response.status}): ${text}`);
  }
  // 404 = file already deleted — skip (no-op)
}

// ─── Main ───

async function main() {
  const isRemote = process.argv.includes('--remote');
  const flag = isRemote ? '--remote' : '--local';

  console.log(`\n⭐ Backfill: pushing D1 stars to Google Drive (${flag})\n`);

  const env = loadEnvVars();
  console.log('✅ Env vars loaded\n');

  // 1. Query starred files
  console.log('📋 Querying starred files...');
  const starredFiles = queryD1(
    flag,
    `SELECT f.google_file_id, f.drive_account_id, dt.encrypted_tokens
     FROM files f
     JOIN drive_tokens dt ON f.drive_account_id = dt.drive_account_id
     WHERE f.is_starred = 1 AND f.is_trashed = 0`,
  );
  console.log(`   Found ${starredFiles.length} starred files\n`);

  // 2. Query starred folders
  console.log('📋 Querying starred folders...');
  const starredFolders = queryD1(
    flag,
    `SELECT df.google_folder_id, df.drive_account_id, dt.encrypted_tokens
     FROM drive_folders df
     JOIN drive_tokens dt ON df.drive_account_id = dt.drive_account_id
     WHERE df.is_starred = 1 AND df.is_trashed = 0`,
  );
  console.log(`   Found ${starredFolders.length} starred folders\n`);

  if (starredFiles.length === 0 && starredFolders.length === 0) {
    console.log('✅ No stars to backfill. D1 and Google are already in sync.');
    return;
  }

  // 3. Group by drive_account_id to minimize token decryption + refresh calls
  const byDrive = new Map();
  for (const row of [...starredFiles, ...starredFolders]) {
    const driveId = row.drive_account_id;
    if (!byDrive.has(driveId)) {
      byDrive.set(driveId, { encrypted_tokens: row.encrypted_tokens, items: [] });
    }
    byDrive.get(driveId).items.push(row);
  }

  console.log(`📊 Processing ${byDrive.size} drive(s)...\n`);

  // 4. For each drive: decrypt tokens, refresh access token, star each item
  let successCount = 0;
  let errorCount = 0;

  for (const [driveId, { encrypted_tokens, items }] of byDrive) {
    console.log(`\n📁 Drive ${driveId} (${items.length} items):`);

    // Decrypt tokens
    let accessToken;
    try {
      const tokensJson = await decrypt(encrypted_tokens, env.TOKEN_ENCRYPTION_KEY);
      const tokens = JSON.parse(tokensJson);
      console.log(`   🔓 Tokens decrypted`);

      // Get a valid access token — 3 flows (matching worker's getValidToken):
      //   1. Service account: fetch via JWT assertion (SA tokens expire in ~1h)
      //   2. OAuth with refresh_token: refresh via token endpoint
      //   3. OAuth with valid access token: use as-is (rare — tokens usually expired)
      if (tokens.authType === 'service_account' && tokens.serviceAccount) {
        accessToken = await fetchServiceAccountAccessToken(tokens.serviceAccount);
        console.log(`   🔄 Service account token fetched`);
      } else if (tokens.refreshToken) {
        accessToken = await refreshAccessToken(env, tokens.refreshToken);
        console.log(`   🔄 Access token refreshed`);
      } else if (tokens.accessToken && tokens.expiresAt > Date.now()) {
        accessToken = tokens.accessToken;
        console.log(`   ✅ Access token still valid`);
      } else {
        console.log(
          `   ❌ No usable token (no refresh_token, access token expired) — skipping drive`,
        );
        errorCount += items.length;
        continue;
      }
    } catch (e) {
      console.log(`   ❌ Token decryption/refresh failed: ${e.message}`);
      errorCount += items.length;
      continue;
    }

    // Star each item
    for (const item of items) {
      const id = item.google_folder_id ?? item.google_file_id;
      const type = item.google_folder_id ? 'folder' : 'file';
      try {
        await starFile(accessToken, id);
        console.log(`   ⭐ ${type} ${id}`);
        successCount++;
      } catch (e) {
        console.log(`   ❌ ${type} ${id}: ${e.message}`);
        errorCount++;
      }
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`✅ Backfill complete: ${successCount} starred, ${errorCount} errors`);
  console.log(`${'='.repeat(60)}\n`);

  if (errorCount > 0) {
    console.log('⚠️  Some items failed. Check errors above — they may be:');
    console.log('   - Files already deleted in Google (404 — safe to ignore)');
    console.log('   - Permission issues (re-connect the drive)');
    console.log('   - Token expiry (re-run the script)\n');
  }

  console.log('🚀 You can now deploy the starred-sync commit safely.');
  console.log('   The first post-deploy sync will be a no-op (1→1, not 1→0).\n');
}

main().catch((err) => {
  console.error('\n❌ Backfill failed:', err.message);
  process.exit(1);
});
