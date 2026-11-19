const express = require('express');
const bcrypt = require('bcryptjs');
const store = require('../db/store');
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
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// POST /api/auth/login
router.post(
  '/login',
  authLoginLimiter,
  asyncHandler(async (req, res) => {
    const username = sanitizePlainText(req.body?.username, 60);
    const password = String(req.body?.password || '');
    const ip = getClientIp(req);

    if (!username || !password) {
      return res.status(400).json({
        ok: false,
        message: 'Vui lòng nhập đầy đủ tên đăng nhập và mật khẩu.',
      });
    }

    const admin = await store.findAdminByUsername(username);
    if (!admin) {
      await store.logAudit(username, 'LOGIN_FAILED', 'auth', 'Unknown username', ip);
      return res.status(401).json({
        ok: false,
        message: 'Tên đăng nhập hoặc mật khẩu không chính xác.',
      });
    }

    if (admin.locked_until && new Date(admin.locked_until) > new Date()) {
      await store.logAudit(username, 'LOGIN_BLOCKED', 'auth', 'Account temporarily locked', ip);
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
      await store.updateAdminLoginFailure(admin.id, nextAttempts, lockUntil);
      await store.logAudit(username, 'LOGIN_FAILED', 'auth', `Attempt ${nextAttempts}`, ip);
      return res.status(401).json({
        ok: false,
        message: 'Tên đăng nhập hoặc mật khẩu không chính xác.',
      });
    }

    await store.updateAdminLoginSuccess(admin.id);
    const csrfToken = issueAuthCookies(res, admin);
    await store.logAudit(admin.username, 'LOGIN_SUCCESS', 'auth', 'Admin signed in', ip);

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
  })
);

// POST /api/auth/logout
router.post(
  '/logout',
  requireAdmin,
  csrfProtect,
  asyncHandler(async (req, res) => {
    await store.logAudit(req.admin.username, 'LOGOUT', 'auth', '', getClientIp(req));
    clearAuthCookies(res);
    res.json({ ok: true });
  })
);

// GET /api/auth/me
router.get('/me', requireAdmin, (req, res) => {
  res.json({
    ok: true,
    user: req.admin,
    driver: store.driver,
    csrfToken: req.cookies?.domino_csrf || '',
  });
});

// POST /api/auth/change-password
router.post(
  '/change-password',
  requireAdmin,
  csrfProtect,
  asyncHandler(async (req, res) => {
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

    const admin = await store.findAdminById(req.admin.id);
    if (!admin || !bcrypt.compareSync(currentPassword, admin.password_hash)) {
      return res.status(400).json({
        ok: false,
        message: 'Mật khẩu hiện tại không chính xác.',
      });
    }

    const newHash = bcrypt.hashSync(newPassword, 12);
    await store.updateAdminPassword(admin.id, newHash);
    await store.logAudit(req.admin.username, 'CHANGE_PASSWORD', 'auth', 'Password updated', ip);
    res.json({ ok: true, message: 'Đổi mật khẩu thành công.' });
  })
);

module.exports = router;
