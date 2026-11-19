const fs = require('fs');
const path = require('path');
const store = require('../db/store');
const { getCountriesList } = require('./phone');
const { buildSeoHeadTags } = require('./seoBuilder');

const CANDIDATE_PATHS = [
  path.resolve(__dirname, '../../views/landing.html'),
  path.join(process.cwd(), 'views', 'landing.html'),
];
let cachedTemplate = null;

function getTemplate() {
  if (!cachedTemplate) {
    const found = CANDIDATE_PATHS.find((p) => fs.existsSync(p));
    if (!found) {
      throw new Error(`Landing template not found. Checked: ${CANDIDATE_PATHS.join(', ')}`);
    }
    cachedTemplate = fs.readFileSync(found, 'utf8');
  }
  return cachedTemplate;
}

function escapeHtmlAttr(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function safeJsonForScript(obj) {
  return JSON.stringify(obj)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

let cachedCmsData = null;
let cachedCmsAt = 0;
const CMS_CACHE_TTL_MS = 60 * 1000; // 60s in-memory cache to minimize Supabase queries

function invalidateCmsCache() {
  cachedCmsData = null;
  cachedCmsAt = 0;
}

async function loadCmsData(bypassCache) {
  const now = Date.now();
  if (!bypassCache && cachedCmsData && now - cachedCmsAt < CMS_CACHE_TTL_MS) {
    return cachedCmsData;
  }
  const [settings, overrides] = await Promise.all([
    store.getAllSettings(),
    store.getAllCmsOverrides(),
  ]);
  cachedCmsData = { settings, overrides };
  cachedCmsAt = now;
  return cachedCmsData;
}

async function renderLandingPage({ previewMode = false, origin = '' } = {}) {
  const { settings, overrides } = await loadCmsData(previewMode);

  let html = getTemplate();

  const title = settings.site_title || 'DOMINO - Tủ bếp INOX cánh kính tại Thái Bình';
  const desc =
    settings.site_description ||
    'DOMINO Thái Bình - Tủ bếp INOX cánh kính thiết kế, sản xuất tại xưởng riêng và thi công trọn gói từ năm 2015.';

  html = html.replace(/\{\{SITE_TITLE\}\}/g, escapeHtmlAttr(title));
  html = html.replace(/\{\{SITE_DESCRIPTION\}\}/g, escapeHtmlAttr(desc));

  const headParts = [buildSeoHeadTags({ origin, settings, overrides })];

  const rawPixelId = (settings.fb_pixel_id || '').replace(/[^0-9]/g, '');
  const fbPixelId = rawPixelId || '1116316424615775';
  const pixelExplicitlyDisabled = rawPixelId.length > 0 && settings.fb_pixel_enabled === '0';
  const fbPixelEnabled = !pixelExplicitlyDisabled && fbPixelId.length >= 5 && !previewMode;

  let pixelCode = '';
  if (fbPixelEnabled) {
    const savedBase = String(settings.fb_pixel_base_code || '').trim();
    if (savedBase && savedBase.includes('connect.facebook.net') && /fbq\s*\(/i.test(savedBase)) {
      pixelCode = savedBase;
    } else {
      pixelCode = `<!-- Meta Pixel Code -->
<script>
!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window, document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '${fbPixelId}');
fbq('track', 'PageView');
</script>
<noscript><img height="1" width="1" style="display:none"
src="https://www.facebook.com/tr?id=${fbPixelId}&ev=PageView&noscript=1"
/></noscript>
<!-- End Meta Pixel Code -->`;
    }
  }

  html = html.replace('<!-- CMS_INJECT_HEAD -->', headParts.join('\n'));
  html = html.replace('<!-- CMS_INJECT_PIXEL -->', pixelCode);

  const clientConfig = {
    previewMode,
    fbPixelEnabled,
    fbPixelId: fbPixelEnabled ? fbPixelId : '',
    fbCurrency: settings.fb_currency || 'VND',
    fbLeadValue: Number(settings.fb_lead_value || 0) || 0,
    countries: getCountriesList(),
    cmsOverrides: overrides,
  };

  const bodyParts = [
    `<script>window.__DOMINO_CONFIG__ = ${safeJsonForScript(clientConfig)};</script>`,
  ];
  if (previewMode) {
    bodyParts.push('<script src="/js/cms-bridge.js" defer></script>');
  }

  html = html.replace('<!-- CMS_INJECT_BODY -->', bodyParts.join('\n'));
  return html;
}

module.exports = {
  renderLandingPage,
  invalidateCmsCache,
};
