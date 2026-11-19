const express = require('express');
const fs = require('fs');
const path = require('path');
const { getDb, getAllSettings, setSettings, logAudit } = require('../db/database');
const { requireAdmin } = require('../middleware/auth');
const {
  adminApiLimiter,
  csrfProtect,
  sanitizePlainText,
  sanitizeRichText,
  validateSafeUrl,
  validateSafeImageUrl,
  validateSafeMapUrl,
  getClientIp,
} = require('../middleware/security');
const { getAllCmsOverrides } = require('../services/cmsRenderer');
const { sendFacebookConversionEvent } = require('../services/facebookCapi');
const { uploadMiddleware, saveVerifiedImage, UPLOADS_DIR } = require('../services/upload');
const env = require('../config/env');

const router = express.Router();

// All admin endpoints require valid JWT cookie + rate limit + CSRF check for mutations
router.use(requireAdmin, adminApiLimiter, csrfProtect);

const ALLOWED_LEAD_STATUSES = ['new', 'contacted', 'surveyed', 'won', 'lost'];

// CSV formula injection defense
function csvCell(val) {
  let s = String(val ?? '').replace(/\r?\n/g, ' ');
  if (/^[=+\-@\t\r]/.test(s)) {
    s = "'" + s;
  }
  return `"${s.replace(/"/g, '""')}"`;
}

// ---------- OVERVIEW ----------
router.get('/overview', (_req, res) => {
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
  const overridesCount = db.prepare('SELECT COUNT(*) AS cnt FROM cms_overrides').get().cnt;

  res.json({
    ok: true,
    stats: {
      totalLeads,
      todayLeads,
      fbLeads,
      capiSent,
      capiTotal,
      overridesCount,
    },
    byStatus,
    bySource,
    recentLeads,
  });
});

