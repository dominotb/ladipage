const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const isVercel = Boolean(process.env.VERCEL);

// On Vercel, /var/task is read-only; only os.tmpdir() (/tmp) is writable for fallback files.
const DATA_DIR = isVercel
  ? path.join(os.tmpdir(), 'domino-data')
  : path.resolve(__dirname, '../../data');

const UPLOADS_DIR = isVercel
  ? path.join(os.tmpdir(), 'domino-uploads')
  : path.resolve(__dirname, '../../public/uploads');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

function loadOrGenerateSecrets() {
  const secretFile = path.join(DATA_DIR, '.secrets.json');
  let persisted = {};
  if (fs.existsSync(secretFile)) {
    try {
      persisted = JSON.parse(fs.readFileSync(secretFile, 'utf8'));
    } catch {
      persisted = {};
    }
  }
  let changed = false;
  if (!persisted.jwtSecret) {
    persisted.jwtSecret = crypto.randomBytes(48).toString('hex');
    changed = true;
  }
  if (!persisted.cookieSecret) {
    persisted.cookieSecret = crypto.randomBytes(48).toString('hex');
    changed = true;
  }
  if (changed) {
    try {
      fs.writeFileSync(secretFile, JSON.stringify(persisted, null, 2), { mode: 0o600 });
    } catch {
      // non-fatal
    }
  }
  return persisted;
}

const fallbackSecrets = loadOrGenerateSecrets();

const supabaseUrl = (process.env.SUPABASE_URL || '').trim();
const supabaseServiceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const useSupabase = Boolean(
  supabaseUrl &&
    supabaseServiceRoleKey &&
    !supabaseUrl.includes('your-project-id') &&
    !supabaseServiceRoleKey.includes('your-supabase')
);

const env = {
  port: Number(process.env.PORT || 3000),
  nodeEnv: process.env.NODE_ENV || (isVercel ? 'production' : 'development'),
  isVercel,
  isProd: process.env.NODE_ENV === 'production' || isVercel,
  supabaseUrl,
  supabaseServiceRoleKey,
  supabaseBucket: (process.env.SUPABASE_STORAGE_BUCKET || 'domino-media').trim(),
  useSupabase,
  metaPixelId: (process.env.META_PIXEL_ID || '').replace(/[^0-9]/g, ''),
  metaCapiToken: (process.env.META_CAPI_TOKEN || '').trim(),
  metaTestEventCode: (process.env.META_TEST_EVENT_CODE || '').trim(),
  jwtSecret:
    process.env.JWT_SECRET && !process.env.JWT_SECRET.startsWith('change-this')
      ? process.env.JWT_SECRET
      : fallbackSecrets.jwtSecret,
  cookieSecret:
    process.env.COOKIE_SECRET && !process.env.COOKIE_SECRET.startsWith('change-this')
      ? process.env.COOKIE_SECRET
      : fallbackSecrets.cookieSecret,
  adminUsername: process.env.ADMIN_USERNAME || 'admin',
  adminPassword: process.env.ADMIN_PASSWORD || 'Domino@2026!Secure',
  // Vercel always runs behind a reverse proxy; trust proxy must be enabled for express-rate-limit
  trustProxy: process.env.TRUST_PROXY === '1' || process.env.TRUST_PROXY === 'true' || isVercel,
  dataDir: DATA_DIR,
  uploadsDir: UPLOADS_DIR,
  dbPath: path.join(DATA_DIR, 'domino.sqlite'),
};

module.exports = env;
