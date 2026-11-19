const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SOURCE_HTML = path.join(ROOT, 'Landing_Page_Tu_Bep_INOX_v2 (1).html');
const MANIFEST = path.join(ROOT, 'public', 'assets', 'images', 'manifest.json');
const OUT_VIEW = path.join(ROOT, 'views', 'landing.html');

fs.mkdirSync(path.dirname(OUT_VIEW), { recursive: true });

let html = fs.readFileSync(SOURCE_HTML, 'utf8');
const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));

// 1. Replace all embedded base64 images with extracted static URLs
let imgIdx = 0;
html = html.replace(/data:image\/[a-zA-Z0-9+.-]+;base64,[A-Za-z0-9+/=]+/g, () => {
  const item = manifest[imgIdx++];
  return item ? item.url : '';
});

// 2. Replace <title> and meta description placeholders with dynamic tokens
html = html.replace(
  /<title>[\s\S]*?<\/title>/,
  '<title>{{SITE_TITLE}}</title>\n<!-- CMS_INJECT_HEAD -->'
);
html = html.replace(
  /<meta name="description" content="[^"]*"\s*\/>/,
  '<meta name="description" content="{{SITE_DESCRIPTION}}" />'
);
html = html.replace(
  /<meta property="og:title" content="[^"]*"\s*\/>/,
  '<meta property="og:title" content="{{SITE_TITLE}}" />'
);
html = html.replace(
  /<meta property="og:description" content="[^"]*"\s*\/>/,
  '<meta property="og:description" content="{{SITE_DESCRIPTION}}" />'
);

// 3. Add styles for international phone input, duplicate warning, and success notice
const extraCss = `
  /* ========== International Phone Input & Lead Feedback ========== */
  .phone-group{display:flex;gap:8px;align-items:stretch}
  .phone-country{flex:0 0 auto;width:148px;max-width:44%;background:#0d0f12;border:1px solid rgba(255,255,255,.16);border-radius:8px;color:#fff;font-family:var(--sans);font-size:.9rem;padding:10px 8px;min-height:48px;cursor:pointer}
  .phone-group input[type="tel"]{flex:1 1 auto;min-width:0}
  .field .hint{display:block;font-size:.76rem;color:var(--text-light-mute);margin-top:6px;line-height:1.5}
  .field .ok-msg{display:none;font-size:.78rem;color:#8ad8a0;margin-top:6px}
  .field.valid .ok-msg{display:block}
  .field.valid input,.field.valid .phone-country{border-color:#4aa366}
  .field.invalid .phone-country{border-color:#c0564a}
  .hp-field{position:absolute!important;left:-9999px!important;width:1px!important;height:1px!important;overflow:hidden!important;opacity:0!important;pointer-events:none!important}
  .form-notice.success{background:rgba(74,163,102,.14);border-color:rgba(138,216,160,.45)}
  .form-notice.error{background:rgba(192,86,74,.16);border-color:rgba(240,162,148,.45)}
  @media(max-width:480px){
    .phone-group{flex-direction:column}
    .phone-country{width:100%;max-width:100%}
  }
`;
html = html.replace('</style>', extraCss + '</style>');

// 4. Upgrade phone field in leadForm to support country code + international validation + honeypot
const oldPhoneFieldRegex =
  /<div class="field" id="f-phone">[\s\S]*?<\/div>\s*<div class="field">\s*<label for="inp-stage">/;

const newPhoneField = `<div class="field" id="f-phone">
          <label for="inp-phone">Số điện thoại <span class="req">*</span></label>
          <input id="inp-phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="Ví dụ: 09xx xxx xxx hoặc +81..." />
          <span class="err" id="phoneErr">Vui lòng nhập số điện thoại hợp lệ.</span>
        </div>
        <div class="hp-field" aria-hidden="true">
          <label for="inp-website">Website</label>
          <input id="inp-website" name="website_url" type="text" tabindex="-1" autocomplete="off" />
        </div>
        <div class="field">
          <label for="inp-stage">`;

if (!oldPhoneFieldRegex.test(html)) {
  console.error('Could not locate #f-phone block in source HTML!');
  process.exit(1);
}
html = html.replace(oldPhoneFieldRegex, newPhoneField);

// 5. Update form notice block for real backend response
html = html.replace(
  /<div class="form-notice" id="formNotice" role="status">[\s\S]*?<\/div>/,
  `<div class="form-notice" id="formNotice" role="status" aria-live="polite"></div>`
);

// 6. Remove old inline script and inject dynamic script hooks
html = html.replace(
  /<script>[\s\S]*?<\/script>\s*<\/body>/,
  '<!-- CMS_INJECT_BODY -->\n<script src="/js/landing.js" defer></script>\n</body>'
);

// 7. Auto-tag editable elements with stable, deterministic data-cms-key attributes
// Tag images
let imgKey = 0;
html = html.replace(/<img\b(?![^>]*data-cms-key)/g, () => {
  imgKey++;
  return `<img data-cms-key="img-${String(imgKey).padStart(2, '0')}" data-cms-type="image"`;
});

// Tag iframes (Google Maps)
let iframeKey = 0;
html = html.replace(/<iframe\b(?![^>]*data-cms-key)/g, () => {
  iframeKey++;
  return `<iframe data-cms-key="iframe-${String(iframeKey).padStart(2, '0')}" data-cms-type="iframe"`;
});

// Tag links (<a>)
let linkKey = 0;
html = html.replace(/<a\b(?![^>]*data-cms-key)/g, () => {
  linkKey++;
  return `<a data-cms-key="link-${String(linkKey).padStart(2, '0')}" data-cms-type="link"`;
});

// Tag text/rich-text elements
let textKey = 0;
html = html.replace(
  /<(h1|h2|h3|h4|p|blockquote|dt|dd|summary)\b(?![^>]*data-cms-key)(?![^>]*class="[^"]*(?:swipe-hint)[^"]*")/g,
  (match, tag) => {
    textKey++;
    return `<${tag} data-cms-key="txt-${String(textKey).padStart(3, '0')}" data-cms-type="html"`;
  }
);
// Tag tier names, warranty terms, stat values, gallery captions, review authors, contact items
html = html.replace(
  /<(div class="tname"|span class="term"|figcaption|b(?=>[^<]{1,60}<\/b>))/g,
  (match) => {
    if (match.includes('data-cms-key')) return match;
    textKey++;
    const tagPart = match.replace(/^<([a-z]+)/, `<$1 data-cms-key="txt-${String(textKey).padStart(3, '0')}" data-cms-type="html"`);
    return tagPart;
  }
);

fs.writeFileSync(OUT_VIEW, html, 'utf8');
console.log(
  `Generated views/landing.html (${Math.round(html.length / 1024)} KB) — tagged ${imgKey} images, ${linkKey} links, ${textKey} text blocks, ${iframeKey} iframes.`
);
