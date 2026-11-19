const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const env = require('../config/env');

const COOKIE_NAME = 'domino_admin_token';
const CSRF_COOKIE_NAME = 'domino_csrf';

function issueAuthCookies(res, admin) {
  const token = jwt.sign(
    { sub: admin.id, username: admin.username, role: admin.role },
    env.jwtSecret,
    { expiresIn: '12h' }
  );
  const csrfToken = crypto.randomBytes(24).toString('hex');

  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: env.isProd,
    sameSite: 'strict',
    maxAge: 12 * 60 * 60 * 1000,
    path: '/',
  });

  // Readable by same-origin admin JS to send in X-CSRF-Token header
  res.cookie(CSRF_COOKIE_NAME, csrfToken, {
    httpOnly: false,
    secure: env.isProd,
    sameSite: 'strict',
    maxAge: 12 * 60 * 60 * 1000,
    path: '/',
  });

  return csrfToken;
}

function clearAuthCookies(res) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
  res.clearCookie(CSRF_COOKIE_NAME, { path: '/' });
}

function requireAdmin(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) {
    return res.status(401).json({
      ok: false,
      code: 'UNAUTHORIZED',
      message: 'Vui lòng đăng nhập quản trị.',
    });
  }
  try {
    const payload = jwt.verify(token, env.jwtSecret);
    req.admin = {
      id: payload.sub,
      username: payload.username,
      role: payload.role,
    };
    return next();
  } catch {
    clearAuthCookies(res);
    return res.status(401).json({
      ok: false,
      code: 'TOKEN_EXPIRED',
      message: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.',
    });
  }
}

function isAdminAuthenticated(req) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return false;
  try {
    jwt.verify(token, env.jwtSecret);
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  COOKIE_NAME,
  CSRF_COOKIE_NAME,
  issueAuthCookies,
  clearAuthCookies,
  requireAdmin,
  isAdminAuthenticated,
};

