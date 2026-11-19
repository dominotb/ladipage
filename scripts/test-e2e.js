const { spawn } = require('child_process');

const PORT = 3456;
const BASE = `http://localhost:${PORT}`;

const server = spawn(process.execPath, ['src/server.js'], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'pipe'],
});

server.stderr.on('data', (d) => process.stderr.write(d));

async function waitReady() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`${BASE}/api/phone-countries`);
      if (r.ok) return;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('Server did not start in time');
}

function assert(cond, msg) {
  if (!cond) throw new Error('FAIL: ' + msg);
  console.log('PASS:', msg);
}

async function runTests() {
  await waitReady();

  // 1. Landing page & security headers
  const home = await fetch(`${BASE}/`);
  assert(home.status === 200, 'GET / returns 200');
  assert(home.headers.get('content-security-policy'), 'Helmet CSP header present');
  assert(!home.headers.get('x-powered-by'), 'X-Powered-By header hidden');
  const homeHtml = await home.text();
  assert(homeHtml.includes('data-cms-key="img-01"'), 'CMS editable tags present in rendered HTML');

  // 2. International & Vietnam phone validation (length + format)
  const checkPhone = async (phone, countryIso) => {
    const r = await fetch(`${BASE}/api/leads/check-phone`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, countryIso }),
    });
    return r.json();
  };

  const vnShort = await checkPhone('096786254', 'VN');
  assert(!vnShort.valid && vnShort.code === 'TOO_SHORT', 'VN 9-digit rejected as TOO_SHORT');

  const vnLong = await checkPhone('09678625459', 'VN');
  assert(!vnLong.valid && vnLong.code === 'TOO_LONG', 'VN 11-digit rejected as TOO_LONG');

  const vnOk = await checkPhone('0967 862 545', 'VN');
  assert(vnOk.valid && vnOk.e164 === '+84967862545', 'VN valid number normalized to +84967862545');

  const jpOk = await checkPhone('090-1234-5678', 'JP');
  assert(jpOk.valid && jpOk.e164 === '+819012345678', 'Japan international number valid (+819012345678)');

  const usShort = await checkPhone('20155501', 'US');
  assert(!usShort.valid && usShort.code === 'TOO_SHORT', 'US short number rejected as TOO_SHORT');

  // 3. Lead submission + duplicate phone rejection (across different formats)
  const testPhone = '0988' + String(Date.now()).slice(-6);
  const lead1 = await fetch(`${BASE}/api/leads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Nguyễn Test',
      phone: testPhone,
      countryIso: 'VN',
      stage: 'Đang xây nhà',
      area: 'Thái Bình',
      utm_source: 'facebook',
      fbclid: 'fb_test_123',
    }),
  });
  const lead1Json = await lead1.json();
  assert(lead1.status === 201 && lead1Json.ok, 'First lead submission succeeds (201)');

  const lead2 = await fetch(`${BASE}/api/leads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Nguyễn Test 2',
      phone: '+84' + testPhone.slice(1),
      countryIso: 'VN',
    }),
  });
  const lead2Json = await lead2.json();
  assert(
    lead2.status === 409 && lead2Json.code === 'DUPLICATE_PHONE',
    'Duplicate phone in international format (+84...) rejected with 409 DUPLICATE_PHONE'
  );

  // 4. Admin Auth + CSRF protection + CMS Live Preview Publish + Cleanup
  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'Domino@2026!Secure' }),
  });
  const loginJson = await loginRes.json();
  assert(loginRes.status === 200 && loginJson.ok, 'Admin login succeeds (200)');

  const setCookies = loginRes.headers.getSetCookie
    ? loginRes.headers.getSetCookie()
    : [loginRes.headers.get('set-cookie')];
  const cookieHeader = setCookies.map((c) => c.split(';')[0]).join('; ');
  const csrfToken = loginJson.csrfToken;

  const noCsrf = await fetch(`${BASE}/api/admin/leads/${lead1Json.leadId}`, {
    method: 'DELETE',
    headers: { Cookie: cookieHeader },
  });
  assert(noCsrf.status === 403, 'Admin mutation without CSRF token rejected (403)');

  const adminHeaders = {
    'Content-Type': 'application/json',
    Cookie: cookieHeader,
    'X-Requested-With': 'XMLHttpRequest',
    'X-CSRF-Token': csrfToken,
  };

  const cmsRes = await fetch(`${BASE}/api/admin/cms`, {
    method: 'PUT',
    headers: adminHeaders,
    body: JSON.stringify({
      changes: {
        'txt-001': { type: 'html', value: { html: 'Test <em>Headline</em> <a href="https://tubepdomino.vn">Link</a>' } },
      },
    }),
  });
  assert(cmsRes.status === 200, 'CMS Live Preview publish succeeds (200)');

  // Verify published CMS override is injected into public page
  const updatedHome = await (await fetch(`${BASE}/`)).text();
  assert(updatedHome.includes('Test \\u003cem\\u003eHeadline\\u003c/em\\u003e'), 'Published CMS override appears in live page config');

  // Verify preview bridge loads ONLY for authenticated admin
  const previewAnon = await (await fetch(`${BASE}/?cms_preview=1`)).text();
  assert(!previewAnon.includes('/js/cms-bridge.js'), 'CMS preview bridge blocked for anonymous users');

  const previewAdmin = await (
    await fetch(`${BASE}/?cms_preview=1`, { headers: { Cookie: cookieHeader } })
  ).text();
  assert(previewAdmin.includes('/js/cms-bridge.js'), 'CMS preview bridge loads for authenticated admin');

  // Cleanup test override and test lead
  await fetch(`${BASE}/api/admin/cms/txt-001`, { method: 'DELETE', headers: adminHeaders });
  const delLead = await fetch(`${BASE}/api/admin/leads/${lead1Json.leadId}`, {
    method: 'DELETE',
    headers: adminHeaders,
  });
  assert(delLead.status === 200, 'Cleanup test lead succeeds (200)');

  console.log('\nALL 15 END-TO-END TESTS PASSED!');
}

runTests()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => {
    server.kill();
  });

