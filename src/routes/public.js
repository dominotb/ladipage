const express = require('express');
const crypto = require('crypto');
const { getDb } = require('../db/database');
const { isAdminAuthenticated } = require('../middleware/auth');
const {
  publicLeadLimiter,
  phoneCheckLimiter,
  sanitizePlainText,
  getClientIp,
} = require('../middleware/security');
const { validatePhone, getCountriesList } = require('../services/phone');
const { sendFacebookConversionEvent } = require('../services/facebookCapi');
const { renderLandingPage } = require('../services/cmsRenderer');

const router = express.Router();

// GET / -> Render landing page (supports ?cms_preview=1 ONLY for authenticated admin)
router.get('/', (req, res) => {
  const wantsPreview = req.query.cms_preview === '1';
  const previewMode = wantsPreview && isAdminAuthenticated(req);
  const html = renderLandingPage({ previewMode });
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', previewMode ? 'no-store' : 'public, max-age=30');
  res.send(html);
});

// GET /api/phone-countries -> Supported country dial codes
router.get('/api/phone-countries', (_req, res) => {
  res.json({ ok: true, countries: getCountriesList() });
});

// POST /api/leads/check-phone -> Validate international format/length + check duplicate in DB
router.post('/api/leads/check-phone', phoneCheckLimiter, (req, res) => {
  const { phone, countryIso } = req.body || {};
  const check = validatePhone(phone, countryIso || 'VN');
  if (!check.ok) {
    return res.status(400).json({
      ok: false,
      valid: false,
      duplicate: false,
      code: check.code,
      message: check.message,
    });
  }

  const existing = getDb()
    .prepare('SELECT id, created_at FROM leads WHERE phone_e164 = ?')
    .get(check.e164);

  if (existing) {
    return res.json({
      ok: true,
      valid: true,
      duplicate: true,
      e164: check.e164,
      national: check.national,
      message:
        'Số điện thoại này đã đăng ký tư vấn trước đó. Đội ngũ DOMINO đã ghi nhận và sẽ liên hệ sớm, hoặc bạn có thể nhắn tin trực tiếp!',
    });
  }

  return res.json({
    ok: true,
    valid: true,
    duplicate: false,
    e164: check.e164,
    national: check.national,
    international: check.international,
    countryIso: check.countryIso,
    dialCode: check.dialCode,
    message: 'Số điện thoại hợp lệ.',
  });
});

