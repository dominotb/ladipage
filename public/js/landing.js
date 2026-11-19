(function () {
  'use strict';

  var cfg = window.__DOMINO_CONFIG__ || {};
  var isPreview = !!cfg.previewMode;

  /* ---------- 1. Apply CMS Overrides on Load ---------- */
  function applyOverride(key, entry) {
    if (!entry || !entry.value) return;
    var el = document.querySelector('[data-cms-key="' + key + '"]');
    if (!el) return;
    var val = entry.value;

    if (entry.type === 'html' || entry.type === 'text') {
      if (typeof val.html === 'string') {
        el.innerHTML = val.html;
      }
    } else if (entry.type === 'image') {
      if (val.src) el.setAttribute('src', val.src);
      if (typeof val.alt === 'string') el.setAttribute('alt', val.alt);
      if (typeof val.caption === 'string') {
        var parentBtn = el.closest('[data-lightbox]');
        if (parentBtn) parentBtn.setAttribute('data-caption', val.caption);
      }
    } else if (entry.type === 'link') {
      if (val.href) el.setAttribute('href', val.href);
      if (val.target === '_blank') {
        el.setAttribute('target', '_blank');
        el.setAttribute('rel', 'noopener noreferrer');
      } else if (val.target === '_self') {
        el.removeAttribute('target');
        el.removeAttribute('rel');
      }
      if (typeof val.html === 'string' && val.html.trim() !== '') {
        // Keep nested <img> or <svg> intact if link wraps only icon/logo
        var hasMedia = el.querySelector('img, svg');
        if (!hasMedia) {
          el.innerHTML = val.html;
        }
      }
    } else if (entry.type === 'iframe') {
      if (val.src) el.setAttribute('src', val.src);
    }
  }

  if (cfg.cmsOverrides && typeof cfg.cmsOverrides === 'object') {
    Object.keys(cfg.cmsOverrides).forEach(function (k) {
      applyOverride(k, cfg.cmsOverrides[k]);
    });
  }
  window.__applyCmsOverride = applyOverride;

  /* ---------- 2. Header Scroll & Mobile Menu ---------- */
  var header = document.getElementById('siteHeader');
  function onScroll() {
    if (header) header.classList.toggle('scrolled', window.scrollY > 15);
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  var navToggle = document.getElementById('navToggle');
  function setMenu(open) {
    if (!header || !navToggle) return;
    header.classList.toggle('menu-open', open);
    navToggle.setAttribute('aria-expanded', open);
    navToggle.setAttribute('aria-label', open ? 'Đóng menu' : 'Mở menu');
  }
  if (navToggle) {
    navToggle.addEventListener('click', function () {
      setMenu(!header.classList.contains('menu-open'));
    });
  }
  document.querySelectorAll('#mainMenu a').forEach(function (a) {
    a.addEventListener('click', function () {
      setMenu(false);
    });
  });
  window.addEventListener('resize', function () {
    if (window.innerWidth >= 900 || window.innerWidth <= 768) setMenu(false);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') setMenu(false);
  });

  /* ---------- 3. Bottom Nav Scroll-Spy ---------- */
  var bnItems = Array.prototype.slice.call(document.querySelectorAll('.bn-item'));
  function setActiveBn(id) {
    bnItems.forEach(function (it) {
      it.classList.toggle('active', it.getAttribute('data-spy') === id);
    });
  }
  bnItems.forEach(function (it) {
    it.addEventListener('click', function () {
      setActiveBn(it.getAttribute('data-spy'));
    });
  });
  var spyIds = ['ve-domino', 'san-pham', 'cong-trinh', 'bao-hanh', 'dang-ky'];
  var spyEls = spyIds
    .map(function (id) {
      return document.getElementById(id);
    })
    .filter(Boolean)
    .sort(function (a, b) {
      return a.offsetTop - b.offsetTop;
    });
  var ticking = false;
  function spyOnScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      ticking = false;
      var pos = window.scrollY + window.innerHeight * 0.35;
      var current = null;
      spyEls.forEach(function (el) {
        if (el.offsetTop <= pos) current = el.id;
      });
      if (current) setActiveBn(current);
    });
  }
  window.addEventListener('scroll', spyOnScroll, { passive: true });
  spyOnScroll();

  /* ---------- 4. Gallery Lightbox ---------- */
  var lb = document.getElementById('lightbox');
  var lbSlot = document.getElementById('lbSlot');
  var lbCap = document.getElementById('lbCap');
  var lbCount = document.getElementById('lbCount');
  var lbImg = null;
  var lbBtns = Array.prototype.slice.call(document.querySelectorAll('[data-lightbox]'));
  var lbIdx = 0;
  var lastFocus = null;

  function showLb(i) {
    lbIdx = (i + lbBtns.length) % lbBtns.length;
    var btn = lbBtns[lbIdx];
    var img = btn.querySelector('img');
    if (!lbImg) {
      lbImg = document.createElement('img');
      lbSlot.appendChild(lbImg);
    }
    lbImg.src = img ? img.src : '';
    lbImg.alt = img ? img.alt : '';
    lbCap.textContent = btn.getAttribute('data-caption') || '';
    lbCount.textContent = lbIdx + 1 + ' / ' + lbBtns.length;
  }
  function openLb(btn) {
    if (isPreview) return; // In CMS preview, clicking image selects it for editing
    lastFocus = btn;
    showLb(lbBtns.indexOf(btn));
    lb.classList.add('open');
    document.body.style.overflow = 'hidden';
    document.getElementById('lbClose').focus();
  }
  function closeLb() {
    lb.classList.remove('open');
    if (lbImg) {
      lbImg.remove();
      lbImg = null;
    }
    document.body.style.overflow = '';
    if (lastFocus) lastFocus.focus();
  }
  lbBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      openLb(btn);
    });
  });
  if (lb) {
    document.getElementById('lbClose').addEventListener('click', closeLb);
    document.getElementById('lbPrev').addEventListener('click', function () {
      showLb(lbIdx - 1);
    });
    document.getElementById('lbNext').addEventListener('click', function () {
      showLb(lbIdx + 1);
    });
    lb.addEventListener('click', function (e) {
      if (e.target === lb) closeLb();
    });
    document.addEventListener('keydown', function (e) {
      if (!lb.classList.contains('open')) return;
      if (e.key === 'Escape') closeLb();
      if (e.key === 'ArrowLeft') showLb(lbIdx - 1);
      if (e.key === 'ArrowRight') showLb(lbIdx + 1);
    });
    var tx = null;
    lb.addEventListener(
      'touchstart',
      function (e) {
        tx = e.touches[0].clientX;
      },
      { passive: true }
    );
    lb.addEventListener('touchend', function (e) {
      if (tx === null) return;
      var dx = e.changedTouches[0].clientX - tx;
      tx = null;
      if (Math.abs(dx) > 50) showLb(lbIdx + (dx < 0 ? 1 : -1));
    });
  }

  /* ---------- 5. Floating Contact FAB Visibility ---------- */
  var stickyCta = document.querySelector('.contact-fab');
  var heroEl = document.getElementById('top');
  var formEl = document.getElementById('dang-ky');
  var footEl = document.querySelector('footer');
  function toggleSticky() {
    if (!stickyCta || !heroEl || !formEl || !footEl) return;
    var h = heroEl.getBoundingClientRect();
    var f = formEl.getBoundingClientRect();
    var ft = footEl.getBoundingClientRect();
    var vh = window.innerHeight;
    var pastHero = h.bottom < vh * 0.3;
    var atForm = f.top < vh * 0.8 && f.bottom > 0;
    var atFoot = ft.top < vh * 0.8;
    stickyCta.classList.toggle('show', window.innerWidth > 768 || (pastHero && !atForm && !atFoot));
  }
  window.addEventListener('scroll', toggleSticky, { passive: true });
  window.addEventListener('resize', toggleSticky);
  toggleSticky();

  /* ---------- 6. Privacy & FAQ Accordions ---------- */
  var priv = document.getElementById('chinh-sach-bao-mat');
  if (priv) {
    document.querySelectorAll('a[href="#chinh-sach-bao-mat"]').forEach(function (a) {
      a.addEventListener('click', function () {
        if (!isPreview) priv.open = true;
      });
    });
    if (location.hash === '#chinh-sach-bao-mat') priv.open = true;
    priv.addEventListener('toggle', function () {
      if (priv.open) priv.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  var faqItems = Array.prototype.slice.call(document.querySelectorAll('#faqList details'));
  faqItems.forEach(function (d) {
    d.addEventListener('toggle', function () {
      if (d.open) {
        faqItems.forEach(function (o) {
          if (o !== d) o.open = false;
        });
      }
    });
  });

  /* ---------- 7. Attribution & Facebook Tracking Helpers ---------- */
  function getCookie(name) {
    var m = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/([.$?*|{}()[\]\\/+^])/g, '\\$1') + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : '';
  }

  function generateUuid() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    return 'evt-' + Date.now() + '-' + Math.random().toString(16).slice(2, 12);
  }

  function collectAttribution() {
    var params = new URLSearchParams(window.location.search);
    var keys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid'];
    var stored = {};
    try {
      stored = JSON.parse(sessionStorage.getItem('domino_attr') || '{}');
    } catch (e) {
      stored = {};
    }
    keys.forEach(function (k) {
      var v = params.get(k);
      if (v) stored[k] = v;
    });
    if (!stored.landing_url) stored.landing_url = window.location.href;
    if (!stored.referrer && document.referrer) stored.referrer = document.referrer;
    try {
      sessionStorage.setItem('domino_attr', JSON.stringify(stored));
    } catch (e) {}

    stored.fbp = getCookie('_fbp');
    stored.fbc = getCookie('_fbc') || (stored.fbclid ? 'fb.1.' + Date.now() + '.' + stored.fbclid : '');
    return stored;
  }

  var attribution = collectAttribution();

  function trackContactAction(label) {
    if (isPreview) return;
    var eventId = generateUuid();
    if (typeof window.fbq === 'function' && cfg.fbPixelEnabled) {
      window.fbq('track', 'Contact', { content_name: label }, { eventID: eventId });
    }
    try {
      var payload = JSON.stringify({
        event_name: 'Contact',
        event_id: eventId,
        label: label,
        fbclid: attribution.fbclid || '',
        fbp: attribution.fbp || '',
        fbc: attribution.fbc || '',
        utm_source: attribution.utm_source || '',
        utm_campaign: attribution.utm_campaign || '',
        landing_url: window.location.href,
      });
      if (navigator.sendBeacon) {
        navigator.sendBeacon('/api/track', new Blob([payload], { type: 'application/json' }));
      } else {
        fetch('/api/track', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
          keepalive: true,
        }).catch(function () {});
      }
    } catch (e) {}
  }

  document.querySelectorAll('.contact-fab a, a[href^="tel:"], a[href*="zalo.me"], a[href*="m.me"]').forEach(function (a) {
    a.addEventListener('click', function () {
      var label = a.getAttribute('title') || a.getAttribute('aria-label') || a.textContent.trim() || 'Contact';
      trackContactAction(label);
    });
  });

  /* ---------- 8. International Phone Input + Live Validation + Duplicate Check ---------- */
  var countrySelect = document.getElementById('inp-country');
  var phoneInput = document.getElementById('inp-phone');
  var phoneField = document.getElementById('f-phone');
  var phoneHint = document.getElementById('phoneHint');
  var phoneErr = document.getElementById('phoneErr');
  var phoneOk = document.getElementById('phoneOk');
  var countries = Array.isArray(cfg.countries) ? cfg.countries : [];

  function populateCountries() {
    if (!countrySelect || !countries.length) return;
    countrySelect.innerHTML = '';
    countries.forEach(function (c) {
      var opt = document.createElement('option');
      opt.value = c.iso;
      opt.textContent = c.flag + ' ' + c.dialCode + ' ' + c.name;
      if (c.iso === 'VN') opt.selected = true;
      countrySelect.appendChild(opt);
    });
    updateCountryHint();
  }

  function getSelectedCountry() {
    var iso = countrySelect ? countrySelect.value : 'VN';
    for (var i = 0; i < countries.length; i++) {
      if (countries[i].iso === iso) return countries[i];
    }
    return { iso: 'VN', name: 'Việt Nam', dialCode: '+84', placeholder: '0967 862 545' };
  }

  function updateCountryHint() {
    var c = getSelectedCountry();
    if (phoneInput) phoneInput.placeholder = 'Ví dụ: ' + c.placeholder;
    if (phoneHint) {
      phoneHint.textContent =
        'Định dạng ' + c.name + ' (' + c.dialCode + ') — ví dụ: ' + c.placeholder + '. Kiểm tra tự động độ dài và trùng lặp.';
    }
  }

  populateCountries();

  var lastCheckedPhoneKey = '';
  var lastPhoneStatus = null; // { valid, duplicate, message }
  var phoneCheckTimer = null;

  function setPhoneState(state, message) {
    if (!phoneField) return;
    phoneField.classList.remove('invalid', 'valid');
    if (state === 'invalid') {
      phoneField.classList.add('invalid');
      if (phoneErr) phoneErr.textContent = message || 'Số điện thoại không hợp lệ.';
    } else if (state === 'valid') {
      phoneField.classList.add('valid');
      if (phoneOk) phoneOk.textContent = message || '✓ Số điện thoại hợp lệ và sẵn sàng đăng ký.';
    }
  }

  async function verifyPhoneRemote(showEmptyError) {
    if (!phoneInput) return { valid: false };
    var raw = phoneInput.value.trim();
    var iso = countrySelect ? countrySelect.value : 'VN';
    if (!raw) {
      lastCheckedPhoneKey = '';
      lastPhoneStatus = null;
      if (showEmptyError) setPhoneState('invalid', 'Vui lòng nhập số điện thoại.');
      else setPhoneState('neutral');
      return { valid: false, message: 'Vui lòng nhập số điện thoại.' };
    }

    var cacheKey = iso + '|' + raw;
    if (cacheKey === lastCheckedPhoneKey && lastPhoneStatus) {
      return lastPhoneStatus;
    }

    try {
      var res = await fetch('/api/leads/check-phone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: raw, countryIso: iso }),
      });
      var data = await res.json();
      lastCheckedPhoneKey = cacheKey;

      if (!res.ok || !data.valid) {
        lastPhoneStatus = { valid: false, duplicate: false, message: data.message };
        setPhoneState('invalid', data.message);
        return lastPhoneStatus;
      }

      if (data.duplicate) {
        lastPhoneStatus = { valid: false, duplicate: true, message: data.message };
        setPhoneState('invalid', data.message);
        return lastPhoneStatus;
      }

      lastPhoneStatus = { valid: true, duplicate: false, data: data };
      setPhoneState('valid', '✓ Hợp lệ (' + data.international + ') — chưa trùng trong hệ thống.');
      return lastPhoneStatus;
    } catch (e) {
      return { valid: true, fallback: true };
    }
  }

  if (countrySelect) {
    countrySelect.addEventListener('change', function () {
      updateCountryHint();
      lastCheckedPhoneKey = '';
      if (phoneInput && phoneInput.value.trim()) {
        verifyPhoneRemote(false);
      }
    });
  }

  if (phoneInput) {
    phoneInput.addEventListener('input', function () {
      phoneField.classList.remove('invalid', 'valid');
      lastCheckedPhoneKey = '';
      clearTimeout(phoneCheckTimer);
      if (phoneInput.value.trim().length >= 7) {
        phoneCheckTimer = setTimeout(function () {
          verifyPhoneRemote(false);
        }, 550);
      }
    });
    phoneInput.addEventListener('blur', function () {
      if (phoneInput.value.trim()) {
        verifyPhoneRemote(false);
      }
    });
  }

  /* ---------- 9. Lead Form Submission ---------- */
  var leadForm = document.getElementById('leadForm');
  var submitBtn = document.getElementById('submitBtn');
  var formNotice = document.getElementById('formNotice');
  var submitting = false;

  if (leadForm) {
    document.getElementById('inp-name').addEventListener('input', function () {
      this.closest('.field').classList.remove('invalid');
    });

    leadForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      if (isPreview || submitting) return;

      var nameEl = document.getElementById('inp-name');
      var name = nameEl.value.trim();
      var nameOk = name.length >= 2;
      document.getElementById('f-name').classList.toggle('invalid', !nameOk);

      var phoneResult = await verifyPhoneRemote(true);
      if (!nameOk || !phoneResult.valid) {
        if (!nameOk) nameEl.focus();
        else if (phoneInput) phoneInput.focus();
        return;
      }

      submitting = true;
      submitBtn.disabled = true;
      submitBtn.textContent = 'Đang gửi thông tin…';
      formNotice.className = 'form-notice';
      formNotice.innerHTML = '';

      var eventId = generateUuid();
      var payload = {
        name: name,
        phone: phoneInput.value.trim(),
        countryIso: countrySelect ? countrySelect.value : 'VN',
        stage: document.getElementById('inp-stage').value,
        area: document.getElementById('inp-area').value.trim(),
        need: document.getElementById('inp-need').value.trim(),
        website_url: (document.getElementById('inp-website') || {}).value || '',
        event_id: eventId,
        utm_source: attribution.utm_source || '',
        utm_medium: attribution.utm_medium || '',
        utm_campaign: attribution.utm_campaign || '',
        utm_content: attribution.utm_content || '',
        utm_term: attribution.utm_term || '',
        fbclid: attribution.fbclid || '',
        fbp: attribution.fbp || '',
        fbc: attribution.fbc || '',
        landing_url: window.location.href,
        referrer: attribution.referrer || document.referrer || '',
      };

      try {
        var res = await fetch('/api/leads', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        var data = await res.json();

        if (!res.ok || !data.ok) {
          submitting = false;
          submitBtn.disabled = false;
          submitBtn.textContent = 'Gửi yêu cầu tư vấn';

          if (data.field === 'phone') {
            setPhoneState('invalid', data.message);
            phoneInput.focus();
          } else if (data.field === 'name') {
            document.getElementById('f-name').classList.add('invalid');
            nameEl.focus();
          }

          formNotice.className = 'form-notice show error';
          formNotice.textContent = data.message || 'Không thể gửi đăng ký. Vui lòng thử lại.';
          return;
        }

        // Fire deduplicated Facebook Pixel Lead event
        if (typeof window.fbq === 'function' && cfg.fbPixelEnabled) {
          window.fbq(
            'track',
            'Lead',
            {
              content_name: 'DOMINO Tủ bếp INOX cánh kính',
              content_category: payload.stage || 'Tu van tu bep',
              value: cfg.fbLeadValue || 0,
              currency: cfg.fbCurrency || 'VND',
            },
            { eventID: data.eventId || eventId }
          );
        }

        formNotice.className = 'form-notice show success';
        formNotice.innerHTML =
          '<strong>✓ Đăng ký thành công!</strong><br>' +
          (data.message || 'DOMINO đã ghi nhận thông tin và sẽ liên hệ sớm nhất.') +
          '<br><a class="btn btn-gold" href="https://m.me/412021982591419" target="_blank" rel="noopener">Nhắn tin Messenger ngay <span class="arr">→</span></a>';
        formNotice.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

        submitBtn.textContent = 'Đã gửi yêu cầu tư vấn ✓';
        leadForm.reset();
        populateCountries();
        setPhoneState('neutral');
      } catch (err) {
        submitting = false;
        submitBtn.disabled = false;
        submitBtn.textContent = 'Gửi yêu cầu tư vấn';
        formNotice.className = 'form-notice show error';
        formNotice.textContent = 'Lỗi kết nối mạng. Vui lòng kiểm tra kết nối và thử lại.';
      }
    });
  }
})();

