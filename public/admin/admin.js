(function () {
  'use strict';

  var state = {
    user: null,
    csrfToken: '',
    leadsPage: 1,
    cmsOverrides: {},
    pendingCms: {}, // { [key]: { type, value } }
    selectedCms: null,
    cmsElements: [],
    mediaList: [],
    iframeLoaded: false,
  };

  /* ---------- Helpers ---------- */
  function getCookie(name) {
    var m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : '';
  }

  function esc(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  var toastTimer = null;
  function showToast(msg, isError) {
    var el = document.getElementById('toast');
    el.textContent = msg;
    el.style.borderColor = isError ? '#d95b52' : '#c6a15f';
    el.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.classList.add('hidden');
    }, 3400);
  }

  async function api(url, opts) {
    opts = opts || {};
    var headers = Object.assign(
      { 'X-Requested-With': 'XMLHttpRequest' },
      opts.headers || {}
    );
    var csrf = state.csrfToken || getCookie('domino_csrf');
    if (csrf) headers['X-CSRF-Token'] = csrf;
    if (opts.body && !(opts.body instanceof FormData) && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(opts.body);
    }
    var res = await fetch(url, Object.assign({ credentials: 'same-origin' }, opts, { headers: headers }));
    var data = await res.json().catch(function () {
      return { ok: false, message: 'Phản hồi không hợp lệ.' };
    });
    if (res.status === 401 && url !== '/api/auth/login') {
      showLogin();
      throw new Error('Unauthorized');
    }
    if (!res.ok || data.ok === false) {
      throw new Error(data.message || 'Yêu cầu thất bại.');
    }
    return data;
  }

  var STATUS_LABELS = {
    new: ['Mới', 'badge-gold'],
    contacted: ['Đang tư vấn', 'badge-warn'],
    surveyed: ['Đã khảo sát', 'badge'],
    won: ['Đã chốt', 'badge-ok'],
    lost: ['Không nhu cầu', 'badge-err'],
  };

  function statusBadge(st) {
    var pair = STATUS_LABELS[st] || [st, 'badge'];
    return '<span class="badge ' + pair[1] + '">' + esc(pair[0]) + '</span>';
  }

  function capiBadge(st) {
    if (st === 'sent') return '<span class="badge badge-ok">Đã gửi</span>';
    if (st === 'failed') return '<span class="badge badge-err">Lỗi</span>';
    if (st === 'unconfigured') return '<span class="badge">Chưa cấu hình</span>';
    return '<span class="badge">' + esc(st || 'Tắt') + '</span>';
  }

  /* ---------- Auth & Shell ---------- */
  function showLogin() {
    document.getElementById('loginScreen').classList.remove('hidden');
    document.getElementById('adminApp').classList.add('hidden');
  }

  function showApp(user) {
    state.user = user;
    document.getElementById('adminUserLabel').textContent = user.username;
    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('adminApp').classList.remove('hidden');
    loadOverview();
  }

  async function checkSession() {
    try {
      var data = await api('/api/auth/me');
      state.csrfToken = data.csrfToken || getCookie('domino_csrf');
      showApp(data.user);
    } catch {
      showLogin();
    }
  }

  document.getElementById('loginForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    var errEl = document.getElementById('loginErr');
    errEl.classList.add('hidden');
    var btn = document.getElementById('loginBtn');
    btn.disabled = true;
    btn.textContent = 'Đang đăng nhập...';
    try {
      var data = await api('/api/auth/login', {
        method: 'POST',
        body: {
          username: document.getElementById('loginUser').value.trim(),
          password: document.getElementById('loginPass').value,
        },
      });
      state.csrfToken = data.csrfToken || getCookie('domino_csrf');
      showApp(data.user);
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Đăng nhập';
    }
  });

  document.getElementById('logoutBtn').addEventListener('click', async function () {
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } catch {}
    showLogin();
  });

  /* ---------- Tab Navigation ---------- */
  document.querySelectorAll('.nav-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var tab = btn.getAttribute('data-tab');
      document.querySelectorAll('.nav-btn').forEach(function (b) {
        b.classList.toggle('active', b === btn);
      });
      document.querySelectorAll('.tab-panel').forEach(function (p) {
        p.classList.toggle('active', p.id === 'tab-' + tab);
      });

      if (tab === 'overview') loadOverview();
      if (tab === 'leads') loadLeads(1);
      if (tab === 'facebook') loadFacebook();
      if (tab === 'livepreview') initLivePreview();
      if (tab === 'media') loadMedia();
      if (tab === 'security') loadAuditLogs();
    });
  });

  /* ---------- TAB 1: OVERVIEW ---------- */
  async function loadOverview() {
    try {
      var data = await api('/api/admin/overview');
      var s = data.stats;
      document.getElementById('kpiGrid').innerHTML = [
        kpiCard('Tổng khách đăng ký', s.totalLeads, 'Không trùng lặp SĐT (E.164)'),
        kpiCard('Đăng ký hôm nay', s.todayLeads, 'Cập nhật theo thời gian thực'),
        kpiCard('Lead từ Facebook', s.fbLeads, 'Bắt qua UTM / FBCLID'),
        kpiCard('Facebook CAPI Sent', s.capiSent + ' / ' + s.capiTotal, 'Sự kiện server-side'),
        kpiCard('Mục CMS đã chỉnh sửa', s.overridesCount, 'Đang hiển thị trên trang'),
      ].join('');

      var recentHtml = data.recentLeads.length
        ? data.recentLeads
            .map(function (l) {
              return (
                '<tr><td><strong>' +
                esc(l.name) +
                '</strong></td><td>' +
                esc(l.phone_e164) +
                ' <span class="muted small">(' +
                esc(l.country_iso) +
                ')</span></td><td>' +
                esc(l.area || '-') +
                '</td><td>' +
                statusBadge(l.status) +
                '</td><td>' +
                capiBadge(l.fb_capi_status) +
                '</td></tr>'
              );
            })
            .join('')
        : '<tr><td colspan="5" class="muted">Chưa có khách hàng đăng ký nào.</td></tr>';
      document.getElementById('recentLeadsBody').innerHTML = recentHtml;

      document.getElementById('sourceBreakdown').innerHTML = data.bySource.length
        ? data.bySource
            .map(function (x) {
              return '<li><span>' + esc(x.source) + '</span><strong>' + x.cnt + '</strong></li>';
            })
            .join('')
        : '<li class="muted">Chưa có dữ liệu</li>';

      document.getElementById('statusBreakdown').innerHTML = data.byStatus.length
        ? data.byStatus
            .map(function (x) {
              return '<li><span>' + statusBadge(x.status) + '</span><strong>' + x.cnt + '</strong></li>';
            })
            .join('')
        : '<li class="muted">Chưa có dữ liệu</li>';
    } catch (e) {
      showToast(e.message, true);
    }
  }

  function kpiCard(label, val, sub) {
    return (
      '<div class="kpi"><div class="kpi-label">' +
      esc(label) +
      '</div><div class="kpi-val">' +
      esc(val) +
      '</div><div class="kpi-sub">' +
      esc(sub) +
      '</div></div>'
    );
  }

  document.getElementById('refreshOverviewBtn').addEventListener('click', loadOverview);

  /* ---------- TAB 2: LEADS ---------- */
  async function loadLeads(page) {
    state.leadsPage = page || 1;
    var q = encodeURIComponent(document.getElementById('leadSearch').value.trim());
    var st = encodeURIComponent(document.getElementById('leadStatusFilter').value);
    var src = encodeURIComponent(document.getElementById('leadSourceFilter').value);
    try {
      var data = await api(
        '/api/admin/leads?page=' + state.leadsPage + '&q=' + q + '&status=' + st + '&source=' + src
      );
      var tbody = document.getElementById('leadsTableBody');
      if (!data.leads.length) {
        tbody.innerHTML = '<tr><td colspan="8" class="muted">Không tìm thấy khách hàng nào.</td></tr>';
      } else {
        tbody.innerHTML = data.leads
          .map(function (l) {
            return (
              '<tr>' +
              '<td>#' + l.id + '</td>' +
              '<td><strong>' + esc(l.name) + '</strong><div class="muted small">' + esc(l.need || '').slice(0, 70) + '</div></td>' +
              '<td><code>' + esc(l.phone_e164) + '</code><div class="muted small">' + esc(l.country_iso) + ' · ' + esc(l.phone_national) + '</div></td>' +
              '<td>' + esc(l.stage || '-') + '<div class="muted small">' + esc(l.area || '-') + '</div></td>' +
              '<td>' + esc(l.utm_source || (l.fbclid ? 'Facebook' : 'Direct')) + (l.utm_campaign ? '<div class="muted small">' + esc(l.utm_campaign) + '</div>' : '') + '</td>' +
              '<td><select class="lead-status-sel" data-id="' + l.id + '">' +
              Object.keys(STATUS_LABELS)
                .map(function (k) {
                  return '<option value="' + k + '"' + (l.status === k ? ' selected' : '') + '>' + STATUS_LABELS[k][0] + '</option>';
                })
                .join('') +
              '</select></td>' +
              '<td>' + capiBadge(l.fb_capi_status) + '</td>' +
              '<td><div class="btn-row">' +
              '<button class="btn btn-ghost btn-sm lead-view-btn" data-id="' + l.id + '">Chi tiết</button>' +
              '<button class="btn btn-danger btn-sm lead-del-btn" data-id="' + l.id + '">Xóa</button>' +
              '</div></td>' +
              '</tr>'
            );
          })
          .join('');

        // Bind inline events
        tbody.querySelectorAll('.lead-status-sel').forEach(function (sel) {
          sel.addEventListener('change', async function () {
            try {
              await api('/api/admin/leads/' + sel.getAttribute('data-id'), {
                method: 'PATCH',
                body: { status: sel.value },
              });
              showToast('Đã cập nhật trạng thái khách hàng.');
            } catch (e) {
              showToast(e.message, true);
            }
          });
        });

        tbody.querySelectorAll('.lead-del-btn').forEach(function (btn) {
          btn.addEventListener('click', async function () {
            if (!confirm('Xác nhận xóa khách hàng #' + btn.getAttribute('data-id') + '?')) return;
            try {
              await api('/api/admin/leads/' + btn.getAttribute('data-id'), { method: 'DELETE' });
              showToast('Đã xóa khách hàng.');
              loadLeads(state.leadsPage);
            } catch (e) {
              showToast(e.message, true);
            }
          });
        });

        tbody.querySelectorAll('.lead-view-btn').forEach(function (btn) {
          btn.addEventListener('click', function () {
            var id = Number(btn.getAttribute('data-id'));
            var lead = data.leads.find(function (x) { return x.id === id; });
            if (lead) openLeadModal(lead);
          });
        });
      }

      var totalPages = Math.max(1, Math.ceil(data.total / data.limit));
      document.getElementById('leadsPagination').innerHTML =
        '<span class="muted small">Tổng: ' + data.total + ' khách hàng · Trang ' + data.page + '/' + totalPages + '</span>' +
        (data.page > 1 ? '<button class="btn btn-ghost btn-sm" id="prevPage">← Trước</button>' : '') +
        (data.page < totalPages ? '<button class="btn btn-ghost btn-sm" id="nextPage">Sau →</button>' : '');
      var prev = document.getElementById('prevPage');
      var next = document.getElementById('nextPage');
      if (prev) prev.addEventListener('click', function () { loadLeads(data.page - 1); });
      if (next) next.addEventListener('click', function () { loadLeads(data.page + 1); });
    } catch (e) {
      showToast(e.message, true);
    }
  }

  function openLeadModal(lead) {
    var modal = document.getElementById('leadModal');
    var body = document.getElementById('leadModalBody');
    body.innerHTML =
      '<div class="form-group"><strong>' + esc(lead.name) + '</strong> — <code>' + esc(lead.phone_e164) + '</code> (' + esc(lead.country_iso) + ')</div>' +
      '<div class="small muted" style="margin-bottom:12px">Thời gian: ' + esc(lead.created_at) + ' · IP: ' + esc(lead.ip_address) + '</div>' +
      '<div class="form-group"><label>Giai đoạn / Khu vực</label><div>' + esc(lead.stage || '-') + ' / ' + esc(lead.area || '-') + '</div></div>' +
      '<div class="form-group"><label>Nhu cầu</label><div>' + esc(lead.need || '-') + '</div></div>' +
      '<div class="form-group"><label>Thông số Tracking Facebook</label><div class="small muted">UTM Source: ' + esc(lead.utm_source || '-') + ' | Campaign: ' + esc(lead.utm_campaign || '-') + '<br>FBCLID: ' + esc(lead.fbclid || '-') + '<br>Event ID: ' + esc(lead.fb_event_id || '-') + ' | CAPI: ' + esc(lead.fb_capi_status) + '</div></div>' +
      '<div class="form-group"><label>Ghi chú tư vấn nội bộ</label><textarea id="modalLeadNotes" rows="3">' + esc(lead.notes || '') + '</textarea></div>' +
      '<div class="btn-row" style="margin-bottom:14px">' +
      '<button id="saveLeadNotesBtn" class="btn btn-gold btn-sm">Lưu ghi chú</button>' +
      '</div>' +
      '<div class="card" style="background:#0c0f12"><h4 style="margin:0 0 8px;font-size:13px;color:var(--gold-2)">Gửi sự kiện chuyển đổi về Facebook CAPI</h4>' +
      '<div class="btn-row">' +
      '<button class="btn btn-ghost btn-sm capi-fire" data-ev="Lead">Gửi lại Lead</button>' +
      '<button class="btn btn-ghost btn-sm capi-fire" data-ev="Schedule">Gửi Schedule (Hẹn khảo sát)</button>' +
      '<button class="btn btn-gold btn-sm capi-fire" data-ev="Purchase">Gửi Purchase (Đã chốt)</button>' +
      '</div></div>';

    modal.classList.remove('hidden');

    document.getElementById('saveLeadNotesBtn').addEventListener('click', async function () {
      try {
        await api('/api/admin/leads/' + lead.id, {
          method: 'PATCH',
          body: { notes: document.getElementById('modalLeadNotes').value },
        });
        showToast('Đã lưu ghi chú.');
        loadLeads(state.leadsPage);
      } catch (e) {
        showToast(e.message, true);
      }
    });

    body.querySelectorAll('.capi-fire').forEach(function (b) {
      b.addEventListener('click', async function () {
        var ev = b.getAttribute('data-ev');
        var val = 0;
        if (ev === 'Purchase') {
          var inp = prompt('Nhập giá trị hợp đồng (VND) để gửi về Facebook Ads:', '50000000');
          if (inp === null) return;
          val = Number(inp) || 0;
        }
        try {
          var res = await api('/api/admin/leads/' + lead.id + '/resend-capi', {
            method: 'POST',
            body: { eventName: ev, value: val },
          });
          showToast('CAPI (' + ev + '): ' + res.result.capiStatus);
          loadLeads(state.leadsPage);
        } catch (e) {
          showToast(e.message, true);
        }
      });
    });
  }

  document.getElementById('closeLeadModal').addEventListener('click', function () {
    document.getElementById('leadModal').classList.add('hidden');
  });
  document.getElementById('leadFilterBtn').addEventListener('click', function () {
    loadLeads(1);
  });
  document.getElementById('leadSearch').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') loadLeads(1);
  });

  /* ---------- TAB 3: FACEBOOK TRACKING ---------- */
  function buildDefaultPixelSnippet(pixelId) {
    if (!pixelId) return '';
    return [
      '<!-- Meta Pixel Code -->',
      '<script>',
      '!function(f,b,e,v,n,t,s)',
      '{if(f.fbq)return;n=f.fbq=function(){n.callMethod?',
      'n.callMethod.apply(n,arguments):n.queue.push(arguments)};',
      'if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version=\'2.0\';',
      'n.queue=[];t=b.createElement(e);t.async=!0;',
      't.src=v;s=b.getElementsByTagName(e)[0];',
      's.parentNode.insertBefore(t,s)}(window, document,\'script\',',
      '\'https://connect.facebook.net/en_US/fbevents.js\');',
      'fbq(\'init\', \'' + pixelId + '\');',
      'fbq(\'track\', \'PageView\');',
      '</script>',
      '<noscript><img height="1" width="1" style="display:none"',
      'src="https://www.facebook.com/tr?id=' + pixelId + '&ev=PageView&noscript=1"',
      '/></noscript>',
      '<!-- End Meta Pixel Code -->',
    ].join('\n');
  }

  document.getElementById('fbPixelBaseCode').addEventListener('input', function () {
    var code = this.value;
    var m = code.match(/fbq\s*\(\s*['"]init['"]\s*,\s*['"](\d{5,30})['"]\s*\)/i);
    if (m && m[1]) {
      document.getElementById('fbPixelId').value = m[1];
      document.getElementById('fbPixelEnabled').checked = true;
    }
  });

  document.getElementById('fbPixelId').addEventListener('input', function () {
    var id = this.value.replace(/[^0-9]/g, '');
    if (id.length >= 5) {
      document.getElementById('fbPixelBaseCode').value = buildDefaultPixelSnippet(id);
    }
  });

  async function loadFacebook() {
    try {
      var data = await api('/api/admin/facebook');
      var c = data.config;
      document.getElementById('fbPixelId').value = c.fb_pixel_id;
      document.getElementById('fbPixelBaseCode').value =
        c.fb_pixel_base_code || buildDefaultPixelSnippet(c.fb_pixel_id);
      document.getElementById('fbCapiToken').value = c.fb_capi_token;
      document.getElementById('fbTestCode').value = c.fb_test_event_code;
      document.getElementById('fbLeadValue').value = c.fb_lead_value;
      document.getElementById('fbCurrency').value = c.fb_currency;
      document.getElementById('fbPixelEnabled').checked = !!c.fb_pixel_enabled;
      document.getElementById('fbCapiEnabled').checked = !!c.fb_capi_enabled;

      var body = document.getElementById('fbEventsBody');
      body.innerHTML = data.events.length
        ? data.events
            .map(function (ev) {
              return (
                '<tr><td class="small">' + esc(ev.created_at) + '</td>' +
                '<td><strong>' + esc(ev.event_name) + '</strong></td>' +
                '<td class="small">' + esc(ev.source) + '</td>' +
                '<td class="small"><code>' + esc(ev.event_id).slice(0, 18) + '</code></td>' +
                '<td class="small">' + esc(ev.utm_campaign || ev.fbclid || '-') + '</td>' +
                '<td>' + capiBadge(ev.capi_status) + (ev.capi_http_code ? ' <span class="small muted">(' + ev.capi_http_code + ')</span>' : '') + '</td>' +
                '<td class="small muted">' + esc(ev.capi_response || '').slice(0, 90) + '</td></tr>'
              );
            })
            .join('')
        : '<tr><td colspan="7" class="muted">Chưa có sự kiện chuyển đổi nào được ghi nhận.</td></tr>';
    } catch (e) {
      showToast(e.message, true);
    }
  }

  document.getElementById('fbForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    try {
      var res = await api('/api/admin/facebook', {
        method: 'PUT',
        body: {
          fb_pixel_base_code: document.getElementById('fbPixelBaseCode').value.trim(),
          fb_pixel_id: document.getElementById('fbPixelId').value.trim(),
          fb_capi_token: document.getElementById('fbCapiToken').value.trim(),
          fb_test_event_code: document.getElementById('fbTestCode').value.trim(),
          fb_lead_value: document.getElementById('fbLeadValue').value,
          fb_currency: document.getElementById('fbCurrency').value.trim(),
          fb_pixel_enabled: document.getElementById('fbPixelEnabled').checked,
          fb_capi_enabled: document.getElementById('fbCapiEnabled').checked,
        },
      });
      showToast(res.message);
    } catch (e) {
      showToast(e.message, true);
    }
  });

  document.getElementById('fbTestBtn').addEventListener('click', async function () {
    var out = document.getElementById('fbTestOutput');
    out.classList.remove('hidden');
    out.textContent = 'Đang gửi sự kiện Test tới Meta Graph API v27.0...';
    try {
      var res = await api('/api/admin/facebook/test', {
        method: 'POST',
        body: { test_event_code: document.getElementById('fbTestCode').value.trim() },
      });
      out.textContent = JSON.stringify(res.result, null, 2);
      showToast('Kết quả Test CAPI: ' + res.result.capiStatus);
      loadFacebook();
    } catch (e) {
      out.textContent = e.message;
      showToast(e.message, true);
    }
  });

  /* ---------- TAB 4: LIVE PREVIEW CMS ---------- */
  async function initLivePreview() {
    if (!state.iframeLoaded) {
      document.getElementById('cmsIframe').src = '/?cms_preview=1';
      state.iframeLoaded = true;
    }
    try {
      var data = await api('/api/admin/cms');
      state.cmsOverrides = data.overrides || {};
      document.getElementById('seoTitle').value = data.seo.site_title || '';
      document.getElementById('seoDesc').value = data.seo.site_description || '';
      document.getElementById('seoOgImage').value = data.seo.og_image || '';
      renderRevisions(data.revisions || []);
      await loadQuickMedia();
    } catch (e) {
      showToast(e.message, true);
    }
  }

  function updateDirtyBadge() {
    var count = Object.keys(state.pendingCms).length;
    var badge = document.getElementById('cmsDirtyBadge');
    if (count > 0) {
      badge.textContent = count + ' thay đổi chưa lưu';
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  }

  function sendToIframe(msg) {
    var iframe = document.getElementById('cmsIframe');
    if (iframe && iframe.contentWindow) {
      iframe.contentWindow.postMessage(msg, window.location.origin);
    }
  }

  // Receive messages from Live Preview iframe
  window.addEventListener('message', function (e) {
    if (e.origin !== window.location.origin) return;
    var msg = e.data || {};
    if (msg.type === 'CMS_BRIDGE_READY') {
      sendToIframe({ type: 'CMS_LIST_ELEMENTS' });
    } else if (msg.type === 'CMS_ELEMENTS_LIST') {
      state.cmsElements = msg.payload || [];
      renderElementsList();
    } else if (msg.type === 'CMS_SELECT' && msg.payload) {
      openInspector(msg.payload);
    }
  });

  function openInspector(item) {
    state.selectedCms = item;
    // Switch to Edit sub-tab
    document.querySelectorAll('.ins-tab').forEach(function (t) {
      t.classList.toggle('active', t.getAttribute('data-ins') === 'edit');
    });
    document.querySelectorAll('.ins-panel').forEach(function (p) {
      p.classList.toggle('active', p.id === 'ins-edit');
    });

    document.getElementById('insEmpty').classList.add('hidden');
    document.getElementById('insFormWrap').classList.remove('hidden');
    document.getElementById('insKeyBadge').textContent = item.key;
    document.getElementById('insTypeBadge').textContent = item.cmsType.toUpperCase();

    ['editorText', 'editorImage', 'editorLink', 'editorIframe'].forEach(function (id) {
      document.getElementById(id).classList.add('hidden');
    });

    if (item.cmsType === 'image') {
      document.getElementById('editorImage').classList.remove('hidden');
      document.getElementById('editImgPreview').src = item.value.src || '';
      document.getElementById('editImgSrc').value = item.value.src || '';
      document.getElementById('editImgAlt').value = item.value.alt || '';
      document.getElementById('editImgCaption').value = item.value.caption || '';
    } else if (item.cmsType === 'link') {
      document.getElementById('editorLink').classList.remove('hidden');
      document.getElementById('editLinkHref').value = item.value.href || '';
      document.getElementById('editLinkHtml').value = item.value.html || '';
      document.getElementById('editLinkTarget').value = item.value.target || '_self';
      document.getElementById('editLinkTextGroup').classList.toggle('hidden', !!item.value.hasMedia);
    } else if (item.cmsType === 'iframe') {
      document.getElementById('editorIframe').classList.remove('hidden');
      document.getElementById('editIframeSrc').value = item.value.src || '';
    } else {
      document.getElementById('editorText').classList.remove('hidden');
      document.getElementById('editHtmlInput').value = item.value.html || '';
    }
  }

  function pushLiveChange(type, value) {
    if (!state.selectedCms) return;
    var key = state.selectedCms.key;
    state.pendingCms[key] = { type: type, value: value };
    state.selectedCms.value = value;
    updateDirtyBadge();
    sendToIframe({
      type: 'CMS_APPLY_LIVE',
      payload: { key: key, cmsType: type, value: value },
    });
  }

  // Bind live inputs
  document.getElementById('editHtmlInput').addEventListener('input', function () {
    pushLiveChange('html', { html: this.value });
  });

  // Mini formatting toolbar (bold, em, insert link)
  document.querySelectorAll('.mini-toolbar button').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var ta = document.getElementById('editHtmlInput');
      var fmt = btn.getAttribute('data-fmt');
      var start = ta.selectionStart;
      var end = ta.selectionEnd;
      var sel = ta.value.slice(start, end) || 'văn bản';
      var replacement = sel;
      if (fmt === 'strong') replacement = '<strong>' + sel + '</strong>';
      else if (fmt === 'em') replacement = '<em>' + sel + '</em>';
      else if (fmt === 'link') {
        var url = prompt('Nhập đường dẫn URL (ví dụ: https://... hoặc #dang-ky hoặc tel:0967862545):', 'https://');
        if (!url) return;
        replacement = '<a href="' + url + '" target="_blank" rel="noopener">' + sel + '</a>';
      }
      ta.value = ta.value.slice(0, start) + replacement + ta.value.slice(end);
      pushLiveChange('html', { html: ta.value });
    });
  });

  // Image live inputs
  function emitImageChange() {
    var val = {
      src: document.getElementById('editImgSrc').value.trim(),
      alt: document.getElementById('editImgAlt').value,
      caption: document.getElementById('editImgCaption').value,
    };
    document.getElementById('editImgPreview').src = val.src;
    pushLiveChange('image', val);
  }
  ['editImgSrc', 'editImgAlt', 'editImgCaption'].forEach(function (id) {
    document.getElementById(id).addEventListener('input', emitImageChange);
  });

  // Compress & convert any image to lightweight WebP in browser before upload
  function compressImageToWebp(file, maxWidth, quality) {
    maxWidth = maxWidth || 1600;
    quality = quality || 0.82;
    return new Promise(function (resolve) {
      var img = new Image();
      var objUrl = URL.createObjectURL(file);
      img.onload = function () {
        URL.revokeObjectURL(objUrl);
        var w = img.naturalWidth || img.width;
        var h = img.naturalHeight || img.height;
        if (w > maxWidth) {
          h = Math.round((h * maxWidth) / w);
          w = maxWidth;
        }
        var canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        var ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob(
          function (blob) {
            if (!blob || blob.size >= file.size && file.type === 'image/webp') {
              resolve(file);
              return;
            }
            var baseName = (file.name || 'image').replace(/\.[^.]+$/, '');
            var webpFile = new File([blob], baseName + '.webp', { type: 'image/webp' });
            resolve(webpFile);
          },
          'image/webp',
          quality
        );
      };
      img.onerror = function () {
        URL.revokeObjectURL(objUrl);
        resolve(file);
      };
      img.src = objUrl;
    });
  }

  document.getElementById('editImgFile').addEventListener('change', async function () {
    var rawFile = this.files[0];
    if (!rawFile) return;
    var statusEl = document.getElementById('editImgStatus');
    if (statusEl) statusEl.textContent = 'Đang nén ảnh sang WebP...';
    try {
      var webpFile = await compressImageToWebp(rawFile, 1600, 0.82);
      var fd = new FormData();
      fd.append('file', webpFile);
      var res = await api('/api/admin/media/upload', { method: 'POST', body: fd });
      document.getElementById('editImgSrc').value = res.asset.url;
      emitImageChange();
      var origKb = Math.max(1, Math.round(rawFile.size / 1024));
      var newKb = Math.max(1, Math.round(webpFile.size / 1024));
      var msg = 'Đã nén WebP (' + origKb + 'KB → ' + newKb + 'KB) và áp dụng!';
      if (statusEl) statusEl.textContent = '✓ ' + msg;
      showToast(msg);
      loadQuickMedia();
    } catch (e) {
      if (statusEl) statusEl.textContent = 'Lỗi: ' + e.message;
      showToast(e.message, true);
    } finally {
      this.value = '';
    }
  });

  // Link live inputs
  function emitLinkChange() {
    var val = {
      href: document.getElementById('editLinkHref').value.trim(),
      html: document.getElementById('editLinkHtml').value,
      target: document.getElementById('editLinkTarget').value,
    };
    pushLiveChange('link', val);
  }
  ['editLinkHref', 'editLinkHtml', 'editLinkTarget'].forEach(function (id) {
    document.getElementById(id).addEventListener('input', emitLinkChange);
    document.getElementById(id).addEventListener('change', emitLinkChange);
  });

  // Iframe live input (auto-extract src if user pastes full Google Maps <iframe> HTML)
  document.getElementById('editIframeSrc').addEventListener('input', function () {
    var raw = this.value.trim();
    var m = raw.match(/src=["']([^"']+)["']/i);
    if (m && m[1]) {
      raw = m[1].replace(/&amp;/g, '&');
      this.value = raw;
    }
    if (raw.startsWith('https://www.google.com/maps') || raw.startsWith('https://maps.google.com')) {
      pushLiveChange('iframe', { src: raw });
    }
  });

  // Viewport switcher
  document.querySelectorAll('.vp-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var vp = btn.getAttribute('data-vp');
      document.querySelectorAll('.vp-btn').forEach(function (b) {
        b.classList.toggle('active', b === btn);
      });
      var stage = document.getElementById('cmsStage');
      stage.className = 'cms-stage vp-' + vp;
    });
  });

  // Inspector sub-tabs
  document.querySelectorAll('.ins-tab').forEach(function (t) {
    t.addEventListener('click', function () {
      var target = t.getAttribute('data-ins');
      document.querySelectorAll('.ins-tab').forEach(function (x) {
        x.classList.toggle('active', x === t);
      });
      document.querySelectorAll('.ins-panel').forEach(function (p) {
        p.classList.toggle('active', p.id === 'ins-' + target);
      });
    });
  });

  // Publish all pending CMS changes
  document.getElementById('cmsPublishBtn').addEventListener('click', async function () {
    var count = Object.keys(state.pendingCms).length;
    if (count === 0) {
      showToast('Không có thay đổi mới nào để xuất bản.');
      return;
    }
    try {
      var res = await api('/api/admin/cms', {
        method: 'PUT',
        body: { changes: state.pendingCms, note: 'Xuất bản ' + count + ' thay đổi từ Live Preview' },
      });
      state.pendingCms = {};
      state.cmsOverrides = res.overrides || {};
      updateDirtyBadge();
      showToast(res.message);
      initLivePreview();
    } catch (e) {
      showToast(e.message, true);
    }
  });

  // Reset single element
  document.getElementById('insResetOneBtn').addEventListener('click', async function () {
    if (!state.selectedCms) return;
    var key = state.selectedCms.key;
    delete state.pendingCms[key];
    updateDirtyBadge();
    try {
      await api('/api/admin/cms/' + encodeURIComponent(key), { method: 'DELETE' });
      showToast('Đã khôi phục ' + key + ' về mặc định.');
      document.getElementById('cmsIframe').contentWindow.location.reload();
    } catch (e) {
      showToast(e.message, true);
    }
  });

  // Reset all CMS overrides
  document.getElementById('cmsResetAllBtn').addEventListener('click', async function () {
    if (!confirm('Khôi phục toàn bộ Landing Page về giao diện mặc định ban đầu? (Bản sao lưu sẽ được tự động lưu trong Lịch sử)')) return;
    try {
      var res = await api('/api/admin/cms/reset-all', { method: 'POST' });
      state.pendingCms = {};
      updateDirtyBadge();
      showToast(res.message);
      document.getElementById('cmsIframe').contentWindow.location.reload();
      initLivePreview();
    } catch (e) {
      showToast(e.message, true);
    }
  });

  // Save SEO meta
  document.getElementById('saveSeoBtn').addEventListener('click', async function () {
    try {
      await api('/api/admin/cms', {
        method: 'PUT',
        body: {
          changes: {},
          seo: {
            site_title: document.getElementById('seoTitle').value.trim(),
            site_description: document.getElementById('seoDesc').value.trim(),
            og_image: document.getElementById('seoOgImage').value.trim(),
          },
        },
      });
      showToast('Đã lưu cấu hình SEO!');
    } catch (e) {
      showToast(e.message, true);
    }
  });

  function renderElementsList() {
    var type = document.getElementById('elFilterType').value;
    var q = document.getElementById('elFilterSearch').value.trim().toLowerCase();
    var filtered = state.cmsElements.filter(function (el) {
      if (type !== 'all' && el.type !== type) return false;
      if (q && !(el.preview || '').toLowerCase().includes(q) && !el.key.toLowerCase().includes(q)) return false;
      return true;
    });
    var ul = document.getElementById('cmsElementsList');
    ul.innerHTML = filtered
      .slice(0, 120)
      .map(function (el) {
        return (
          '<li data-key="' + esc(el.key) + '"><div class="el-top"><strong>' + esc(el.key) + '</strong><span class="badge">' + esc(el.type) + '</span></div>' +
          '<div class="el-prev">' + esc(el.preview || '(trống)') + '</div></li>'
        );
      })
      .join('');
    ul.querySelectorAll('li').forEach(function (li) {
      li.addEventListener('click', function () {
        sendToIframe({ type: 'CMS_HIGHLIGHT', payload: { key: li.getAttribute('data-key') } });
      });
    });
  }
  document.getElementById('elFilterType').addEventListener('change', renderElementsList);
  document.getElementById('elFilterSearch').addEventListener('input', renderElementsList);

  function renderRevisions(revs) {
    var ul = document.getElementById('cmsRevisionsList');
    ul.innerHTML = revs.length
      ? revs
          .map(function (r) {
            return (
              '<li><div><strong>#' + r.id + '</strong> · ' + esc(r.note) + '</div>' +
              '<div class="small muted">' + esc(r.created_at) + ' · ' + esc(r.created_by) +
              ' <button class="btn-link rev-restore" data-id="' + r.id + '">Khôi phục</button></div></li>'
            );
          })
          .join('')
      : '<li class="muted">Chưa có lịch sử chỉnh sửa.</li>';

    ul.querySelectorAll('.rev-restore').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        if (!confirm('Khôi phục phiên bản #' + btn.getAttribute('data-id') + '?')) return;
        try {
          var res = await api('/api/admin/cms/restore/' + btn.getAttribute('data-id'), { method: 'POST' });
          showToast(res.message);
          document.getElementById('cmsIframe').contentWindow.location.reload();
        } catch (e) {
          showToast(e.message, true);
        }
      });
    });
  }

  async function loadQuickMedia() {
    try {
      var data = await api('/api/admin/media');
      var all = (data.uploaded || []).concat(data.seedAssets || []);
      var grid = document.getElementById('quickMediaGrid');
      grid.innerHTML = all
        .slice(0, 32)
        .map(function (m) {
          return '<img src="' + esc(m.url) + '" title="' + esc(m.original_name || m.filename) + '" data-url="' + esc(m.url) + '" />';
        })
        .join('');
      grid.querySelectorAll('img').forEach(function (im) {
        im.addEventListener('click', function () {
          document.getElementById('editImgSrc').value = im.getAttribute('data-url');
          emitImageChange();
        });
      });
    } catch {}
  }

  /* ---------- TAB 5: MEDIA LIBRARY ---------- */
  async function loadMedia() {
    try {
      var data = await api('/api/admin/media');
      var upGrid = document.getElementById('uploadedMediaGrid');
      upGrid.innerHTML = data.uploaded.length
        ? data.uploaded
            .map(function (m) {
              return (
                '<div class="media-card"><img src="' + esc(m.url) + '" alt="" /><div class="mc-foot">' +
                '<button class="btn-link copy-url" data-url="' + esc(m.url) + '">Copy URL</button>' +
                '<button class="btn-link del-media" style="color:#f29d96" data-id="' + m.id + '">Xóa</button>' +
                '</div></div>'
              );
            })
            .join('')
        : '<p class="muted">Chưa có ảnh nào được tải lên.</p>';

      var seedGrid = document.getElementById('seedMediaGrid');
      seedGrid.innerHTML = data.seedAssets
        .map(function (m) {
          return (
            '<div class="media-card"><img src="' + esc(m.url) + '" alt="" /><div class="mc-foot">' +
            '<span class="muted">' + Math.round((m.bytes || 0) / 1024) + 'KB</span>' +
            '<button class="btn-link copy-url" data-url="' + esc(m.url) + '">Copy URL</button>' +
            '</div></div>'
          );
        })
        .join('');

      document.querySelectorAll('.copy-url').forEach(function (b) {
        b.addEventListener('click', function () {
          navigator.clipboard.writeText(b.getAttribute('data-url'));
          showToast('Đã copy đường dẫn ảnh!');
        });
      });
      document.querySelectorAll('.del-media').forEach(function (b) {
        b.addEventListener('click', async function () {
          if (!confirm('Xóa ảnh này khỏi máy chủ?')) return;
          try {
            await api('/api/admin/media/' + b.getAttribute('data-id'), { method: 'DELETE' });
            showToast('Đã xóa ảnh.');
            loadMedia();
          } catch (e) {
            showToast(e.message, true);
          }
        });
      });
    } catch (e) {
      showToast(e.message, true);
    }
  }

  document.getElementById('mediaUploadInput').addEventListener('change', async function () {
    var rawFile = this.files[0];
    if (!rawFile) return;
    try {
      var webpFile = await compressImageToWebp(rawFile, 1600, 0.82);
      var fd = new FormData();
      fd.append('file', webpFile);
      await api('/api/admin/media/upload', { method: 'POST', body: fd });
      var origKb = Math.max(1, Math.round(rawFile.size / 1024));
      var newKb = Math.max(1, Math.round(webpFile.size / 1024));
      showToast('Tải ảnh lên thành công (đã nén WebP: ' + origKb + 'KB → ' + newKb + 'KB)!');
      loadMedia();
    } catch (e) {
      showToast(e.message, true);
    } finally {
      this.value = '';
    }
  });

  /* ---------- TAB 6: SECURITY & AUDIT LOGS ---------- */
  async function loadAuditLogs() {
    try {
      var data = await api('/api/admin/audit-logs');
      document.getElementById('auditLogsBody').innerHTML = data.logs.length
        ? data.logs
            .map(function (l) {
              return (
                '<tr><td class="small">' + esc(l.created_at) + '</td>' +
                '<td><strong>' + esc(l.actor) + '</strong></td>' +
                '<td><span class="badge">' + esc(l.action) + '</span></td>' +
                '<td class="small">' + esc(l.target) + '</td>' +
                '<td class="small muted">' + esc(l.detail) + '</td>' +
                '<td class="small muted">' + esc(l.ip_address) + '</td></tr>'
              );
            })
            .join('')
        : '<tr><td colspan="6" class="muted">Chưa có nhật ký.</td></tr>';
    } catch (e) {
      showToast(e.message, true);
    }
  }

  document.getElementById('changePassForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    try {
      var res = await api('/api/auth/change-password', {
        method: 'POST',
        body: {
          currentPassword: document.getElementById('curPass').value,
          newPassword: document.getElementById('newPass').value,
        },
      });
      showToast(res.message);
      this.reset();
    } catch (err) {
      showToast(err.message, true);
    }
  });

  // Boot
  checkSession();
})();

