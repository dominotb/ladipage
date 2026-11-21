const crypto = require('crypto');
const store = require('../db/store');
const env = require('../config/env');

const FB_GRAPH_VERSION = 'v27.0';

function sha256Normalize(value) {
  const s = String(value || '').trim().toLowerCase();
  if (!s) return undefined;
  return crypto.createHash('sha256').update(s).digest('hex');
}

function sha256Phone(e164) {
  const digits = String(e164 || '').replace(/\D/g, '');
  if (!digits) return undefined;
  return crypto.createHash('sha256').update(digits).digest('hex');
}

async function sendFacebookConversionEvent(params) {
  const settings = await store.getAllSettings();
  const pixelId = (settings.fb_pixel_id || env.metaPixelId || '1116316424615775').replace(/[^0-9]/g, '');
  const accessToken = (settings.fb_capi_token || env.metaCapiToken || '').trim();
  const capiEnabled = settings.fb_capi_enabled === '1' || Boolean(env.metaCapiToken);
  const testEventCode = (
    params.testEventCode ??
    (settings.fb_test_event_code || env.metaTestEventCode || '')
  ).trim();

  const eventId = params.eventId || crypto.randomUUID();
  const eventName = params.eventName || 'Lead';
  const currency = params.currency || settings.fb_currency || 'VND';
  const value = Number(params.value ?? settings.fb_lead_value ?? 0) || 0;

  let capiStatus = 'disabled';
  let httpCode = 0;
  let capiResponseText = '';

  const shouldSend = (capiEnabled || params.forceSend) && pixelId && accessToken;

  if (shouldSend) {
    const isCrmEvent =
      params.actionSource === 'system_generated' ||
      params.source === 'admin_manual' ||
      params.source === 'crm_stage';

    const userData = {};
    if (params.externalId) userData.external_id = [sha256Normalize(params.externalId)];
    if (params.phoneE164) userData.ph = [sha256Phone(params.phoneE164)];
    if (params.email) userData.em = [sha256Normalize(params.email)];
    if (params.metaLeadId && /^\d{15,17}$/.test(String(params.metaLeadId))) {
      userData.lead_id = Number(params.metaLeadId);
    }
    if (params.name) {
      const parts = String(params.name).trim().split(/\s+/);
      if (parts.length > 0) userData.fn = [sha256Normalize(parts[parts.length - 1])];
      if (parts.length > 1) userData.ln = [sha256Normalize(parts[0])];
    }
    if (params.area) userData.ct = [sha256Normalize(params.area)];
    if (params.countryIso) userData.country = [sha256Normalize(params.countryIso)];
    if (!isCrmEvent) {
      if (params.ipAddress) userData.client_ip_address = params.ipAddress;
      if (params.userAgent) userData.client_user_agent = params.userAgent;
    }
    if (params.fbp) userData.fbp = params.fbp;
    if (params.fbc) {
      userData.fbc = params.fbc;
    } else if (params.fbclid) {
      userData.fbc = `fb.1.${Date.now()}.${params.fbclid}`;
    }

    const customData = isCrmEvent
      ? {
          event_source: 'crm',
          lead_event_source: 'DOMINO CRM',
          currency,
          value,
          content_name: params.contentName || 'DOMINO Tủ bếp INOX cánh kính',
        }
      : {
          currency,
          value,
          content_name: params.contentName || 'DOMINO Tủ bếp INOX cánh kính',
          content_category: params.stage || 'Tu van tu bep',
          utm_source: params.utmSource || undefined,
          utm_campaign: params.utmCampaign || undefined,
        };

    const eventObj = {
      event_name: eventName,
      event_time: Math.floor(Date.now() / 1000),
      event_id: eventId,
      action_source: isCrmEvent ? 'system_generated' : 'website',
      user_data: userData,
      custom_data: customData,
    };
    if (!isCrmEvent && params.eventSourceUrl) {
      eventObj.event_source_url = params.eventSourceUrl;
    }

    const payload = {
      data: [eventObj],
    };

    if (testEventCode) {
      payload.test_event_code = testEventCode;
    }

    const url = `https://graph.facebook.com/${FB_GRAPH_VERSION}/${encodeURIComponent(pixelId)}/events?access_token=${encodeURIComponent(accessToken)}`;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4500);
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

  await store.createConversionEvent({
    lead_id: params.leadId ?? null,
    event_name: eventName,
    event_id: eventId,
    source: params.source || 'server',
    fbclid: params.fbclid || '',
    fbp: params.fbp || '',
    fbc: params.fbc || '',
    utm_source: params.utmSource || '',
    utm_campaign: params.utmCampaign || '',
    event_source_url: params.eventSourceUrl || '',
    value,
    currency,
    capi_status: capiStatus,
    capi_http_code: httpCode,
    capi_response: capiResponseText.slice(0, 2000),
    ip_address: params.ipAddress || '',
    user_agent: (params.userAgent || '').slice(0, 500),
  });

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
