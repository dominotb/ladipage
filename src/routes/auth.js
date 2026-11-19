const express = require('express');
const bcrypt = require('bcryptjs');
const { getDb, logAudit } = require('../db/database');
const {
  issueAuthCookies,
  clearAuthCookies,
  requireAdmin,
} = require('../middleware/auth');
const {
  authLoginLimiter,
  csrfProtect,
  sanitizePlainText,
  getClientIp,
} = require('../middleware/security');

const router = express.Router();

// POST /api/auth/login
router.post('/login', authLoginLimiter, (req, res) => {
  const username = sanitizePlainText(req.body?.username, 60);
  const password = String(req.body?.password || '');
  const ip = getClientIp(req);

  if (!username || !password) {
    return res.status(400).json({
      ok: false,
      message: 'Vui lòng nhập đầy đủ tên đăng nhập và mật khẩu.',
    });
  }

  const db = getDb();
  const admin = db.prepare('SELECT * FROM admins WHERE username = ?').get(username);

  if (!admin) {
    logAudit(username, 'LOGIN_FAILED', 'auth', 'Unknown username', ip);
    return res.status(401).json({
      ok: false,
      message: 'Tên đăng nhập hoặc mật khẩu không chính xác.',
    });
  }

  // Account lockout protection (5 failed attempts -> 15 min lock)
  if (admin.locked_until && new Date(admin.locked_until) > new Date()) {
    logAudit(username, 'LOGIN_BLOCKED', 'auth', 'Account temporarily locked', ip);
    return res.status(423).json({
      ok: false,
      message: 'Tài khoản tạm khóa 15 phút do nhập sai mật khẩu quá nhiều lần.',
    });
  }

  const match = bcrypt.compareSync(password, admin.password_hash);
  if (!match) {
    const nextAttempts = (admin.failed_attempts || 0) + 1;
    const lockUntil =
      nextAttempts >= 5 ? new Date(Date.now() + 15 * 60 * 1000).toISOString() : null;
    db.prepare(
      'UPDATE admins SET failed_attempts = ?, locked_until = ?, updated_at = datetime(\'now\') WHERE id = ?'
    ).run(nextAttempts, lockUntil, admin.id);
    logAudit(username, 'LOGIN_FAILED', 'auth', `Attempt ${nextAttempts}`, ip);
    return res.status(401).json({
      ok: false,
      message: 'Tên đăng nhập hoặc mật khẩu không chính xác.',
    });
  }

  // Reset failed attempts & issue httpOnly JWT + CSRF cookie
  db.prepare(
    'UPDATE admins SET failed_attempts = 0, locked_until = NULL, last_login_at = datetime(\'now\'), updated_at = datetime(\'now\') WHERE id = ?'
  ).run(admin.id);

  const csrfToken = issueAuthCookies(res, admin);
  logAudit(admin.username, 'LOGIN_SUCCESS', 'auth', 'Admin signed in', ip);

  return res.json({
    ok: true,
    csrfToken,
    user: {
      id: admin.id,
      username: admin.username,
      role: admin.role,
      lastLoginAt: admin.last_login_at,
    },
  });
});

// POST /api/auth/logout
router.post('/logout', requireAdmin, csrfProtect, (req, res) => {
  logAudit(req.admin.username, 'LOGOUT', 'auth', '', getClientIp(req));
  clearAuthCookies(res);
  res.json({ ok: true });
});

// GET /api/auth/me
router.get('/me', requireAdmin, (req, res) => {
  res.json({
    ok: true,
    user: req.admin,
    csrfToken: req.cookies?.domino_csrf || '',
  });
});

// POST /api/auth/change-password
router.post('/change-password', requireAdmin, csrfProtect, (req, res) => {
  const currentPassword = String(req.body?.currentPassword || '');
  const newPassword = String(req.body?.newPassword || '');
  const ip = getClientIp(req);

  if (newPassword.length < 10) {
    return res.status(400).json({
      ok: false,
      message: 'Mật khẩu mới phải có ít nhất 10 ký tự.',
    });
  }
  if (!/[A-Z]/.test(newPassword) || !/[a-z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
    return res.status(400).json({
      ok: false,
      message: 'Mật khẩu mới cần bao gồm chữ hoa, chữ thường và chữ số.',
    });
  }

  const db = getDb();
  const admin = db.prepare('SELECT * FROM admins WHERE id = ?').get(req.admin.id);
  if (!admin || !bcrypt.compareSync(currentPassword, admin.password_hash)) {
    return res.status(400).json({
      ok: false,
      message: 'Mật khẩu hiện tại không chính xác.',
    });
  }

  const newHash = bcrypt.hashSync(newPassword, 12);
  db.prepare(
    'UPDATE admins SET password_hash = ?, updated_at = datetime(\'now\') WHERE id = ?'
  ).run(newHash, admin.id);

  logAudit(req.admin.username, 'CHANGE_PASSWORD', 'auth', 'Password updated', ip);
  res.json({ ok: true, message: 'Đổi mật khẩu thành công.' });
});

module.exports = router;

