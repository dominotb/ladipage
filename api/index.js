let app = null;
let bootError = null;

try {
  app = require('../src/server');
} catch (err) {
  bootError = err;
  console.error('[Vercel Boot Error]', err);
}

module.exports = (req, res) => {
  if (bootError || !app) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(
      JSON.stringify({
        ok: false,
        code: 'BOOT_FAILED',
        nodeVersion: process.version,
        error: bootError ? bootError.message : 'App failed to initialize',
      })
    );
    return;
  }
  return app(req, res);
};
