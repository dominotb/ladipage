const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const DATA_DIR = path.resolve(__dirname, '../../data');
fs.mkdirSync(DATA_DIR, { recursive: true });

// If JWT_SECRET is not provided in .env, persist a generated secret in data/.secrets.json
// so sessions survive restarts while never using a weak hardcoded default.
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
    fs.writeFileSync(secretFile, JSON.stringify(persisted, null, 2), { mode: 0o600 });
  }
  return persisted;
}

const fallbackSecrets = loadOrGenerateSecrets();

const env = {
  port: Number(process.env.PORT || 3000),
  nodeEnv: process.env.NODE_ENV || 'development',
  isProd: process.env.NODE_ENV === 'production',
  appUrl: process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`,
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
  trustProxy: process.env.TRUST_PROXY === '1' || process.env.TRUST_PROXY === 'true',
  dataDir: DATA_DIR,
  dbPath: path.join(DATA_DIR, 'domino.sqlite'),
};

module.exports = env;

