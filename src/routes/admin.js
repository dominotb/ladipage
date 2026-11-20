const express = require('express');
const fs = require('fs');
const path = require('path');
const store = require('../db/store');
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
const { sendFacebookConversionEvent } = require('../services/facebookCapi');
const { uploadMiddleware, saveVerifiedImage } = require('../services/upload');
const { invalidateCmsCache } = require('../services/cmsRenderer');

const router = express.Router();
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.use(requireAdmin, adminApiLimiter, csrfProtect);

const ALLOWED_LEAD_STATUSES = ['new', 'contacted', 'surveyed', 'won', 'lost'];

function csvCell(val) {
  let s = String(val ?? '').replace(/\r?\n/g, ' ');
  if (/^[=+\-@\t\r]/.test(s)) {
    s = "'" + s;
  }
  return `"${s.replace(/"/g, '""')}"`;
}

function getRequestOrigin(req) {
  const proto = req.get('x-forwarded-proto') || req.protocol || 'https';
  const host = req.get('x-forwarded-host') || req.get('host') || 'localhost';
  return `${proto}://${host}`;
}

// ---------- OVERVIEW ----------
router.get(
  '/overview',
  asyncHandler(async (_req, res) => {
    const data = await store.getOverview();
    res.json({ ok: true, driver: store.driver, ...data });
  })
);

// ---------- LEADS MANAGEMENT ----------
router.get(
  '/leads',
  asyncHandler(async (req, res) => {
    const search = sanitizePlainText(req.query.q, 100);
    const rawStatus = sanitizePlainText(req.query.status, 30);
    const status = ALLOWED_LEAD_STATUSES.includes(rawStatus) ? rawStatus : '';
    const source = sanitizePlainText(req.query.source, 60);
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(10, Number(req.query.limit) || 25));

    const { total, leads } = await store.listLeads({ search, status, source, page, limit });
    res.json({ ok: true, total, page, limit, leads });
  })
);

router.patch(
  '/leads/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ ok: false, message: 'ID không hợp lệ.' });
    }
    const existing = await store.findLeadById(id);
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

    await store.updateLead(id, { status, notes });

    // Auto-send Meta CRM Conversion Event when lead advances to surveyed/won stage
    const stageToEvent = { surveyed: 'Schedule', won: 'Purchase' };
    if (status !== existing.status && stageToEvent[status]) {
      const capiRes = await sendFacebookConversionEvent({
        leadId: id,
        eventName: stageToEvent[status],
        source: 'crm_stage',
        actionSource: 'system_generated',
        name: existing.name,
        phoneE164: existing.phone_e164,
        area: existing.area,
        countryIso: existing.country_iso,
        fbclid: existing.fbclid,
        fbp: existing.fbp,
        fbc: existing.fbc,
        utmSource: existing.utm_source,
        utmCampaign: existing.utm_campaign,
      });
      await store.updateLeadCapiStatus(id, capiRes.capiStatus, capiRes.capiResponse);
    }

    await store.logAudit(req.admin.username, 'LEAD_UPDATE', `lead:${id}`, `status=${status}`, getClientIp(req));
    res.json({ ok: true, id, status, notes });
  })
);

router.delete(
  '/leads/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ ok: false, message: 'ID không hợp lệ.' });
    }
    const existing = await store.findLeadById(id);
    if (!existing) {
      return res.status(404).json({ ok: false, message: 'Không tìm thấy khách hàng.' });
    }
    await store.deleteLead(id);
    await store.logAudit(
      req.admin.username,
      'LEAD_DELETE',
      `lead:${id}`,
      `${existing.name} (${existing.phone_e164})`,
      getClientIp(req)
    );
    res.json({ ok: true });
  })
);

router.post(
  '/leads/:id/resend-capi',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const eventName = ['Lead', 'Schedule', 'Purchase', 'Contact'].includes(req.body?.eventName)
      ? req.body.eventName
      : 'Lead';
    const value = Number(req.body?.value || 0) || 0;

    const lead = await store.findLeadById(id);
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
      eventSourceUrl: lead.landing_url || getRequestOrigin(req),
      ipAddress: lead.ip_address,
      userAgent: lead.user_agent,
      value,
    });

    await store.updateLeadCapiStatus(lead.id, result.capiStatus, result.capiResponse);
    await store.logAudit(
      req.admin.username,
      'FB_CAPI_MANUAL_SEND',
      `lead:${id}`,
      `event=${eventName}, status=${result.capiStatus}`,
      getClientIp(req)
    );

    res.json({ ok: true, result });
  })
);