// ---------- LEADS MANAGEMENT ----------
router.get('/leads', (req, res) => {
  const db = getDb();
  const search = sanitizePlainText(req.query.q, 100);
  const status = sanitizePlainText(req.query.status, 30);
  const source = sanitizePlainText(req.query.source, 60);
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(10, Number(req.query.limit) || 25));
  const offset = (page - 1) * limit;

  const where = [];
  const params = [];

  if (search) {
    where.push('(name LIKE ? OR phone_e164 LIKE ? OR phone_raw LIKE ? OR area LIKE ? OR need LIKE ?)');
    const like = `%${search}%`;
    params.push(like, like, like, like, like);
  }
  if (status && ALLOWED_LEAD_STATUSES.includes(status)) {
    where.push('status = ?');
    params.push(status);
  }
  if (source === 'facebook') {
    where.push("(fbclid != '' OR lower(utm_source) LIKE '%fb%' OR lower(utm_source) LIKE '%facebook%')");
  } else if (source === 'direct') {
    where.push("(fbclid = '' AND utm_source = '')");
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = db.prepare(`SELECT COUNT(*) AS cnt FROM leads ${whereSql}`).get(...params).cnt;
  const rows = db
    .prepare(`SELECT * FROM leads ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset);

  res.json({
    ok: true,
    total,
    page,
    limit,
    leads: rows,
  });
});

router.patch('/leads/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ ok: false, message: 'ID không hợp lệ.' });
  }

  const db = getDb();
  const existing = db.prepare('SELECT id, status, notes FROM leads WHERE id = ?').get(id);
  if (!existing) {
    return res.status(404).json({ ok: false, message: 'Không tìm thấy khách hàng.' });
  }

  const status = req.body?.status
    ? ALLOWED_LEAD_STATUSES.includes(req.body.status)
      ? req.body.status
      : existing.status
    : existing.status;
  const notes =
    req.body?.notes !== undefined ? sanitizePlainText(req.body.notes, 2000) : existing.notes;

  db.prepare(
    "UPDATE leads SET status = ?, notes = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(status, notes, id);

  logAudit(req.admin.username, 'LEAD_UPDATE', `lead:${id}`, `status=${status}`, getClientIp(req));
  res.json({ ok: true, id, status, notes });
});

router.delete('/leads/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ ok: false, message: 'ID không hợp lệ.' });
  }
  const db = getDb();
  const existing = db.prepare('SELECT id, name, phone_e164 FROM leads WHERE id = ?').get(id);
  if (!existing) {
    return res.status(404).json({ ok: false, message: 'Không tìm thấy khách hàng.' });
  }
  db.prepare('DELETE FROM leads WHERE id = ?').run(id);
  logAudit(
    req.admin.username,
    'LEAD_DELETE',
    `lead:${id}`,
    `${existing.name} (${existing.phone_e164})`,
    getClientIp(req)
  );
  res.json({ ok: true });
});

router.post('/leads/:id/resend-capi', async (req, res) => {
  const id = Number(req.params.id);
  const eventName = ['Lead', 'Schedule', 'Purchase', 'Contact'].includes(req.body?.eventName)
    ? req.body.eventName
    : 'Lead';
  const value = Number(req.body?.value || 0) || 0;

  const db = getDb();
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
  if (!lead) {
    return res.status(404).json({ ok: false, message: 'Không tìm thấy khách hàng.' });
  }

  const result = await sendFacebookConversionEvent({
    leadId: lead.id,
    eventName,
    source: 'admin_manual',
    forceSend: true,
    name: lead.name,
    phoneE164: lead.phone_e164,
    area: lead.area,
    countryIso: lead.country_iso,
    stage: lead.stage,
    fbclid: lead.fbclid,
    fbp: lead.fbp,
    fbc: lead.fbc,
    utmSource: lead.utm_source,
    utmCampaign: lead.utm_campaign,
    eventSourceUrl: lead.landing_url,
    ipAddress: lead.ip_address,
    userAgent: lead.user_agent,
    value,
  });

  db.prepare(
    "UPDATE leads SET fb_capi_status = ?, fb_capi_response = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(result.capiStatus, String(result.capiResponse || '').slice(0, 1000), lead.id);

  logAudit(
    req.admin.username,
    'FB_CAPI_MANUAL_SEND',
    `lead:${id}`,
    `event=${eventName}, status=${result.capiStatus}`,
    getClientIp(req)
  );

  res.json({ ok: true, result });
});

router.get('/leads/export.csv', (req, res) => {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM leads ORDER BY id DESC').all();
  const headers = [
    'ID',
    'Họ tên',
    'Mã vùng',
    'SĐT chuẩn E.164',
    'SĐT hiển thị',
    'Giai đoạn',
    'Khu vực',
    'Nhu cầu',
    'Trạng thái',
    'Ghi chú',
    'UTM Source',
    'UTM Campaign',
    'FBCLID',
    'FB CAPI Status',
    'Thời gian tạo',
  ];

  const lines = [headers.map(csvCell).join(',')];
  for (const r of rows) {
    lines.push(
      [
        r.id,
        r.name,
        `${r.country_iso} (${r.dial_code})`,
        r.phone_e164,
        r.phone_national,
        r.stage,
        r.area,
        r.need,
        r.status,
        r.notes,
        r.utm_source,
        r.utm_campaign,
        r.fbclid,
        r.fb_capi_status,
        r.created_at,
      ]
        .map(csvCell)
        .join(',')
    );
  }

  logAudit(req.admin.username, 'LEADS_EXPORT_CSV', 'leads', `rows=${rows.length}`, getClientIp(req));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="domino-leads-${new Date().toISOString().slice(0, 10)}.csv"`
  );
  // UTF-8 BOM so Microsoft Excel opens Vietnamese diacritics cleanly
  res.send('\uFEFF' + lines.join('\r\n'));
});

