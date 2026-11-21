const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const sanitizeHtml = require('sanitize-html');
const env = require('../config/env');

// Configure Helmet with CSP tailored for DOMINO Landing + Admin CMS + Google Fonts/Maps + Facebook Pixel
const securityHeaders = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'",
        "'unsafe-inline'", // needed for FB Pixel inline bootstrap, Vercel Analytics & landing config
        'https://connect.facebook.net',
        'https://www.facebook.com',
        'https://*.facebook.com',
        'https://*.fbcdn.net',
      ],
      styleSrc: [
        "'self'",
        "'unsafe-inline'",
        'https://fonts.googleapis.com',
        'https://connect.facebook.net',
        'https://*.facebook.com',
        'https://*.fbcdn.net',
      ],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'https://*.fbcdn.net', 'data:'],
      imgSrc: [
        "'self'",
        'data:',
        'blob:',
        'https://www.facebook.com',
        'https://*.facebook.com',
        'https://*.fbcdn.net',
        'https:',
      ],
      frameSrc: [
        "'self'", // allows Admin Live Preview iframe
        'https://www.google.com',
        'https://maps.google.com',
        'https://www.facebook.com',
        'https://*.facebook.com',
      ],
      frameAncestors: ["'self'", 'https://business.facebook.com', 'https://www.facebook.com'],
      scriptSrcAttr: ["'unsafe-inline'"],
      connectSrc: [
        "'self'",
        'https://www.facebook.com',
        'https://*.facebook.com',
        'https://connect.facebook.net',
        'https://graph.facebook.com',
      ],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'", 'https://www.facebook.com', 'https://*.facebook.com'],
    },
  },
  crossOriginEmbedderPolicy: false,
  // Required for Meta Event Setup Tool (window.opener handshake & overlay from business.facebook.com)
  crossOriginOpenerPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  xFrameOptions: false,
  hsts: env.isProd
    ? { maxAge: 31536000, includeSubDomains: true, preload: true }
    : false,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
});

// Rate limiters
const publicLeadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    ok: false,
    code: 'RATE_LIMITED',
    message: 'Bạn thao tác quá nhiều lần. Vui lòng thử lại sau vài phút.',
  },
});

const phoneCheckLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    ok: false,
    code: 'RATE_LIMITED',
    message: 'Quá nhiều yêu cầu kiểm tra số điện thoại. Vui lòng chờ giây lát.',
  },
});

const authLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    ok: false,
    code: 'RATE_LIMITED',
    message: 'Quá nhiều lần đăng nhập thất bại. Vui lòng thử lại sau 15 phút.',
  },
});

const adminApiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    ok: false,
    code: 'RATE_LIMITED',
    message: 'Vượt quá giới hạn truy cập API quản trị.',
  },
});

// CSRF protection for state-changing admin requests using custom header + SameSite=Strict cookie
function csrfProtect(req, res, next) {
  const safeMethods = ['GET', 'HEAD', 'OPTIONS'];
  if (safeMethods.includes(req.method)) return next();

  const xrw = req.get('X-Requested-With');
  const csrfHeader = req.get('X-CSRF-Token');
  const csrfCookie = req.cookies?.domino_csrf;

  if (xrw !== 'XMLHttpRequest' || !csrfHeader || !csrfCookie || csrfHeader !== csrfCookie) {
    return res.status(403).json({
      ok: false,
      code: 'CSRF_INVALID',
      message: 'Phiên làm việc không hợp lệ (CSRF). Vui lòng tải lại trang.',
    });
  }
  return next();
}

// Strict sanitizers for CMS content
function sanitizePlainText(input, maxLen = 2000) {
  return String(input ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim()
    .slice(0, maxLen);
}

function sanitizeRichText(input, maxLen = 8000) {
  const cleaned = sanitizeHtml(String(input ?? '').slice(0, maxLen), {
    allowedTags: ['em', 'strong', 'b', 'i', 'br', 'span', 'a'],
    allowedAttributes: {
      a: ['href', 'target', 'rel', 'style'],
      span: ['class', 'style'],
      em: ['style'],
    },
    allowedSchemes: ['http', 'https', 'tel', 'mailto'],
    allowProtocolRelative: false,
    transformTags: {
      a: (tagName, attribs) => {
        const href = validateSafeUrl(attribs.href || '', true);
        if (!href) return { tagName: 'span', attribs: {} };
        const out = { href };
        if (attribs.target === '_blank') {
          out.target = '_blank';
          out.rel = 'noopener noreferrer';
        }
        return { tagName, attribs: out };
      },
    },
  });
  return cleaned;
}

function validateSafeUrl(url, allowHash = true) {
  const s = String(url ?? '').trim();
  if (!s) return '';
  if (allowHash && s.startsWith('#')) return s;
  if (s.startsWith('/') && !s.startsWith('//')) return s;
  try {
    const parsed = new URL(s);
    if (['http:', 'https:', 'tel:', 'mailto:'].includes(parsed.protocol)) {
      return s;
    }
    return '';
  } catch {
    return '';
  }
}

function validateSafeImageUrl(url) {
  const s = String(url ?? '').trim();
  if (!s) return '';
  if (s.startsWith('/assets/') || s.startsWith('/uploads/')) return s;
  try {
    const parsed = new URL(s);
    if (['http:', 'https:'].includes(parsed.protocol)) {
      return s;
    }
    return '';
  } catch {
    return '';
  }
}

function validateSafeMapUrl(url) {
  const s = String(url ?? '').trim();
  if (!s) return '';
  try {
    const parsed = new URL(s);
    const allowedHosts = ['www.google.com', 'maps.google.com', 'google.com'];
    if (parsed.protocol === 'https:' && allowedHosts.includes(parsed.hostname)) {
      return s;
    }
    return '';
  } catch {
    return '';
  }
}

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (env.trustProxy && typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || req.ip || '';
}

module.exports = {
  securityHeaders,
  publicLeadLimiter,
  phoneCheckLimiter,
  authLoginLimiter,
  adminApiLimiter,
  csrfProtect,
  sanitizePlainText,
  sanitizeRichText,
  validateSafeUrl,
  validateSafeImageUrl,
  validateSafeMapUrl,
  getClientIp,
};