// POST /api/leads -> Submit consultation lead form
router.post('/api/leads', publicLeadLimiter, async (req, res) => {
  const body = req.body || {};

  // Anti-spam honeypot check
  if (body.website_url && String(body.website_url).trim().length > 0) {
    return res.status(400).json({
      ok: false,
      code: 'SPAM_DETECTED',
      message: 'Yêu cầu không hợp lệ.',
    });
  }

  const name = sanitizePlainText(body.name, 120);
  if (name.length < 2) {
    return res.status(400).json({
      ok: false,
      field: 'name',
      code: 'INVALID_NAME',
      message: 'Vui lòng nhập họ và tên đầy đủ (tối thiểu 2 ký tự).',
    });
  }

  const phoneCheck = validatePhone(body.phone, body.countryIso || 'VN');
  if (!phoneCheck.ok) {
    return res.status(400).json({
      ok: false,
      field: 'phone',
      code: phoneCheck.code,
      message: phoneCheck.message,
    });
  }

  const db = getDb();
  const duplicate = db
    .prepare('SELECT id, created_at FROM leads WHERE phone_e164 = ?')
    .get(phoneCheck.e164);

  if (duplicate) {
    return res.status(409).json({
      ok: false,
      field: 'phone',
      code: 'DUPLICATE_PHONE',
      message:
        'Số điện thoại này đã được đăng ký tư vấn trước đó. Để được hỗ trợ ngay, bạn vui lòng gọi Hotline 0967 862 545 hoặc nhắn tin Messenger/Zalo.',
    });
  }

  const stage = sanitizePlainText(body.stage, 100);
  const area = sanitizePlainText(body.area, 150);
  const need = sanitizePlainText(body.need, 1000);

  // Attribution & Facebook tracking parameters
  const utmSource = sanitizePlainText(body.utm_source, 120);
  const utmMedium = sanitizePlainText(body.utm_medium, 120);
  const utmCampaign = sanitizePlainText(body.utm_campaign, 160);
  const utmContent = sanitizePlainText(body.utm_content, 160);
  const utmTerm = sanitizePlainText(body.utm_term, 160);
  const fbclid = sanitizePlainText(body.fbclid, 250);
  const fbp = sanitizePlainText(body.fbp || req.cookies?._fbp, 250);
  const fbc = sanitizePlainText(body.fbc || req.cookies?._fbc, 250);
  const landingUrl = sanitizePlainText(body.landing_url, 500);
  const referrer = sanitizePlainText(body.referrer, 500);
  const eventId = sanitizePlainText(body.event_id, 80) || crypto.randomUUID();
  const ipAddress = getClientIp(req);
  const userAgent = sanitizePlainText(req.get('user-agent'), 500);

  let leadId;
  try {
    const result = db
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
        name,
        sanitizePlainText(body.phone, 40),
        phoneCheck.countryIso,
        phoneCheck.dialCode,
        phoneCheck.e164,
        phoneCheck.national,
        stage,
        area,
        need,
        utmSource,
        utmMedium,
        utmCampaign,
        utmContent,
        utmTerm,
        fbclid,
        fbp,
        fbc,
        eventId,
        landingUrl,
        referrer,
        ipAddress,
        userAgent
      );
    leadId = Number(result.lastInsertRowid);
  } catch (err) {
    if (String(err.message || '').includes('UNIQUE')) {
      return res.status(409).json({
        ok: false,
        field: 'phone',
        code: 'DUPLICATE_PHONE',
        message: 'Số điện thoại này đã được đăng ký tư vấn trước đó.',
      });
    }
    console.error('[Lead Insert Error]', err);
    return res.status(500).json({
      ok: false,
      code: 'SERVER_ERROR',
      message: 'Có lỗi hệ thống khi lưu thông tin. Vui lòng thử lại hoặc liên hệ trực tiếp.',
    });
  }

  // Send server-side Facebook Conversions API (CAPI) Lead event (deduplicated via eventId)
  const capiResult = await sendFacebookConversionEvent({
    leadId,
    eventName: 'Lead',
    eventId,
    source: 'form_submit',
    name,
    phoneE164: phoneCheck.e164,
    area,
    countryIso: phoneCheck.countryIso,
    stage,
    fbclid,
    fbp,
    fbc,
    utmSource,
    utmCampaign,
    eventSourceUrl: landingUrl,
    ipAddress,
    userAgent,
  });

  db.prepare(
    'UPDATE leads SET fb_capi_status = ?, fb_capi_response = ?, updated_at = datetime(\'now\') WHERE id = ?'
  ).run(capiResult.capiStatus, String(capiResult.capiResponse || '').slice(0, 1000), leadId);

  return res.status(201).json({
    ok: true,
    leadId,
    eventId,
    phoneFormatted: phoneCheck.international,
    message:
      'Đăng ký tư vấn thành công! Đội ngũ DOMINO đã nhận được thông tin và sẽ liên hệ với bạn trong thời gian sớm nhất.',
  });
});

// POST /api/track -> Track custom client events (Contact click: Call/Zalo/Messenger, ViewContent)
router.post('/api/track', phoneCheckLimiter, async (req, res) => {
  const body = req.body || {};
  const allowedEvents = ['Contact', 'ViewContent', 'PageView'];
  const eventName = allowedEvents.includes(body.event_name) ? body.event_name : 'Contact';
  const eventId = sanitizePlainText(body.event_id, 80) || crypto.randomUUID();

  await sendFacebookConversionEvent({
    eventName,
    eventId,
    source: 'client_action',
    contentName: sanitizePlainText(body.label || eventName, 120),
    fbclid: sanitizePlainText(body.fbclid, 250),
    fbp: sanitizePlainText(body.fbp || req.cookies?._fbp, 250),
    fbc: sanitizePlainText(body.fbc || req.cookies?._fbc, 250),
    utmSource: sanitizePlainText(body.utm_source, 120),
    utmCampaign: sanitizePlainText(body.utm_campaign, 160),
    eventSourceUrl: sanitizePlainText(body.landing_url, 500),
    ipAddress: getClientIp(req),
    userAgent: sanitizePlainText(req.get('user-agent'), 500),
  });

  res.json({ ok: true, eventId });
});

module.exports = router;

