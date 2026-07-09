/*
 * image-slot.js — a focused re-implementation of the design's <image-slot>.
 * Empty state shows "วาง / เลือกรูป · or browse files"; accepts click-to-browse,
 * drag-and-drop, and paste (when hovered). Images persist in IndexedDB (database
 * "gcjournal_images_db", store "images", keyed by slot id), mirrored into an
 * in-memory Map so every existing call site (render, openViewer, etc.) can keep
 * reading images SYNCHRONOUSLY via getImage() — only the one-time boot load (plus
 * a one-time migration from the old localStorage key) and the background writes
 * are async. IndexedDB's much larger quota (vs. localStorage's ~5MB on iOS
 * Safari) is what actually fixes the "storage full after ~5 photos" bug; new
 * uploads are additionally downscaled/re-encoded via canvas when large, to keep
 * typical chart screenshots small on disk.
 *
 * Boot contract: window.ImageStore.ready is a Promise that resolves once the
 * in-memory Map is fully populated (migration, if any, included). app.js awaits
 * it (alongside window.Store.load) before flipping S.ready = true, so the
 * loading screen covers image warm-up too — no flash of missing images.
 *
 * Filled slots open a fullscreen viewer on tap (view / save-to-device / replace),
 * so it works the same on desktop, iPad and phones — no hover required.
 */