// ---------- FACEBOOK TRACKING (PIXEL + CAPI) ----------
router.get('/facebook', (_req, res) => {
  const settings = getAllSettings();
  const events = getDb()
    .prepare('SELECT * FROM conversion_events ORDER BY id DESC LIMIT 100')
    .all();

  res.json({
    ok: true,
    config: {
      fb_pixel_id: settings.fb_pixel_id || '',
      fb_capi_token: settings.fb_capi_token || '',
      fb_test_event_code: settings.fb_test_event_code || '',
      fb_pixel_enabled: settings.fb_pixel_enabled === '1',
      fb_capi_enabled: settings.fb_capi_enabled === '1',
      fb_lead_value: settings.fb_lead_value || '0',
      fb_currency: settings.fb_currency || 'VND',
    },
    events,
  });
});

router.put('/facebook', (req, res) => {
  const body = req.body || {};
  const pixelId = sanitizePlainText(body.fb_pixel_id, 40).replace(/[^0-9]/g, '');
  const capiToken = sanitizePlainText(body.fb_capi_token, 500);
  const testCode = sanitizePlainText(body.fb_test_event_code, 80);
  const currency = sanitizePlainText(body.fb_currency || 'VND', 10).toUpperCase();
  const leadValue = String(Math.max(0, Number(body.fb_lead_value) || 0));

  setSettings({
    fb_pixel_id: pixelId,
    fb_capi_token: capiToken,
    fb_test_event_code: testCode,
    fb_pixel_enabled: body.fb_pixel_enabled ? '1' : '0',
    fb_capi_enabled: body.fb_capi_enabled ? '1' : '0',
    fb_lead_value: leadValue,
    fb_currency: currency,
  });

  logAudit(
    req.admin.username,
    'FB_SETTINGS_UPDATE',
    'facebook',
    `pixel=${pixelId}, pixelOn=${!!body.fb_pixel_enabled}, capiOn=${!!body.fb_capi_enabled}`,
    getClientIp(req)
  );
  res.json({ ok: true, message: 'Đã lưu cấu hình Facebook Pixel & Conversions API.' });
});

router.post('/facebook/test', async (req, res) => {
  const testEventCode = sanitizePlainText(req.body?.test_event_code, 80);
  const result = await sendFacebookConversionEvent({
    eventName: 'Lead',
    source: 'admin_test',
    forceSend: true,
    testEventCode: testEventCode || undefined,
    name: 'DOMINO Test Event',
    phoneE164: '+84967862545',
    area: 'Thái Bình',
    countryIso: 'VN',
    eventSourceUrl: env.appUrl,
    ipAddress: getClientIp(req),
    userAgent: req.get('user-agent') || '',
  });

  logAudit(
    req.admin.username,
    'FB_CAPI_TEST',
    'facebook',
    `status=${result.capiStatus}, http=${result.httpCode}`,
    getClientIp(req)
  );
  res.json({ ok: true, result });
});

// ---------- CMS LIVE PREVIEW & CONTENT MANAGEMENT ----------
router.get('/cms', (_req, res) => {
  const overrides = getAllCmsOverrides();
  const settings = getAllSettings();
  const revisions = getDb()
    .prepare('SELECT id, note, created_by, created_at FROM cms_revisions ORDER BY id DESC LIMIT 20')
    .all();

  res.json({
    ok: true,
    overrides,
    seo: {
      site_title: settings.site_title || '',
      site_description: settings.site_description || '',
      og_image: settings.og_image || '',
    },
    revisions,
  });
});

