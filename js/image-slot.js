/*
 * image-slot.js — a focused re-implementation of the design's <image-slot>.
 * Empty state shows "วาง / เลือกรูป · or browse files"; accepts click-to-browse,
 * drag-and-drop, and paste (when hovered). Images persist as data URLs in
 * localStorage keyed by the slot id, so they survive re-renders and reloads.
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
        self.browse();
      });
      this.addEventListener('mouseenter', function () { hoveredSlot = self; });
      this.addEventListener('mouseleave', function () { if (hoveredSlot === self) hoveredSlot = null; });
      this.addEventListener('focus', function () { hoveredSlot = self; });
      this.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); self.browse(); }
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
      input.onchange = function () { fileToDataUrl(input.files[0], function (url) { self.store(url); }); };
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
