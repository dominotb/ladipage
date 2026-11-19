const fs = require('fs');
const path = require('path');
const env = require('../config/env');
const { getDb, getAllSettings, setSettings, logAudit } = require('./database');

module.exports = {
  driver: 'sqlite',

  async init() {
    getDb();
  },

  // ---------- ADMINS ----------
  async findAdminByUsername(username) {
    return getDb().prepare('SELECT * FROM admins WHERE username = ?').get(username) || null;
  },

  async findAdminById(id) {
    return getDb().prepare('SELECT * FROM admins WHERE id = ?').get(id) || null;
  },

  async updateAdminLoginFailure(id, failedAttempts, lockedUntil) {
    getDb()
      .prepare(
        "UPDATE admins SET failed_attempts = ?, locked_until = ?, updated_at = datetime('now') WHERE id = ?"
      )
      .run(failedAttempts, lockedUntil, id);
  },

  async updateAdminLoginSuccess(id) {
    getDb()
      .prepare(
        "UPDATE admins SET failed_attempts = 0, locked_until = NULL, last_login_at = datetime('now'), updated_at = datetime('now') WHERE id = ?"
      )
      .run(id);
  },

  async updateAdminPassword(id, passwordHash) {
    getDb()
      .prepare("UPDATE admins SET password_hash = ?, updated_at = datetime('now') WHERE id = ?")
      .run(passwordHash, id);
  },

  // ---------- LEADS ----------
  async findLeadByPhoneE164(phoneE164) {
    return (
      getDb().prepare('SELECT id, created_at FROM leads WHERE phone_e164 = ?').get(phoneE164) ||
      null
    );
  },

  async findLeadById(id) {
    return getDb().prepare('SELECT * FROM leads WHERE id = ?').get(id) || null;
  },

  async createLead(lead) {
    try {
      const result = getDb()
        .prepare(
          `INSERT INTO leads (
            name, phone_raw, country_iso, dial_code, phone_e164, phone_national,
            stage, area, need, status,
            utm_source, utm_medium, utm_campaign, utm_content, utm_term,
            fbclid, fbp, fbc, fb_event_id,
            landing_url, referrer, ip_address, user_agent
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          lead.name,
          lead.phone_raw,
          lead.country_iso,
          lead.dial_code,
          lead.phone_e164,
          lead.phone_national,
          lead.stage,
          lead.area,
          lead.need,
          lead.utm_source,
          lead.utm_medium,
          lead.utm_campaign,
          lead.utm_content,
          lead.utm_term,
          lead.fbclid,
          lead.fbp,
          lead.fbc,
          lead.fb_event_id,
          lead.landing_url,
          lead.referrer,
          lead.ip_address,
          lead.user_agent
        );
      return Number(result.lastInsertRowid);
    } catch (err) {
      if (String(err.message || '').includes('UNIQUE')) {
        const dup = new Error('DUPLICATE_PHONE');
        dup.code = 'DUPLICATE_PHONE';
        throw dup;
      }
      throw err;
    }
  },

  async updateLeadCapiStatus(id, status, responseText) {
    getDb()
      .prepare(
        "UPDATE leads SET fb_capi_status = ?, fb_capi_response = ?, updated_at = datetime('now') WHERE id = ?"
      )
      .run(status, String(responseText || '').slice(0, 1000), id);
  },

  async updateLead(id, { status, notes }) {
    getDb()
      .prepare("UPDATE leads SET status = ?, notes = ?, updated_at = datetime('now') WHERE id = ?")
      .run(status, notes, id);
  },

  async deleteLead(id) {
    getDb().prepare('DELETE FROM leads WHERE id = ?').run(id);
  },

  async listLeads({ search = '', status = '', source = '', page = 1, limit = 25 }) {
    const db = getDb();
    const where = [];
    const params = [];

    if (search) {
      where.push(
        '(name LIKE ? OR phone_e164 LIKE ? OR phone_raw LIKE ? OR area LIKE ? OR need LIKE ?)'
      );
      const like = `%${search}%`;
      params.push(like, like, like, like, like);
    }
    if (status) {
      where.push('status = ?');
      params.push(status);
    }
    if (source === 'facebook') {
      where.push(
        "(fbclid != '' OR lower(utm_source) LIKE '%fb%' OR lower(utm_source) LIKE '%facebook%')"
      );
    } else if (source === 'direct') {
      where.push("(fbclid = '' AND utm_source = '')");
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const offset = (page - 1) * limit;
    const total = db.prepare(`SELECT COUNT(*) AS cnt FROM leads ${whereSql}`).get(...params).cnt;
    const leads = db
      .prepare(`SELECT * FROM leads ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset);
    return { total, leads };
  },

  async getAllLeadsForExport() {
    return getDb().prepare('SELECT * FROM leads ORDER BY id DESC').all();
  },

  async getOverview() {
    const db = getDb();
    const totalLeads = db.prepare('SELECT COUNT(*) AS cnt FROM leads').get().cnt;
    const todayLeads = db
      .prepare("SELECT COUNT(*) AS cnt FROM leads WHERE date(created_at) = date('now')")
      .get().cnt;
    const fbLeads = db
      .prepare(
        "SELECT COUNT(*) AS cnt FROM leads WHERE fbclid != '' OR lower(utm_source) LIKE '%fb%' OR lower(utm_source) LIKE '%facebook%'"
      )
      .get().cnt;
    const capiSent = db
      .prepare("SELECT COUNT(*) AS cnt FROM conversion_events WHERE capi_status = 'sent'")
      .get().cnt;
    const capiTotal = db.prepare('SELECT COUNT(*) AS cnt FROM conversion_events').get().cnt;
    const overridesCount = db.prepare('SELECT COUNT(*) AS cnt FROM cms_overrides').get().cnt;

    const byStatus = db
      .prepare('SELECT status, COUNT(*) AS cnt FROM leads GROUP BY status')
      .all();
    const bySource = db
      .prepare(
        `SELECT CASE
           WHEN utm_source != '' THEN utm_source
           WHEN fbclid != '' THEN 'facebook (fbclid)'
           ELSE 'direct / organic'
         END AS source, COUNT(*) AS cnt
         FROM leads GROUP BY source ORDER BY cnt DESC LIMIT 8`
      )
      .all();
    const recentLeads = db
      .prepare(
        'SELECT id, name, phone_e164, phone_national, country_iso, stage, area, status, utm_source, fb_capi_status, created_at FROM leads ORDER BY id DESC LIMIT 8'
      )
      .all();

    return {
      stats: { totalLeads, todayLeads, fbLeads, capiSent, capiTotal, overridesCount },
      byStatus,
      bySource,
      recentLeads,
    };
  },

  // ---------- CONVERSION EVENTS ----------
  async createConversionEvent(ev) {
    try {
      getDb()
        .prepare(
          `INSERT INTO conversion_events (
            lead_id, event_name, event_id, source, fbclid, fbp, fbc,
            utm_source, utm_campaign, event_source_url, value, currency,
            capi_status, capi_http_code, capi_response, ip_address, user_agent
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          ev.lead_id ?? null,
          ev.event_name,
          ev.event_id,
          ev.source,
          ev.fbclid,
          ev.fbp,
          ev.fbc,
          ev.utm_source,
          ev.utm_campaign,
          ev.event_source_url,
          ev.value,
          ev.currency,
          ev.capi_status,
          ev.capi_http_code,
          ev.capi_response,
          ev.ip_address,
          ev.user_agent
        );
    } catch {
      // non-fatal
    }
  },

  async listConversionEvents(limit = 100) {
    return getDb()
      .prepare('SELECT * FROM conversion_events ORDER BY id DESC LIMIT ?')
      .all(limit);
  },

  // ---------- SETTINGS ----------
  async getAllSettings() {
    return getAllSettings();
  },

  async setSettings(pairs) {
    setSettings(pairs);
  },

  // ---------- CMS OVERRIDES & REVISIONS ----------
  async getAllCmsOverrides() {
    const rows = getDb()
      .prepare('SELECT cms_key, cms_type, value_json, updated_at FROM cms_overrides')
      .all();
    const map = {};
    for (const row of rows) {
      try {
        map[row.cms_key] = {
          type: row.cms_type,
          value: JSON.parse(row.value_json),
          updatedAt: row.updated_at,
        };
      } catch {
        // skip
      }
    }
    return map;
  },

  async saveCmsOverrides(entries, updatedBy) {
    if (!entries.length) return;
    const db = getDb();
    const upsert = db.prepare(
      `INSERT INTO cms_overrides (cms_key, cms_type, value_json, updated_by, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(cms_key) DO UPDATE SET
         cms_type = excluded.cms_type,
         value_json = excluded.value_json,
         updated_by = excluded.updated_by,
         updated_at = datetime('now')`
    );
    db.exec('BEGIN');
    try {
      for (const e of entries) {
        upsert.run(e.key, e.type, JSON.stringify(e.value), updatedBy);
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  },

  async deleteCmsOverride(key) {
    getDb().prepare('DELETE FROM cms_overrides WHERE cms_key = ?').run(key);
  },

  async clearAllCmsOverrides() {
    getDb().prepare('DELETE FROM cms_overrides').run();
  },

  async createCmsRevision(snapshotObj, note, createdBy) {
    getDb()
      .prepare('INSERT INTO cms_revisions (snapshot_json, note, created_by) VALUES (?, ?, ?)')
      .run(JSON.stringify(snapshotObj), note, createdBy);
  },

  async listCmsRevisions(limit = 20) {
    return getDb()
      .prepare('SELECT id, note, created_by, created_at FROM cms_revisions ORDER BY id DESC LIMIT ?')
      .all(limit);
  },

  async getCmsRevisionById(id) {
    return getDb().prepare('SELECT * FROM cms_revisions WHERE id = ?').get(id) || null;
  },

  // ---------- MEDIA LIBRARY & LOCAL STORAGE ----------
  async uploadImageToStorage(filename, buffer) {
    const fullPath = path.join(env.uploadsDir, filename);
    fs.writeFileSync(fullPath, buffer);
    return `/uploads/${filename}`;
  },

  async deleteImageFromStorage(filename) {
    const filePath = path.join(env.uploadsDir, path.basename(filename));
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  },

  async createMediaAsset(asset) {
    const result = getDb()
      .prepare(
        'INSERT INTO media_assets (filename, original_name, mime_type, size_bytes, url, uploaded_by) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(
        asset.filename,
        asset.original_name,
        asset.mime_type,
        asset.size_bytes,
        asset.url,
        asset.uploaded_by
      );
    return { id: Number(result.lastInsertRowid), ...asset };
  },

  async listMediaAssets(limit = 100) {
    return getDb()
      .prepare('SELECT * FROM media_assets ORDER BY id DESC LIMIT ?')
      .all(limit);
  },

  async findMediaAssetById(id) {
    return getDb().prepare('SELECT * FROM media_assets WHERE id = ?').get(id) || null;
  },

  async deleteMediaAsset(id) {
    getDb().prepare('DELETE FROM media_assets WHERE id = ?').run(id);
  },

  // ---------- AUDIT LOGS & BACKUP ----------
  async logAudit(actor, action, target = '', detail = '', ipAddress = '') {
    logAudit(actor, action, target, detail, ipAddress);
  },

  async listAuditLogs(limit = 100) {
    return getDb()
      .prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT ?')
      .all(limit);
  },

  async exportFullBackupJson() {
    const db = getDb();
    return {
      exportedAt: new Date().toISOString(),
      driver: 'sqlite',
      leads: db.prepare('SELECT * FROM leads ORDER BY id DESC').all(),
      site_settings: db.prepare('SELECT * FROM site_settings').all(),
      cms_overrides: db.prepare('SELECT * FROM cms_overrides').all(),
      conversion_events: db
        .prepare('SELECT * FROM conversion_events ORDER BY id DESC LIMIT 2000')
        .all(),
      media_assets: db.prepare('SELECT * FROM media_assets ORDER BY id DESC').all(),
    };
  },
};

