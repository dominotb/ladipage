(function () {
  'use strict';

  // Only active when embedded inside Admin CMS Live Preview iframe
  if (window.parent === window) return;

  var style = document.createElement('style');
  style.textContent = [
    '[data-cms-key]{position:relative;transition:outline-color .15s,box-shadow .15s;cursor:pointer!important}',
    '[data-cms-key]:hover{outline:2px dashed #dcbc82!important;outline-offset:3px}',
    '[data-cms-key].cms-selected{outline:2px solid #c6a15f!important;outline-offset:3px;box-shadow:0 0 0 4px rgba(198,161,95,.28)!important}',
    '.cms-hover-badge{position:fixed;z-index:99999;pointer-events:none;background:#c6a15f;color:#17130a;font-family:Inter,sans-serif;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;padding:3px 8px;border-radius:4px;box-shadow:0 4px 12px rgba(0,0,0,.4);display:none}',
  ].join('');
  document.head.appendChild(style);

  var badge = document.createElement('div');
  badge.className = 'cms-hover-badge';
  document.body.appendChild(badge);

  var typeLabels = {
    html: 'Sửa Text',
    text: 'Sửa Text',
    image: 'Sửa Ảnh',
    link: 'Sửa Link',
    iframe: 'Sửa Bản đồ',
  };

  var selectedEl = null;

  function findCmsTarget(el) {
    if (!el || el === document.body || el === document.documentElement) return null;
    // Prefer direct image if clicked on img inside a link/button
    if (el.tagName === 'IMG' && el.hasAttribute('data-cms-key')) return el;
    return el.closest('[data-cms-key]');
  }

  function extractElementData(el) {
    var key = el.getAttribute('data-cms-key');
    var cmsType = el.getAttribute('data-cms-type') || 'html';
    var data = {
      key: key,
      cmsType: cmsType,
      tagName: el.tagName.toLowerCase(),
    };

    if (cmsType === 'image') {
      var parentBtn = el.closest('[data-lightbox]');
      data.value = {
        src: el.getAttribute('src') || '',
        alt: el.getAttribute('alt') || '',
        caption: parentBtn ? parentBtn.getAttribute('data-caption') || '' : '',
      };
    } else if (cmsType === 'link') {
      data.value = {
        href: el.getAttribute('href') || '',
        html: el.innerHTML,
        target: el.getAttribute('target') === '_blank' ? '_blank' : '_self',
        hasMedia: !!el.querySelector('img, svg'),
      };
    } else if (cmsType === 'iframe') {
      data.value = {
        src: el.getAttribute('src') || '',
      };
    } else {
      data.value = {
        html: el.innerHTML,
      };
    }
    return data;
  }

  // Hover highlight badge
  document.addEventListener(
    'mousemove',
    function (e) {
      var target = findCmsTarget(e.target);
      if (!target) {
        badge.style.display = 'none';
        return;
      }
      var type = target.getAttribute('data-cms-type') || 'html';
      var key = target.getAttribute('data-cms-key');
      badge.textContent = (typeLabels[type] || 'Sửa') + ' · ' + key;
      var rect = target.getBoundingClientRect();
      badge.style.left = Math.max(6, Math.min(window.innerWidth - 150, rect.left)) + 'px';
      badge.style.top = Math.max(6, rect.top - 24) + 'px';
      badge.style.display = 'block';
    },
    { passive: true }
  );

  // Intercept clicks to select element in CMS Inspector
  document.addEventListener(
    'click',
    function (e) {
      var target = findCmsTarget(e.target);
      if (!target) return;
      e.preventDefault();
      e.stopPropagation();

      if (selectedEl) selectedEl.classList.remove('cms-selected');
      selectedEl = target;
      selectedEl.classList.add('cms-selected');

      var payload = extractElementData(target);
      window.parent.postMessage({ type: 'CMS_SELECT', payload: payload }, window.location.origin);
    },
    true
  );

  // Listen to commands from Admin CMS parent window
  window.addEventListener('message', function (e) {
    if (e.origin !== window.location.origin) return;
    var msg = e.data || {};

    if (msg.type === 'CMS_APPLY_LIVE' && msg.payload) {
      var p = msg.payload;
      if (typeof window.__applyCmsOverride === 'function') {
        window.__applyCmsOverride(p.key, { type: p.cmsType, value: p.value });
      }
    } else if (msg.type === 'CMS_HIGHLIGHT' && msg.payload) {
      var el = document.querySelector('[data-cms-key="' + msg.payload.key + '"]');
      if (el) {
        if (selectedEl) selectedEl.classList.remove('cms-selected');
        selectedEl = el;
        el.classList.add('cms-selected');
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        window.parent.postMessage(
          { type: 'CMS_SELECT', payload: extractElementData(el) },
          window.location.origin
        );
      }
    } else if (msg.type === 'CMS_LIST_ELEMENTS') {
      var list = Array.prototype.slice
        .call(document.querySelectorAll('[data-cms-key]'))
        .map(function (el) {
          var t = el.getAttribute('data-cms-type') || 'html';
          var preview =
            t === 'image'
              ? el.getAttribute('alt') || el.getAttribute('src')
              : t === 'iframe'
              ? 'Google Maps Embed'
              : (el.textContent || '').trim().slice(0, 60);
          return {
            key: el.getAttribute('data-cms-key'),
            type: t,
            tag: el.tagName.toLowerCase(),
            preview: preview,
          };
        });
      window.parent.postMessage({ type: 'CMS_ELEMENTS_LIST', payload: list }, window.location.origin);
    }
  });

  // Notify parent that preview bridge is ready
  window.parent.postMessage({ type: 'CMS_BRIDGE_READY' }, window.location.origin);
})();

