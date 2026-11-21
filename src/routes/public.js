const express = require('express');
const crypto = require('crypto');
const store = require('../db/store');
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
const { renderRobotsTxt, renderSitemapXml, renderLlmsTxt } = require('../services/seoBuilder');

const router = express.Router();
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function getRequestOrigin(req) {
  const proto = (req.get('x-forwarded-proto') || req.protocol || 'https').split(',')[0].trim();
  const host = (req.get('x-forwarded-host') || req.get('host') || 'localhost').split(',')[0].trim();
  return `${proto}://${host}`;
}

// SEO / GEO endpoints: robots.txt, sitemap.xml, llms.txt
router.get('/robots.txt', (req, res) => {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=3600');
  res.send(renderRobotsTxt(getRequestOrigin(req)));
});

router.get('/sitemap.xml', (req, res) => {
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=3600');
  res.send(renderSitemapXml(getRequestOrigin(req)));
});

router.get(
  '/llms.txt',
  asyncHandler(async (req, res) => {
    const [settings, overrides] = await Promise.all([
      store.getAllSettings(),
      store.getAllCmsOverrides(),
    ]);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=600');
    res.send(renderLlmsTxt(getRequestOrigin(req), settings, overrides));
  })
);

// GET / -> Render landing page (supports ?cms_preview=1 ONLY for authenticated admin)
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const wantsPreview = req.query.cms_preview === '1';
    const previewMode = wantsPreview && isAdminAuthenticated(req);
    const html = await renderLandingPage({ previewMode, origin: getRequestOrigin(req) });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader(
      'Cache-Control',
      previewMode ? 'no-store' : 'public, max-age=30, s-maxage=60, stale-while-revalidate=300'
    );
    res.send(html);
  })
);

// GET /api/phone-countries -> Supported country dial codes
router.get('/api/phone-countries', (_req, res) => {
  res.json({ ok: true, countries: getCountriesList() });
});

// POST /api/leads/check-phone -> Validate international format/length + check duplicate in DB
router.post(
  '/api/leads/check-phone',
  phoneCheckLimiter,
  asyncHandler(async (req, res) => {
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

    const existing = await store.findLeadByPhoneE164(check.e164);
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
  })
);

// POST /api/leads -> Submit consultation lead form
router.post(
  '/api/leads',
  publicLeadLimiter,
  asyncHandler(async (req, res) => {
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

    const duplicate = await store.findLeadByPhoneE164(phoneCheck.e164);
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
      leadId = await store.createLead({
        name,
        phone_raw: sanitizePlainText(body.phone, 40),
        country_iso: phoneCheck.countryIso,
        dial_code: phoneCheck.dialCode,
        phone_e164: phoneCheck.e164,
        phone_national: phoneCheck.national,
        stage,
        area,
        need,
        status: 'new',
        notes: '',
        utm_source: utmSource,
        utm_medium: utmMedium,
        utm_campaign: utmCampaign,
        utm_content: utmContent,
        utm_term: utmTerm,
        fbclid,
        fbp,
        fbc,
        fb_event_id: eventId,
        landing_url: landingUrl,
        referrer,
        ip_address: ipAddress,
        user_agent: userAgent,
      });
    } catch (err) {
      if (err.code === 'DUPLICATE_PHONE') {
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

    const capiResult = await sendFacebookConversionEvent({
      leadId,
      eventName: 'Lead',
      eventId,
      externalId: sanitizePlainText(body.external_id || req.cookies?.domino_vid, 80) || `lead-${leadId}`,
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

    await store.updateLeadCapiStatus(leadId, capiResult.capiStatus, capiResult.capiResponse);

    return res.status(201).json({
      ok: true,
      leadId,
      eventId,
      phoneFormatted: phoneCheck.international,
      message:
        'Đăng ký tư vấn thành công! Đội ngũ DOMINO đã nhận được thông tin và sẽ liên hệ với bạn trong thời gian sớm nhất.',
    });
  })
);

// POST /api/track -> Strict allowlist for Meta standard events (Contact, ViewContent, FindLocation)
const ALLOWED_TRACK_EVENTS = ['Contact', 'ViewContent', 'FindLocation'];
const VALID_EVENT_ID_RE = /^[a-zA-Z0-9_-]{8,80}$/;

router.post(
  '/api/track',
  phoneCheckLimiter,
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const eventName = typeof body.event_name === 'string' ? body.event_name.trim() : '';
    if (!ALLOWED_TRACK_EVENTS.includes(eventName)) {
      return res.status(400).json({
        ok: false,
        code: 'INVALID_EVENT',
        message: 'Sự kiện không nằm trong danh sách cho phép.',
      });
    }

    const eventId = typeof body.event_id === 'string' ? body.event_id.trim() : '';
    if (!VALID_EVENT_ID_RE.test(eventId)) {
      return res.status(400).json({
        ok: false,
        code: 'INVALID_EVENT_ID',
        message: 'Thiếu hoặc sai định dạng event_id.',
      });
    }

    const result = await sendFacebookConversionEvent({
      eventName,
      eventId,
      externalId: sanitizePlainText(body.external_id || req.cookies?.domino_vid, 80),
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

    res.json({ ok: true, eventId, capiStatus: result.capiStatus });
  })
);

module.exports = router;
