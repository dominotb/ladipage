const crypto = require('crypto');
const { getDb, getAllSettings } = require('../db/database');

const FB_GRAPH_VERSION = 'v21.0';

function sha256Normalize(value) {
  const s = String(value || '').trim().toLowerCase();
  if (!s) return undefined;
  return crypto.createHash('sha256').update(s).digest('hex');
}

function sha256Phone(e164) {
  // Meta requires digits only including country code, no '+' or spaces
  const digits = String(e164 || '').replace(/\D/g, '');
  if (!digits) return undefined;
  return crypto.createHash('sha256').update(digits).digest('hex');
}

/**
 * Sends a server-side conversion event to Meta Conversions API (CAPI)
 * and logs it into `conversion_events`.
 */
async function sendFacebookConversionEvent(params) {
  const settings = getAllSettings();
  const pixelId = (settings.fb_pixel_id || '').trim();
  const accessToken = (settings.fb_capi_token || '').trim();
  const capiEnabled = settings.fb_capi_enabled === '1';
  const testEventCode = (params.testEventCode ?? settings.fb_test_event_code ?? '').trim();

  const eventId = params.eventId || crypto.randomUUID();
  const eventName = params.eventName || 'Lead';
  const currency = params.currency || settings.fb_currency || 'VND';
  const value = Number(params.value ?? settings.fb_lead_value ?? 0) || 0;

  let capiStatus = 'disabled';
  let httpCode = 0;
  let capiResponseText = '';

  const shouldSend = (capiEnabled || params.forceSend) && pixelId && accessToken;

  if (shouldSend) {
    const userData = {};
    if (params.phoneE164) userData.ph = [sha256Phone(params.phoneE164)];
    if (params.name) {
      const parts = String(params.name).trim().split(/\s+/);
      if (parts.length > 0) userData.fn = [sha256Normalize(parts[parts.length - 1])];
      if (parts.length > 1) userData.ln = [sha256Normalize(parts[0])];
    }
    if (params.area) userData.ct = [sha256Normalize(params.area)];
    if (params.countryIso) userData.country = [sha256Normalize(params.countryIso)];
    if (params.ipAddress) userData.client_ip_address = params.ipAddress;
    if (params.userAgent) userData.client_user_agent = params.userAgent;
    if (params.fbp) userData.fbp = params.fbp;
    if (params.fbc) {
      userData.fbc = params.fbc;
    } else if (params.fbclid) {
      userData.fbc = `fb.1.${Date.now()}.${params.fbclid}`;
    }

    const payload = {
      data: [
        {
          event_name: eventName,
          event_time: Math.floor(Date.now() / 1000),
          event_id: eventId,
          action_source: 'website',
          event_source_url: params.eventSourceUrl || undefined,
          user_data: userData,
          custom_data: {
            currency,
            value,
            content_name: params.contentName || 'DOMINO Tủ bếp INOX cánh kính',
            content_category: params.stage || 'Tu van tu bep',
            utm_source: params.utmSource || undefined,
            utm_campaign: params.utmCampaign || undefined,
          },
        },
      ],
    };

    if (testEventCode) {
      payload.test_event_code = testEventCode;
    }

    const url = `https://graph.facebook.com/${FB_GRAPH_VERSION}/${encodeURIComponent(pixelId)}/events?access_token=${encodeURIComponent(accessToken)}`;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      httpCode = res.status;
      capiResponseText = await res.text();
      capiStatus = res.ok ? 'sent' : 'failed';
    } catch (err) {
      capiStatus = 'failed';
      capiResponseText = JSON.stringify({ error: err.message || 'Network error' });
    }
  } else if (!pixelId || !accessToken) {
    capiStatus = 'unconfigured';
    capiResponseText = 'Chưa cấu hình Pixel ID hoặc CAPI Access Token';
  }

  // Persist event log
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
        params.leadId ?? null,
        eventName,
        eventId,
        params.source || 'server',
        params.fbclid || '',
        params.fbp || '',
        params.fbc || '',
        params.utmSource || '',
        params.utmCampaign || '',
        params.eventSourceUrl || '',
        value,
        currency,
        capiStatus,
        httpCode,
        capiResponseText.slice(0, 2000),
        params.ipAddress || '',
        (params.userAgent || '').slice(0, 500)
      );
  } catch {
    // non-fatal
  }

  return {
    eventId,
    capiStatus,
    httpCode,
    capiResponse: capiResponseText,
  };
}

module.exports = {
  sendFacebookConversionEvent,
};

