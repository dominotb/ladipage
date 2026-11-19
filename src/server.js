const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const env = require('./config/env');
const store = require('./db/store');
const { securityHeaders } = require('./middleware/security');
const publicRoutes = require('./routes/public');
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');

// Kick off non-blocking initialization (SQLite sync or Supabase seed check)
store.init().catch((err) => console.error('[DB Init Error]', err.message));

const app = express();

app.disable('x-powered-by');
if (env.trustProxy) {
  app.set('trust proxy', 1);
}

app.use(securityHeaders);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '200kb' }));
app.use(cookieParser(env.cookieSecret));

// Static assets
app.use(
  '/assets',
  express.static(path.resolve(__dirname, '../public/assets'), {
    maxAge: '7d',
    etag: true,
  })
);
app.use(
  '/uploads',
  express.static(env.uploadsDir, {
    maxAge: '7d',
    etag: true,
    setHeaders: (res) => {
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

// Health check endpoint for Vercel monitoring
app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    driver: store.driver,
    supabaseConfigured: env.useSupabase,
    vercel: env.isVercel,
    node: process.version,
  });
});

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

// Global error handler
app.use((err, _req, res, _next) => {
  console.error('[Server Error]', err);
  res.status(err.status || 500).json({
    ok: false,
    message: env.isProd ? 'Đã xảy ra lỗi máy chủ.' : err.message || 'Internal server error',
  });
});

if (!env.isVercel && require.main === module) {
  app.listen(env.port, () => {
    console.log(`\n=======================================================`);
    console.log(`  DOMINO Landing Page & Admin CMS Server is running!`);
    console.log(`  Landing Page : http://localhost:${env.port}/`);
    console.log(`  Admin CMS    : http://localhost:${env.port}/admin`);
    console.log(`  DB Driver    : ${store.driver}`);
    console.log(`  Environment  : ${env.nodeEnv}`);
    console.log(`=======================================================\n`);
  });
}

module.exports = app;