router.get(
  '/leads/export.csv',
  asyncHandler(async (req, res) => {
    const rows = await store.getAllLeadsForExport();
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

    await store.logAudit(req.admin.username, 'LEADS_EXPORT_CSV', 'leads', `rows=${rows.length}`, getClientIp(req));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="domino-leads-${new Date().toISOString().slice(0, 10)}.csv"`
    );
    res.send('\uFEFF' + lines.join('\r\n'));
  })
);

// ---------- FACEBOOK TRACKING (PIXEL + CAPI) ----------
router.get(
  '/facebook',
  asyncHandler(async (_req, res) => {
    const [settings, events] = await Promise.all([
      store.getAllSettings(),
      store.listConversionEvents(100),
    ]);

    res.json({
      ok: true,
      config: {
        fb_pixel_id: settings.fb_pixel_id || '1116316424615775',
        fb_pixel_base_code: settings.fb_pixel_base_code || '',
        fb_capi_token: settings.fb_capi_token || '',
        fb_test_event_code: settings.fb_test_event_code || '',
        fb_pixel_enabled: settings.fb_pixel_id ? settings.fb_pixel_enabled === '1' : true,
        fb_capi_enabled: settings.fb_capi_enabled === '1',
        fb_lead_value: settings.fb_lead_value || '0',
        fb_currency: settings.fb_currency || 'VND',
      },
      events,
    });
  })
);

router.put(
  '/facebook',
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const rawBaseCode = String(body.fb_pixel_base_code || '').trim().slice(0, 4000);
    let pixelId = sanitizePlainText(body.fb_pixel_id, 40).replace(/[^0-9]/g, '');

    // Extract Pixel ID from pasted Meta Pixel base code if provided
    if (rawBaseCode) {
      const m = rawBaseCode.match(/fbq\s*\(\s*['"]init['"]\s*,\s*['"](\d{5,30})['"]\s*\)/i);
      if (m && m[1]) {
        pixelId = m[1];
      }
      // Security: ensure pasted snippet is a genuine Meta Pixel script (not arbitrary third-party JS)
      if (!rawBaseCode.includes('connect.facebook.net') || !/fbq\s*\(/i.test(rawBaseCode)) {
        return res.status(400).json({
          ok: false,
          message: 'Mã cơ sở Meta Pixel không hợp lệ (phải là đoạn mã chính thức từ Meta Events Manager).',
        });
      }
    }

    const capiToken = sanitizePlainText(body.fb_capi_token, 500);
    const testCode = sanitizePlainText(body.fb_test_event_code, 80);
    const currency = sanitizePlainText(body.fb_currency || 'VND', 10).toUpperCase();
    const leadValue = String(Math.max(0, Number(body.fb_lead_value) || 0));

    await store.setSettings({
      fb_pixel_id: pixelId,
      fb_pixel_base_code: rawBaseCode,
      fb_capi_token: capiToken,
      fb_test_event_code: testCode,
      fb_pixel_enabled: body.fb_pixel_enabled ? '1' : '0',
      fb_capi_enabled: body.fb_capi_enabled ? '1' : '0',
      fb_lead_value: leadValue,
      fb_currency: currency,
    });
    invalidateCmsCache();

    await store.logAudit(
      req.admin.username,
      'FB_SETTINGS_UPDATE',
      'facebook',
      `pixel=${pixelId}, pixelOn=${!!body.fb_pixel_enabled}, capiOn=${!!body.fb_capi_enabled}`,
      getClientIp(req)
    );
    res.json({ ok: true, message: 'Đã lưu cấu hình Facebook Pixel & Conversions API.' });
  })
);

router.post(
  '/facebook/test',
  asyncHandler(async (req, res) => {
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
      eventSourceUrl: getRequestOrigin(req),
      ipAddress: getClientIp(req),
      userAgent: req.get('user-agent') || '',
    });

    await store.logAudit(
      req.admin.username,
      'FB_CAPI_TEST',
      'facebook',
      `status=${result.capiStatus}, http=${result.httpCode}`,
      getClientIp(req)
    );
    res.json({ ok: true, result });
  })
);

// ---------- CMS LIVE PREVIEW & CONTENT MANAGEMENT ----------
router.get(
  '/cms',
  asyncHandler(async (_req, res) => {
    const [overrides, settings, revisions] = await Promise.all([
      store.getAllCmsOverrides(),
      store.getAllSettings(),
      store.listCmsRevisions(20),
    ]);

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
  })
);

router.put(
  '/cms',
  asyncHandler(async (req, res) => {
    const changes = req.body?.changes || {};
    const seo = req.body?.seo || null;
    const note = sanitizePlainText(req.body?.note || 'Cập nhật từ Live Preview', 200);

    if (typeof changes !== 'object' || Array.isArray(changes)) {
      return res.status(400).json({ ok: false, message: 'Dữ liệu CMS không hợp lệ.' });
    }

    const currentSnapshot = await store.getAllCmsOverrides();
    if (Object.keys(changes).length > 0) {
      await store.createCmsRevision(currentSnapshot, note, req.admin.username);
    }

    const entriesToSave = [];
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

      entriesToSave.push({ key, type, value: cleanVal });
    }

    await store.saveCmsOverrides(entriesToSave, req.admin.username);

    if (seo && typeof seo === 'object') {
      await store.setSettings({
        site_title: sanitizePlainText(seo.site_title, 200),
        site_description: sanitizePlainText(seo.site_description, 500),
        og_image: validateSafeImageUrl(seo.og_image),
      });
    }
    invalidateCmsCache();

    await store.logAudit(
      req.admin.username,
      'CMS_PUBLISH',
      'cms',
      `keys=${entriesToSave.length} (${entriesToSave.map((e) => e.key).slice(0, 8).join(',')})`,
      getClientIp(req)
    );

    const updatedOverrides = await store.getAllCmsOverrides();
    res.json({
      ok: true,
      savedCount: entriesToSave.length,
      overrides: updatedOverrides,
      message: `Đã lưu & xuất bản ${entriesToSave.length} thay đổi lên trang chính!`,
    });
  })
);

router.delete(
  '/cms/:key',
  asyncHandler(async (req, res) => {
    const key = sanitizePlainText(req.params.key, 80);
    await store.deleteCmsOverride(key);
    invalidateCmsCache();
    await store.logAudit(req.admin.username, 'CMS_RESET_KEY', key, '', getClientIp(req));
    res.json({ ok: true, overrides: await store.getAllCmsOverrides() });
  })
);

router.post(
  '/cms/reset-all',
  asyncHandler(async (req, res) => {
    const snapshot = await store.getAllCmsOverrides();
    await store.createCmsRevision(
      snapshot,
      'Backup trước khi khôi phục mặc định',
      req.admin.username
    );
    await store.clearAllCmsOverrides();
    invalidateCmsCache();
    await store.logAudit(req.admin.username, 'CMS_RESET_ALL', 'cms', '', getClientIp(req));
    res.json({ ok: true, message: 'Đã khôi phục toàn bộ giao diện về mặc định ban đầu.' });
  })
);

router.post(
  '/cms/restore/:revisionId',
  asyncHandler(async (req, res) => {
    const revId = Number(req.params.revisionId);
    const rev = await store.getCmsRevisionById(revId);
    if (!rev) {
      return res.status(404).json({ ok: false, message: 'Không tìm thấy bản lưu.' });
    }
    const snapshot = JSON.parse(rev.snapshot_json || '{}');
    await store.clearAllCmsOverrides();
    const entries = Object.entries(snapshot).map(([key, item]) => ({
      key,
      type: item.type || 'html',
      value: item.value || {},
    }));
    await store.saveCmsOverrides(entries, req.admin.username);
    invalidateCmsCache();
    await store.logAudit(req.admin.username, 'CMS_RESTORE', `revision:${revId}`, '', getClientIp(req));
    res.json({
      ok: true,
      overrides: await store.getAllCmsOverrides(),
      message: 'Đã khôi phục phiên bản!',
    });
  })
);

// ---------- MEDIA LIBRARY ----------
router.get(
  '/media',
  asyncHandler(async (_req, res) => {
    const uploaded = await store.listMediaAssets(100);
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
  })
);

router.post('/media/upload', (req, res) => {
  uploadMiddleware.single('file')(req, res, async (err) => {
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
      const saved = await saveVerifiedImage(req.file);
      const asset = await store.createMediaAsset({
        ...saved,
        uploaded_by: req.admin.username,
      });
      await store.logAudit(req.admin.username, 'MEDIA_UPLOAD', saved.filename, saved.url, getClientIp(req));
      return res.status(201).json({ ok: true, asset });
    } catch (e) {
      return res.status(400).json({ ok: false, message: e.message });
    }
  });
});

router.delete(
  '/media/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const asset = await store.findMediaAssetById(id);
    if (!asset) {
      return res.status(404).json({ ok: false, message: 'Không tìm thấy ảnh.' });
    }
    await store.deleteImageFromStorage(asset.filename);
    await store.deleteMediaAsset(id);
    await store.logAudit(req.admin.username, 'MEDIA_DELETE', asset.filename, '', getClientIp(req));
    res.json({ ok: true });
  })
);

// ---------- SECURITY AUDIT LOGS & BACKUP ----------
router.get(
  '/audit-logs',
  asyncHandler(async (_req, res) => {
    const logs = await store.listAuditLogs(100);
    res.json({ ok: true, driver: store.driver, logs });
  })
);

router.get(
  '/backup/db',
  asyncHandler(async (req, res) => {
    await store.logAudit(req.admin.username, 'DB_BACKUP_DOWNLOAD', store.driver, '', getClientIp(req));
    const backup = await store.exportFullBackupJson();
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="domino-backup-${store.driver}-${new Date().toISOString().slice(0, 10)}.json"`
    );
    res.send(JSON.stringify(backup, null, 2));
  })
);

module.exports = router;
