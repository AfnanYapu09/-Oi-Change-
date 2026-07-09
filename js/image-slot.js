/*
 * image-slot.js — a focused re-implementation of the design's <image-slot>.
 * Empty state shows "วาง / เลือกรูป · or browse files"; accepts click-to-browse,
 * drag-and-drop, and paste (when hovered). Images persist as data URLs in
 * localStorage keyed by the slot id, so they survive re-renders and reloads.
 *
 * Filled slots open a fullscreen viewer on tap (view / save-to-device / replace),
 * so it works the same on desktop, iPad and phones — no hover required.
 */
(function () {
  'use strict';

  var STORE_KEY = 'gcjournal_images_v1';
  function loadStore() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {}; }
    catch (e) { return {}; }
  }
  function saveStore(map) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(map)); return true; }
    catch (e) { return false; }
  }
  function getImage(id) { return loadStore()[id] || null; }
  function setImage(id, dataUrl) {
    var m = loadStore();
    if (dataUrl) m[id] = dataUrl; else delete m[id];
    return saveStore(m);
  }

  var ICON = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4.5" width="18" height="15" rx="2.5"></rect><circle cx="8.5" cy="10" r="1.6"></circle><path d="M4 17l4.5-4 3.5 3 3-3.5L20 17"></path></svg>';

  var hoveredSlot = null;

  function fileToDataUrl(file, cb) {
    if (!file || !/^image\//.test(file.type)) return;
    var reader = new FileReader();
    reader.onload = function () { cb(reader.result); };
    reader.readAsDataURL(file);
  }

  // ── save the image to the device ───────────────────────────────────────────
  var isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); // iPadOS 13+ reports as Mac
  function dataUrlToFile(dataUrl, filename) {
    var parts = dataUrl.split(','), m = parts[0].match(/:(.*?);/);
    var mime = m ? m[1] : 'image/png', bin = atob(parts[1]), n = bin.length, u8 = new Uint8Array(n);
    while (n--) u8[n] = bin.charCodeAt(n);
    return new File([u8], filename, { type: mime });
  }
  function extFor(dataUrl) {
    var m = dataUrl.match(/^data:image\/([a-z0-9+.-]+)/i); var e = m ? m[1].toLowerCase() : 'png';
    return e === 'jpeg' ? 'jpg' : e;
  }
  function filenameFor(slot, dataUrl) {
    var label = (slot.getAttribute('label') || 'chart').replace(/[^\w฀-๿+.-]+/g, '_');
    var dm = (slot.slotId || '').match(/\d{4}-\d{2}-\d{2}/);
    return label + (dm ? '-' + dm[0] : '') + '.' + extFor(dataUrl);
  }
  function saveImage(dataUrl, filename) {
    // iPad / phone: open the native share sheet ("Save Image / บันทึกภาพ").
    if (isMobile) {
      try {
        var file = dataUrlToFile(dataUrl, filename);
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          navigator.share({ files: [file] }).catch(function () {});
          return;
        }
      } catch (e) {}
      // Fallback: open the image full-screen so the user can long-press → Save.
      var w = window.open('', '_blank');
      if (w && w.document) { w.document.title = filename; w.document.body.style.margin = '0'; w.document.body.innerHTML = '<img src="' + dataUrl + '" style="max-width:100%;display:block;margin:auto">'; return; }
    }
    // Desktop: direct download.
    var a = document.createElement('a');
    a.href = dataUrl; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(function () { if (a.parentNode) a.parentNode.removeChild(a); }, 0);
  }

  // ── fullscreen viewer (one shared overlay, reused by every slot) ────────────
  var viewer = null, viewerSlot = null;
  function buildViewer() {
    viewer = document.createElement('div');
    viewer.className = 'img-viewer';
    viewer.innerHTML =
      '<div class="img-viewer-bar">' +
        '<button type="button" class="ivb-btn" data-act="save">' +
          '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><path d="M7 10l5 5 5-5"></path><path d="M12 15V3"></path></svg>' +
          '<span>บันทึกรูป</span></button>' +
        '<button type="button" class="ivb-btn" data-act="replace">' +
          '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 2v6h6"></path><path d="M3 13a9 9 0 1 0 3-7.7L3 8"></path></svg>' +
          '<span>เปลี่ยนรูป</span></button>' +
        '<button type="button" class="ivb-btn ivb-close" data-act="close" aria-label="ปิด">✕</button>' +
      '</div>' +
      '<img class="img-viewer-img" alt="">';
    document.body.appendChild(viewer);
    viewer.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-act]');
      var act = btn ? btn.dataset.act : null;
      if (!act) { if (e.target === viewer) closeViewer(); return; } // tap backdrop to close
      if (act === 'close') { closeViewer(); return; }
      if (act === 'save' && viewerSlot) { var url = getImage(viewerSlot.slotId); if (url) saveImage(url, filenameFor(viewerSlot, url)); return; }
      if (act === 'replace' && viewerSlot) { var s = viewerSlot; closeViewer(); s.browse(); return; }
    });
  }
  function openViewer(slot) {
    var url = getImage(slot.slotId); if (!url) return;
    if (!viewer) buildViewer();
    viewerSlot = slot;
    viewer.querySelector('.img-viewer-img').src = url;
    viewer.classList.add('open');
    document.addEventListener('keydown', onViewerKey);
  }
  function closeViewer() {
    if (!viewer) return;
    viewer.classList.remove('open');           // fade + scale out (CSS transition)
    viewerSlot = null;
    document.removeEventListener('keydown', onViewerKey);
    var im = viewer.querySelector('.img-viewer-img');
    setTimeout(function () { if (viewer && !viewer.classList.contains('open')) im.src = ''; }, 260); // free memory after the fade
  }
  function onViewerKey(e) { if (e.key === 'Escape') closeViewer(); }

  class ImageSlot extends HTMLElement {
    connectedCallback() {
      if (this._built) return;
      this._built = true;
      this.slotId = this.getAttribute('id') || ('slot-' + Math.random().toString(36).slice(2));
      this.placeholder = this.getAttribute('placeholder') || 'วาง / เลือกรูป';
      this.tabIndex = 0;
      this.render();
      this.wire();
    }

    render() {
      var img = getImage(this.slotId);
      this.className = 'image-slot ' + (img ? 'has-image' : 'is-empty');
      if (img) {
        this.innerHTML =
          '<img alt="" draggable="false" src="' + img + '">' +
          '<span class="slot-hint">แตะเพื่อดู</span>' +
          '<button class="slot-remove" type="button" aria-label="ลบรูป">✕</button>';
      } else {
        this.innerHTML =
          '<div class="slot-empty">' + ICON +
          '<div class="slot-cap">' + this.escape(this.placeholder) + '</div>' +
          '<div class="slot-sub">or <u>browse files</u></div></div>';
      }
    }

    escape(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

    wire() {
      var self = this;
      this.addEventListener('click', function (e) {
        if (e.target.closest('.slot-remove')) { e.stopPropagation(); self.clear(); return; }
        if (self.classList.contains('has-image')) openViewer(self);  // filled → view
        else self.browse();                                          // empty → pick
      });
      this.addEventListener('mouseenter', function () { hoveredSlot = self; });
      this.addEventListener('mouseleave', function () { if (hoveredSlot === self) hoveredSlot = null; });
      this.addEventListener('focus', function () { hoveredSlot = self; });
      this.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (self.classList.contains('has-image')) openViewer(self); else self.browse(); }
      });
      this.addEventListener('dragover', function (e) { e.preventDefault(); self.classList.add('is-dragover'); });
      this.addEventListener('dragleave', function () { self.classList.remove('is-dragover'); });
      this.addEventListener('drop', function (e) {
        e.preventDefault(); self.classList.remove('is-dragover');
        var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        fileToDataUrl(f, function (url) { self.store(url); });
      });
    }

    browse() {
      var self = this;
      var input = document.createElement('input');
      input.type = 'file'; input.accept = 'image/*';
      input.style.position = 'fixed'; input.style.left = '-9999px';  // in-DOM for iOS Safari
      input.onchange = function () { fileToDataUrl(input.files[0], function (url) { self.store(url); }); if (input.parentNode) input.parentNode.removeChild(input); };
      document.body.appendChild(input);
      input.click();
    }

    store(url) {
      var ok = setImage(this.slotId, url);
      if (!ok) { alert('พื้นที่จัดเก็บเต็ม — ไม่สามารถบันทึกรูปได้'); return; }
      this.render();
    }
    clear() { setImage(this.slotId, null); this.render(); }
  }

  if (!customElements.get('image-slot')) customElements.define('image-slot', ImageSlot);

  // Paste into whichever slot the pointer is over.
  document.addEventListener('paste', function (e) {
    if (!hoveredSlot) return;
    var items = (e.clipboardData || {}).items || [];
    for (var i = 0; i < items.length; i++) {
      if (items[i].type && items[i].type.indexOf('image') === 0) {
        var file = items[i].getAsFile();
        fileToDataUrl(file, function (url) { hoveredSlot && hoveredSlot.store(url); });
        e.preventDefault();
        break;
      }
    }
  });
})();
