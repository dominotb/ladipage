const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');
const env = require('../config/env');

let db;

function getDb() {
  if (db) return db;
  db = new DatabaseSync(env.dbPath);

  // Security & performance pragmas
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA synchronous = NORMAL;');
  db.exec('PRAGMA busy_timeout = 5000;');

  initSchema(db);
  seedDefaults(db);
  return db;
}

function initSchema(conn) {
  conn.exec(`
    CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'superadmin',
      failed_attempts INTEGER NOT NULL DEFAULT 0,
      locked_until TEXT,
      last_login_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone_raw TEXT NOT NULL,
      country_iso TEXT NOT NULL DEFAULT 'VN',
      dial_code TEXT NOT NULL DEFAULT '+84',
      phone_e164 TEXT NOT NULL UNIQUE,
      phone_national TEXT NOT NULL,
      stage TEXT DEFAULT '',
      area TEXT DEFAULT '',
      need TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'new',
      notes TEXT DEFAULT '',
      utm_source TEXT DEFAULT '',
      utm_medium TEXT DEFAULT '',
      utm_campaign TEXT DEFAULT '',
      utm_content TEXT DEFAULT '',
      utm_term TEXT DEFAULT '',
      fbclid TEXT DEFAULT '',
      fbp TEXT DEFAULT '',
      fbc TEXT DEFAULT '',
      fb_event_id TEXT DEFAULT '',
      fb_capi_status TEXT DEFAULT 'skipped',
      fb_capi_response TEXT DEFAULT '',
      landing_url TEXT DEFAULT '',
      referrer TEXT DEFAULT '',
      ip_address TEXT DEFAULT '',
      user_agent TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
    CREATE INDEX IF NOT EXISTS idx_leads_utm_source ON leads(utm_source);

    CREATE TABLE IF NOT EXISTS conversion_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id INTEGER REFERENCES leads(id) ON DELETE SET NULL,
      event_name TEXT NOT NULL,
      event_id TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'server',
      fbclid TEXT DEFAULT '',
      fbp TEXT DEFAULT '',
      fbc TEXT DEFAULT '',
      utm_source TEXT DEFAULT '',
      utm_campaign TEXT DEFAULT '',
      event_source_url TEXT DEFAULT '',
      value REAL DEFAULT 0,
      currency TEXT DEFAULT 'VND',
      capi_status TEXT NOT NULL DEFAULT 'skipped',
      capi_http_code INTEGER DEFAULT 0,
      capi_response TEXT DEFAULT '',
      ip_address TEXT DEFAULT '',
      user_agent TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_conv_created_at ON conversion_events(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_conv_event_name ON conversion_events(event_name);

    CREATE TABLE IF NOT EXISTS site_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS cms_overrides (
      cms_key TEXT PRIMARY KEY,
      cms_type TEXT NOT NULL DEFAULT 'text',
      value_json TEXT NOT NULL,
      updated_by TEXT DEFAULT 'admin',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS cms_revisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      snapshot_json TEXT NOT NULL,
      note TEXT DEFAULT '',
      created_by TEXT DEFAULT 'admin',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS media_assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL UNIQUE,
      original_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      url TEXT NOT NULL,
      uploaded_by TEXT DEFAULT 'admin',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      target TEXT DEFAULT '',
      detail TEXT DEFAULT '',
      ip_address TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_audit_created_at ON audit_logs(created_at DESC);
  `);
}

function seedDefaults(conn) {
  // Seed default admin if none exists
  const adminCount = conn.prepare('SELECT COUNT(*) AS cnt FROM admins').get().cnt;
  if (adminCount === 0) {
    const hash = bcrypt.hashSync(env.adminPassword, 12);
    conn
      .prepare('INSERT INTO admins (username, password_hash, role) VALUES (?, ?, ?)')
      .run(env.adminUsername, hash, 'superadmin');
  }

  // Seed default settings
  const defaultSettings = {
    fb_pixel_id: '',
    fb_capi_token: '',
    fb_test_event_code: '',
    fb_pixel_enabled: '0',
    fb_capi_enabled: '0',
    fb_lead_value: '0',
    fb_currency: 'VND',
    site_title: 'DOMINO - Tủ bếp INOX cánh kính tại Thái Bình',
    site_description:
      'DOMINO Thái Bình - Tủ bếp INOX cánh kính thiết kế, sản xuất tại xưởng riêng và thi công trọn gói từ năm 2015. Tư vấn vật liệu, cấu tạo và giải pháp bếp bền đẹp theo thời gian.',
    og_image: '',
  };

  const insertSetting = conn.prepare(
    'INSERT OR IGNORE INTO site_settings (key, value) VALUES (?, ?)'
  );
  for (const [k, v] of Object.entries(defaultSettings)) {
    insertSetting.run(k, v);
  }
}

function getAllSettings() {
  const rows = getDb().prepare('SELECT key, value FROM site_settings').all();
  const obj = {};
  for (const row of rows) {
    obj[row.key] = row.value;
  }
  return obj;
}

function setSettings(pairs) {
  const conn = getDb();
  const stmt = conn.prepare(
    `INSERT INTO site_settings (key, value, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
  );
  conn.exec('BEGIN');
  try {
    for (const [k, v] of Object.entries(pairs)) {
      stmt.run(k, String(v ?? ''));
    }
    conn.exec('COMMIT');
  } catch (err) {
    conn.exec('ROLLBACK');
    throw err;
  }
}

function logAudit(actor, action, target = '', detail = '', ipAddress = '') {
  try {
    getDb()
      .prepare(
        'INSERT INTO audit_logs (actor, action, target, detail, ip_address) VALUES (?, ?, ?, ?, ?)'
      )
      .run(actor, action, target, String(detail).slice(0, 1000), ipAddress);
  } catch {
    // non-fatal
  }
}

module.exports = {
  getDb,
  getAllSettings,
  setSettings,
  logAudit,
};