router.put('/cms', (req, res) => {
  const db = getDb();
  const changes = req.body?.changes || {};
  const seo = req.body?.seo || null;
  const note = sanitizePlainText(req.body?.note || 'Cập nhật từ Live Preview', 200);

  if (typeof changes !== 'object' || Array.isArray(changes)) {
    return res.status(400).json({ ok: false, message: 'Dữ liệu CMS không hợp lệ.' });
  }

  // Save current state as a revision before modifying
  const currentSnapshot = getAllCmsOverrides();
  if (Object.keys(changes).length > 0) {
    db.prepare(
      'INSERT INTO cms_revisions (snapshot_json, note, created_by) VALUES (?, ?, ?)'
    ).run(JSON.stringify(currentSnapshot), note, req.admin.username);
  }

  const upsert = db.prepare(
    `INSERT INTO cms_overrides (cms_key, cms_type, value_json, updated_by, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(cms_key) DO UPDATE SET
       cms_type = excluded.cms_type,
       value_json = excluded.value_json,
       updated_by = excluded.updated_by,
       updated_at = datetime('now')`
  );

  const savedKeys = [];
  db.exec('BEGIN');
  try {
    for (const [rawKey, entry] of Object.entries(changes)) {
      const key = sanitizePlainText(rawKey, 80);
      if (!/^[a-zA-Z0-9_-]+$/.test(key) || !entry || typeof entry !== 'object') continue;

      const type = ['html', 'text', 'image', 'link', 'iframe'].includes(entry.type)
        ? entry.type
        : 'html';

      let cleanVal = {};
      if (type === 'html' || type === 'text') {
        cleanVal = {
          html: sanitizeRichText(entry.value?.html ?? entry.value?.text ?? ''),
        };
      } else if (type === 'image') {
        const src = validateSafeImageUrl(entry.value?.src);
        if (!src) continue;
        cleanVal = {
          src,
          alt: sanitizePlainText(entry.value?.alt, 300),
          caption: sanitizePlainText(entry.value?.caption, 300),
        };
      } else if (type === 'link') {
        const href = validateSafeUrl(entry.value?.href, true);
        if (!href) continue;
        cleanVal = {
          href,
          html: sanitizeRichText(entry.value?.html ?? entry.value?.text ?? ''),
          target: entry.value?.target === '_blank' ? '_blank' : '_self',
        };
      } else if (type === 'iframe') {
        const src = validateSafeMapUrl(entry.value?.src);
        if (!src) continue;
        cleanVal = { src };
      }

      upsert.run(key, type, JSON.stringify(cleanVal), req.admin.username);
      savedKeys.push(key);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    console.error('[CMS Save Error]', err);
    return res.status(500).json({ ok: false, message: 'Lỗi lưu nội dung CMS.' });
  }

  if (seo && typeof seo === 'object') {
    setSettings({
      site_title: sanitizePlainText(seo.site_title, 200),
      site_description: sanitizePlainText(seo.site_description, 500),
      og_image: validateSafeImageUrl(seo.og_image),
    });
  }

  logAudit(
    req.admin.username,
    'CMS_PUBLISH',
    'cms',
    `keys=${savedKeys.length} (${savedKeys.slice(0, 8).join(',')})`,
    getClientIp(req)
  );

  res.json({
    ok: true,
    savedCount: savedKeys.length,
    overrides: getAllCmsOverrides(),
    message: `Đã lưu & xuất bản ${savedKeys.length} thay đổi lên trang chính!`,
  });
});

router.delete('/cms/:key', (req, res) => {
  const key = sanitizePlainText(req.params.key, 80);
  getDb().prepare('DELETE FROM cms_overrides WHERE cms_key = ?').run(key);
  logAudit(req.admin.username, 'CMS_RESET_KEY', key, '', getClientIp(req));
  res.json({ ok: true, overrides: getAllCmsOverrides() });
});

router.post('/cms/reset-all', (req, res) => {
  const db = getDb();
  const snapshot = getAllCmsOverrides();
  db.prepare('INSERT INTO cms_revisions (snapshot_json, note, created_by) VALUES (?, ?, ?)').run(
    JSON.stringify(snapshot),
    'Backup trước khi khôi phục mặc định',
    req.admin.username
  );
  db.prepare('DELETE FROM cms_overrides').run();
  logAudit(req.admin.username, 'CMS_RESET_ALL', 'cms', '', getClientIp(req));
  res.json({ ok: true, message: 'Đã khôi phục toàn bộ giao diện về mặc định ban đầu.' });
});

router.post('/cms/restore/:revisionId', (req, res) => {
  const revId = Number(req.params.revisionId);
  const db = getDb();
  const rev = db.prepare('SELECT * FROM cms_revisions WHERE id = ?').get(revId);
  if (!rev) {
    return res.status(404).json({ ok: false, message: 'Không tìm thấy bản lưu.' });
  }
  const snapshot = JSON.parse(rev.snapshot_json || '{}');
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM cms_overrides').run();
    const ins = db.prepare(
      'INSERT INTO cms_overrides (cms_key, cms_type, value_json, updated_by) VALUES (?, ?, ?, ?)'
    );
    for (const [k, item] of Object.entries(snapshot)) {
      ins.run(k, item.type || 'html', JSON.stringify(item.value || {}), req.admin.username);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    return res.status(500).json({ ok: false, message: 'Lỗi khôi phục phiên bản.' });
  }
  logAudit(req.admin.username, 'CMS_RESTORE', `revision:${revId}`, '', getClientIp(req));
  res.json({ ok: true, overrides: getAllCmsOverrides(), message: 'Đã khôi phục phiên bản!' });
});

// ---------- MEDIA LIBRARY ----------
router.get('/media', (_req, res) => {
  const uploaded = getDb()
    .prepare('SELECT * FROM media_assets ORDER BY id DESC LIMIT 100')
    .all();

  // Also list built-in seed images from public/assets/images/manifest.json
  const manifestPath = path.resolve(__dirname, '../../public/assets/images/manifest.json');
  let seedAssets = [];
  if (fs.existsSync(manifestPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      const seen = new Set();
      seedAssets = raw.filter((item) => {
        if (seen.has(item.url)) return false;
        seen.add(item.url);
        return true;
      });
    } catch {
      seedAssets = [];
    }
  }

  res.json({ ok: true, uploaded, seedAssets });
});

router.post('/media/upload', (req, res) => {
  uploadMiddleware.single('file')(req, res, (err) => {
    if (err) {
      return res.status(400).json({
        ok: false,
        message: err.message || 'Lỗi tải ảnh lên (tối đa 5MB, chỉ JPG/PNG/WebP/GIF).',
      });
    }
    if (!req.file) {
      return res.status(400).json({ ok: false, message: 'Vui lòng chọn file ảnh.' });
    }
    try {
      const saved = saveVerifiedImage(req.file);
      const result = getDb()
        .prepare(
          'INSERT INTO media_assets (filename, original_name, mime_type, size_bytes, url, uploaded_by) VALUES (?, ?, ?, ?, ?, ?)'
        )
        .run(
          saved.filename,
          saved.originalName,
          saved.mimeType,
          saved.sizeBytes,
          saved.url,
          req.admin.username
        );

      logAudit(req.admin.username, 'MEDIA_UPLOAD', saved.filename, saved.url, getClientIp(req));
      return res.status(201).json({
        ok: true,
        asset: { id: Number(result.lastInsertRowid), ...saved },
      });
    } catch (e) {
      return res.status(400).json({ ok: false, message: e.message });
    }
  });
});

router.delete('/media/:id', (req, res) => {
  const id = Number(req.params.id);
  const db = getDb();
  const asset = db.prepare('SELECT * FROM media_assets WHERE id = ?').get(id);
  if (!asset) {
    return res.status(404).json({ ok: false, message: 'Không tìm thấy ảnh.' });
  }
  const filePath = path.join(UPLOADS_DIR, path.basename(asset.filename));
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
  db.prepare('DELETE FROM media_assets WHERE id = ?').run(id);
  logAudit(req.admin.username, 'MEDIA_DELETE', asset.filename, '', getClientIp(req));
  res.json({ ok: true });
});

// ---------- SECURITY AUDIT LOGS & DB BACKUP ----------
router.get('/audit-logs', (_req, res) => {
  const logs = getDb()
    .prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 100')
    .all();
  res.json({ ok: true, logs });
});

router.get('/backup/db', (req, res) => {
  logAudit(req.admin.username, 'DB_BACKUP_DOWNLOAD', 'database', '', getClientIp(req));
  res.download(env.dbPath, `domino-backup-${new Date().toISOString().slice(0, 10)}.sqlite`);
});

module.exports = router;

