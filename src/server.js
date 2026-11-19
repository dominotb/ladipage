const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const env = require('./config/env');
const { getDb } = require('./db/database');
const { securityHeaders } = require('./middleware/security');
const publicRoutes = require('./routes/public');
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');

// Initialize SQLite database & default seed on boot
getDb();

const app = express();

// Hide X-Powered-By header
app.disable('x-powered-by');
if (env.trustProxy) {
  app.set('trust proxy', 1);
}

// Security headers (Helmet + CSP + anti-clickjacking)
app.use(securityHeaders);

// Body parsers with strict size limits to prevent payload DoS
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '200kb' }));
app.use(cookieParser(env.cookieSecret));

// Static assets (extracted images, uploaded media, client JS, admin UI)
app.use(
  '/assets',
  express.static(path.resolve(__dirname, '../public/assets'), {
    maxAge: '7d',
    etag: true,
  })
);
app.use(
  '/uploads',
  express.static(path.resolve(__dirname, '../public/uploads'), {
    maxAge: '7d',
    etag: true,
    setHeaders: (res) => {
      // Prevent script execution if any non-image were ever served from uploads
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'");
    },
  })
);
app.use(
  '/js',
  express.static(path.resolve(__dirname, '../public/js'), {
    maxAge: env.isProd ? '1d' : 0,
  })
);
app.use(
  '/admin',
  express.static(path.resolve(__dirname, '../public/admin'), {
    maxAge: 0,
  })
);

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/', publicRoutes);

// Admin SPA fallback
app.get('/admin/*', (_req, res) => {
  res.sendFile(path.resolve(__dirname, '../public/admin/index.html'));
});

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ ok: false, message: 'Không tìm thấy đường dẫn yêu cầu.' });
});

// Global error handler (never leak stack traces in production)
app.use((err, _req, res, _next) => {
  console.error('[Server Error]', err);
  res.status(err.status || 500).json({
    ok: false,
    message: env.isProd ? 'Đã xảy ra lỗi máy chủ.' : err.message || 'Internal server error',
  });
});

app.listen(env.port, () => {
  console.log(`\n=======================================================`);
  console.log(`  DOMINO Landing Page & Admin CMS Server is running!`);
  console.log(`  Landing Page : http://localhost:${env.port}/`);
  console.log(`  Admin CMS    : http://localhost:${env.port}/admin`);
  console.log(`  Environment  : ${env.nodeEnv}`);
  console.log(`=======================================================\n`);
});

