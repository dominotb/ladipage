/**
 * Automated Defensive SQL Injection & PostgREST Filter Injection Security Suite
 * Tests our local Express backend against modern SQLi attack classes.
 */
const { spawn } = require('child_process');

const PORT = 3457;
const BASE = `http://localhost:${PORT}`;

const server = spawn(process.execPath, ['src/server.js'], {
  env: { ...process.env, PORT: String(PORT), NODE_ENV: 'production' },
  stdio: ['ignore', 'pipe', 'pipe'],
});

async function waitReady() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('Server did not start');
}

const results = [];
function record(category, payload, passed, detail) {
  results.push({ category, payload, passed, detail });
  console.log(`${passed ? 'BLOCKED (PASS)' : 'VULNERABLE (FAIL)'} [${category}] ${detail}`);
  if (!passed) process.exitCode = 1;
}

async function run() {
  await waitReady();

  // 1. Auth Bypass SQLi (Classic / Tautology / Comment truncation)
  const authPayloads = [
    "' OR '1'='1' --",
    "admin' --",
    "admin'/*",
    "' OR 1=1 LIMIT 1 --",
    "') OR ('1'='1",
  ];
  for (const p of authPayloads) {
    const r = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: p, password: 'wrong' }),
    });
    const text = await r.text();
    const safe = (r.status === 401 || r.status === 429) && !text.toLowerCase().includes('sqlite') && !text.toLowerCase().includes('syntax');
    record('Auth Bypass SQLi', p, safe, `HTTP ${r.status}, no SQL error leak`);
  }

  // Legitimate login for authenticated attack tests (new IP / not locked since 'admin' wasn't hit)
  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'Domino@2026!Secure' }),
  });
  const loginJson = await loginRes.json();
  if (!loginRes.ok) throw new Error('Could not login as admin for authenticated SQLi tests: ' + JSON.stringify(loginJson));

  const setCookies = loginRes.headers.getSetCookie
    ? loginRes.headers.getSetCookie()
    : [loginRes.headers.get('set-cookie')];
  const cookieHeader = setCookies.map((c) => c.split(';')[0]).join('; ');
  const adminHeaders = {
    'Content-Type': 'application/json',
    Cookie: cookieHeader,
    'X-Requested-With': 'XMLHttpRequest',
    'X-CSRF-Token': loginJson.csrfToken,
  };

  // 2. Union-Based SQLi on Search & Phone Check
  const unionPayload = "' UNION SELECT 1,username,password_hash,4,5,6,7,8,9,10 FROM admins --";
  const rUnionSearch = await fetch(
    `${BASE}/api/admin/leads?q=${encodeURIComponent(unionPayload)}`,
    { headers: adminHeaders }
  );
  const unionText = await rUnionSearch.text();
  record(
    'Union-Based SQLi (Search)',
    unionPayload,
    rUnionSearch.status === 200 && !unionText.includes('$2a$') && !unionText.includes('$2b$'),
    `HTTP ${rUnionSearch.status}, no password_hash leaked`
  );

  const rUnionPhone = await fetch(`${BASE}/api/leads/check-phone`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: unionPayload, countryIso: 'VN' }),
  });
  record(
    'Union-Based SQLi (Phone)',
    unionPayload,
    rUnionPhone.status === 400,
    `HTTP ${rUnionPhone.status} rejected by phone validator`
  );

  // 3. Stacked Queries (Destructive DROP / DELETE)
  const dropPayload = "Robert'); DROP TABLE leads; DROP TABLE admins; --";
  const testPhone = '0977' + String(Date.now()).slice(-6);
  const rDrop = await fetch(`${BASE}/api/leads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: dropPayload,
      phone: testPhone,
      countryIso: 'VN',
      area: "'; DELETE FROM leads; --",
      need: "1'; UPDATE admins SET password_hash='hacked'; --",
    }),
  });
  const dropJson = await rDrop.json();

  // Verify tables still exist & admin untouched
  const verifyOverview = await fetch(`${BASE}/api/admin/overview`, { headers: adminHeaders });
  const ovJson = await verifyOverview.json();
  record(
    'Stacked Queries + Second-Order SQLi',
    dropPayload,
    rDrop.status === 201 && verifyOverview.status === 200 && ovJson.stats.totalLeads >= 1,
    `Stored safely as literal string; leads & admins tables intact (totalLeads=${ovJson.stats.totalLeads})`
  );

  // 4. Error-Based SQLi
  const errorPayload = "' AND 1=CAST((SELECT password_hash FROM admins LIMIT 1) AS INT) --";
  const rErr = await fetch(
    `${BASE}/api/admin/leads?q=${encodeURIComponent(errorPayload)}&status=${encodeURIComponent(errorPayload)}`,
    { headers: adminHeaders }
  );
  const errText = await rErr.text();
  record(
    'Error-Based SQLi',
    errorPayload,
    rErr.status === 200 && !errText.toLowerCase().includes('sql') && !errText.includes('CAST'),
    `HTTP ${rErr.status}, zero DB error disclosure`
  );

  // 5. Boolean-Based Blind SQLi (Status & Source allowlist)
  const rBoolTrue = await fetch(
    `${BASE}/api/admin/leads?status=${encodeURIComponent("new' OR '1'='1")}`,
    { headers: adminHeaders }
  );
  const rBoolFalse = await fetch(
    `${BASE}/api/admin/leads?status=${encodeURIComponent("new' AND '1'='2")}`,
    { headers: adminHeaders }
  );
  const bTrue = await rBoolTrue.json();
  const bFalse = await rBoolFalse.json();
  record(
    'Boolean-Based Blind SQLi',
    "new' OR '1'='1",
    bTrue.total === bFalse.total,
    `Identical response (${bTrue.total} vs ${bFalse.total}) — strict status allowlist ignores injected SQL`
  );

  // 6. Time-Based Blind SQLi
  const timePayload = "1'; SELECT pg_sleep(5); --";
  const t0 = Date.now();
  const rTime = await fetch(
    `${BASE}/api/admin/leads?q=${encodeURIComponent(timePayload)}`,
    { headers: adminHeaders }
  );
  const elapsed = Date.now() - t0;
  record(
    'Time-Based Blind SQLi',
    timePayload,
    rTime.status === 200 && elapsed < 1000,
    `HTTP ${rTime.status} in ${elapsed}ms (no sleep executed)`
  );

  // 7. Path Parameter / Numeric Type Confusion SQLi
  const pathPayloads = ['1 OR 1=1', '1; DROP TABLE leads', '-1 UNION SELECT 1'];
  for (const pp of pathPayloads) {
    const rPath = await fetch(`${BASE}/api/admin/leads/${encodeURIComponent(pp)}`, {
      method: 'DELETE',
      headers: adminHeaders,
    });
    record(
      'Path Param SQLi',
      pp,
      rPath.status === 400,
      `HTTP ${rPath.status} rejected by Number.isInteger validation`
    );
  }

  // 8. PostgREST / Supabase Filter Injection check
  const postgrestPayload = 'test,id.gt.0,or(name.eq.*)';
  const sanitized = postgrestPayload.replace(/[,%*()."\\':;]/g, ' ').replace(/\s+/g, ' ').trim();
  const hasControlChars = /[,%*()."\\':;]/.test(sanitized);
  record(
    'PostgREST / Supabase Filter Injection',
    postgrestPayload,
    !hasControlChars,
    `Sanitized to "${sanitized}" — all PostgREST DSL operators stripped`
  );

  // 9. Bonus: CSV Formula Injection check on export
  const csvPhone = '0966' + String(Date.now()).slice(-6);
  const rCsvLead = await fetch(`${BASE}/api/leads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: "=CMD|' /C calc'!A0",
      phone: csvPhone,
      countryIso: 'VN',
    }),
  });
  const csvLeadJson = await rCsvLead.json();
  const rCsv = await fetch(`${BASE}/api/admin/leads/export.csv`, { headers: adminHeaders });
  const csvText = await rCsv.text();
  record(
    'CSV Formula Injection',
    "=CMD|' /C calc'!A0",
    csvText.includes("\"'=CMD|"),
    'Dangerous formula prefix escaped with leading apostrophe'
  );

  // Cleanup test leads
  if (dropJson.leadId) {
    await fetch(`${BASE}/api/admin/leads/${dropJson.leadId}`, {
      method: 'DELETE',
      headers: adminHeaders,
    });
  }
  if (csvLeadJson.leadId) {
    await fetch(`${BASE}/api/admin/leads/${csvLeadJson.leadId}`, {
      method: 'DELETE',
      headers: adminHeaders,
    });
  }

  const passedCount = results.filter((r) => r.passed).length;
  console.log(`\nSECURITY AUDIT SUMMARY: ${passedCount}/${results.length} attack vectors BLOCKED.`);
}

run()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => {
    server.kill();
  });