(function () {
  'use strict';

  // ── IndexedDB-backed image store, mirrored into a synchronous in-memory Map ──
  var LEGACY_KEY = 'gcjournal_images_v1';   // old localStorage blob (pre-migration)
  var DB_NAME = 'gcjournal_images_db';
  var DB_STORE = 'images';
  var DB_VERSION = 1;

  var imageCache = new Map();               // slotId -> dataURL; sole source of truth for getImage()
  var dbPromise = null;

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      if (!window.indexedDB) { reject(new Error('IndexedDB unavailable')); return; }
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('IndexedDB open failed')); };
    });
    return dbPromise;
  }
  function idbGetAll(db) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(DB_STORE, 'readonly');
      var store = tx.objectStore(DB_STORE);
      var keysReq = store.getAllKeys(), valsReq = store.getAll();
      tx.oncomplete = function () {
        var keys = keysReq.result || [], vals = valsReq.result || [], out = [];
        for (var i = 0; i < keys.length; i++) out.push([keys[i], vals[i]]);
        resolve(out);
      };
      tx.onerror = function () { reject(tx.error); };
    });
  }
  function idbPut(db, id, dataUrl) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).put(dataUrl, id);
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(tx.error); };
    });
  }
  function idbDelete(db, id) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).delete(id);
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(tx.error); };
    });
  }
  function idbPutMany(db, entries) {   // [[id, dataUrl], ...] — single all-or-nothing transaction
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(DB_STORE, 'readwrite');
      var store = tx.objectStore(DB_STORE);
      entries.forEach(function (e) { store.put(e[1], e[0]); });
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(tx.error); };
    });
  }
  // One-time boot: migrate any pre-existing localStorage images into IndexedDB
  // (lossless — the old key is only cleared once every entry is confirmed
  // written), then populate imageCache from IndexedDB. If IndexedDB itself is
  // unavailable, or the migration write fails partway, the old localStorage
  // data is left untouched and served from memory for this session instead.
  function migrateAndLoad() {
    var legacyRaw = null;
    try { legacyRaw = localStorage.getItem(LEGACY_KEY); } catch (e) {}
    return openDb().then(function (db) {
      // Always read what's already in IndexedDB first. This makes migration
      // idempotent/merge-safe: if a previous migration wrote everything to
      // IndexedDB but the subsequent localStorage.removeItem(LEGACY_KEY) call
      // itself threw (leaving the stale legacy blob in place), re-running this
      // on a later boot must NOT blindly re-copy the old entries over slot ids
      // that already hold newer data in IndexedDB.
      return idbGetAll(db).then(function (existing) {
        existing.forEach(function (e) { imageCache.set(e[0], e[1]); });
        if (!legacyRaw) return;
        var legacyMap;
        try { legacyMap = JSON.parse(legacyRaw) || {}; } catch (e) { legacyMap = {}; }
        var existingKeys = {};
        existing.forEach(function (e) { existingKeys[e[0]] = true; });
        var entries = Object.keys(legacyMap)
          .filter(function (k) { return !existingKeys[k]; }) // never clobber data already in IndexedDB
          .map(function (k) { return [k, legacyMap[k]]; });
        if (!entries.length) {
          // Nothing left to migrate (either the blob was empty, or every key it
          // held already exists in IndexedDB from a prior successful migration)
          // — safe to drop the legacy key now.
          try { localStorage.removeItem(LEGACY_KEY); } catch (e) {}
          return;
        }
        return idbPutMany(db, entries).then(function () {
          entries.forEach(function (e) { imageCache.set(e[0], e[1]); });
          try { localStorage.removeItem(LEGACY_KEY); } catch (e) {}
          console.info('[ImageStore] migrated ' + entries.length + ' image(s) from localStorage to IndexedDB.');
        }).catch(function (err) {
          console.error('[ImageStore] migration to IndexedDB failed partway — leaving the old localStorage data ' +
            '("' + LEGACY_KEY + '") intact so nothing is lost; serving those images from memory for this session only.', err);
          entries.forEach(function (e) { imageCache.set(e[0], e[1]); });
        });
      });
    }).catch(function (err) {
      console.error('[ImageStore] IndexedDB unavailable — falling back to localStorage for this session; ' +
        'the old key is left in place untouched.', err);
      if (legacyRaw) {
        try {
          var m = JSON.parse(legacyRaw) || {};
          Object.keys(m).forEach(function (k) { imageCache.set(k, m[k]); });
        } catch (e) {}
      }
    });
  }

  // Exposed boot-readiness hook: app.js awaits this (alongside Store.load) before render.
  window.ImageStore = { ready: migrateAndLoad() };

  function getImage(id) { return imageCache.has(id) ? imageCache.get(id) : null; }

  // Latches to a single alert per session if background persistence starts
  // failing (e.g. IndexedDB itself is out of quota, or unavailable in this
  // browsing context) — cleared again the next time a write actually
  // succeeds, so a later *new* failure can still surface a fresh warning.
  // Without this, a real persistence failure would previously be swallowed
  // into a console.warn only: the UI shows the image as saved (the Map/UI
  // already reflect it synchronously) but it silently evaporates on the next
  // reload/tab close with zero indication to the user — a data-loss risk.
  var persistFailureWarned = false;
  function setImage(id, dataUrl) {
    if (dataUrl) imageCache.set(id, dataUrl); else imageCache.delete(id);
    // Persist in the background — the Map (and thus the UI) is already up to
    // date, so a slow or failing IndexedDB write must never block the caller.
    // The outcome is still surfaced to the user (once) on failure, below.
    var writeDone = openDb().then(function (db) { return dataUrl ? idbPut(db, id, dataUrl) : idbDelete(db, id); });
    writeDone.then(function () {
      persistFailureWarned = false; // writes are working again — allow a future failure to warn anew
    }, function (err) {
      console.warn('[ImageStore] failed to persist image "' + id + '" to IndexedDB — it exists only in memory ' +
        'for this session and will be LOST on reload or tab close:', err);
      if (dataUrl && !persistFailureWarned) {
        persistFailureWarned = true;
        alert('ไม่สามารถบันทึกรูปลงเครื่องอย่างถาวรได้ (พื้นที่จัดเก็บอาจเต็มหรือใช้งานไม่ได้)\n' +
          'รูปนี้จะแสดงอยู่ในหน้านี้เท่านั้น และจะหายไปเมื่อปิดหรือรีเฟรชหน้า — กรุณาลบรูปเก่าที่ไม่จำเป็น หรือบันทึกรูปนี้ไว้ที่อื่นก่อน');
      }
    });
    return writeDone;
  }

  var ICON = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4.5" width="18" height="15" rx="2.5"></rect><circle cx="8.5" cy="10" r="1.6"></circle><path d="M4 17l4.5-4 3.5 3 3-3.5L20 17"></path></svg>';

  var hoveredSlot = null;

  // ── downscale/re-encode freshly-picked uploads only (never images being read
  // back for display/replace/migration) ───────────────────────────────────────
  var COMPRESS_MAX_DIM = 1600;
  var COMPRESS_QUALITY = 0.82;
  function compressIfNeeded(dataUrl, cb) {
    var img = new Image();
    img.onload = function () {
      var w = img.naturalWidth, h = img.naturalHeight;
      if (w <= COMPRESS_MAX_DIM && h <= COMPRESS_MAX_DIM) { cb(dataUrl); return; } // already small: skip re-encoding
      var scale = COMPRESS_MAX_DIM / Math.max(w, h);
      var tw = Math.max(1, Math.round(w * scale)), th = Math.max(1, Math.round(h * scale));
      try {
        var canvas = document.createElement('canvas');
        canvas.width = tw; canvas.height = th;
        canvas.getContext('2d').drawImage(img, 0, 0, tw, th);
        cb(canvas.toDataURL('image/jpeg', COMPRESS_QUALITY));
      } catch (e) {
        console.warn('[ImageStore] compression failed, storing original image:', e);
        cb(dataUrl);
      }
    };
    img.onerror = function () { cb(dataUrl); }; // couldn't decode for resizing — store as-is rather than lose it
    img.src = dataUrl;
  }

  function fileToDataUrl(file, cb) {
    if (!file || !/^image\//.test(file.type)) return;
    var reader = new FileReader();
    reader.onload = function () { compressIfNeeded(reader.result, cb); };
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
      // setImage() updates the in-memory cache synchronously (so render()
      // below always reflects it immediately) and persists to IndexedDB in
      // the background; if that background write fails, setImage() itself
      // surfaces a one-time warning to the user — see its definition.
      setImage(this.slotId, url);
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
