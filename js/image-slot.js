/*
 * image-slot.js — a focused re-implementation of the design's <image-slot>.
 * Empty state shows "วาง / เลือกรูป · or browse files"; accepts click-to-browse,
 * drag-and-drop, and paste (when hovered).
 *
 * Two-layer persistence, mirroring store.js's local+cloud philosophy:
 *   • LOCAL (always on) — images live in IndexedDB (database "gcjournal_images_db",
 *     store "images", keyed by slot id), mirrored into an in-memory Map so every
 *     existing call site (render, openViewer, etc.) can keep reading images
 *     SYNCHRONOUSLY via getImage() — only the one-time boot load (plus a one-time
 *     migration from the old localStorage key) and the background writes are
 *     async. IndexedDB's much larger quota (vs. localStorage's ~5MB on iOS
 *     Safari) is what actually fixes the "storage full after ~5 photos" bug; new
 *     uploads are additionally downscaled/re-encoded via canvas when large, to
 *     keep typical chart screenshots small on disk.
 *   • CLOUD (only when window.APP_CONFIG has a URL + anon key, same detection
 *     store.js uses) — a Supabase Storage bucket ("chart-images") holds the
 *     actual bytes, and a small Postgres table ("images": id -> path) is the
 *     manifest, exactly analogous to store.js's assets/records tables. Every
 *     local change (store/clear) writes locally first — instant, offline-safe,
 *     never blocked on the network — and appends an op to a PERSISTED, ORDERED
 *     queue (localStorage key 'gcjournal_images_pending', distinct from store.js's
 *     'gcjournal_pending'). The queue is flushed to the cloud one op at a time
 *     (FIFO); a failed op is retried later with exponential backoff, and an
 *     'online' listener retries immediately on reconnect — the same shape as
 *     store.js's flush()/scheduleRetry(). A queued 'put' always reads whatever is
 *     CURRENTLY in imageCache for that id at send time (not a snapshot taken at
 *     enqueue time), so repeated edits before the first upload lands simply
 *     converge on the latest content. On boot (after the local Map is hydrated),
 *     the cloud manifest is fetched in the background: remote images missing
 *     locally are downloaded and merged into the local cache (re-rendering any
 *     on-screen slot that just gained an image); local images missing from the
 *     remote manifest (pre-existing local-only photos, or anything created while
 *     offline) are backfilled by enqueueing a 'put' for them, once. There is no
 *     visible sync-status UI by design — everything here is console-logged only.
 *
 * Boot contract: window.ImageStore.ready is a Promise that resolves once the
 * in-memory Map is fully populated from LOCAL storage (migration, if any,
 * included) — unchanged timing from before cloud sync existed, so first paint is
 * never delayed by the network. app.js awaits it (alongside window.Store.load)
 * before flipping S.ready = true. The cloud reconcile (manifest fetch, background
 * downloads, backfill) is chained off that same local-load promise but runs
 * after it resolves, without gating it.
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
    // NOTE: this function is purely LOCAL — it never touches the cloud queue,
    // both so cloud-downloaded images (written back via this same function,
    // see cloudReconcile below) don't loop back into a re-upload, and so the
    // cloud-enqueue decision stays a single, explicit seam at the call sites
    // that represent a real user edit (ImageSlot.store/clear below).
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

  // ── cloud sync (Supabase Storage + a small Postgres manifest table) ─────────
  // Same detection store.js uses: cloud sync is only active when both are set.
  var cloudCfg = window.APP_CONFIG || {};
  var CLOUD_URL = (cloudCfg.SUPABASE_URL || '').replace(/\/+$/, '');
  var CLOUD_KEY = cloudCfg.SUPABASE_ANON_KEY || '';
  var cloudMode = !!(CLOUD_URL && CLOUD_KEY);

  var IMG_LS_QUEUE = 'gcjournal_images_pending';      // distinct from store.js's 'gcjournal_pending'
  var IMG_LS_MANIFEST = 'gcjournal_images_manifest';  // local cache of id -> storage path, for delete correctness

  var imgQueue = readImgQueue();
  var manifestPaths = readManifestPaths();
  var imgFlushing = false, imgBackoff = 0, imgRetryTimer = null;

  function readImgQueue() { try { var q = JSON.parse(localStorage.getItem(IMG_LS_QUEUE) || '[]'); return Array.isArray(q) ? q : []; } catch (e) { return []; } }
  function writeImgQueue() { try { localStorage.setItem(IMG_LS_QUEUE, JSON.stringify(imgQueue)); } catch (e) {} }
  function readManifestPaths() { try { var m = JSON.parse(localStorage.getItem(IMG_LS_MANIFEST) || '{}'); return (m && typeof m === 'object') ? m : {}; } catch (e) { return {}; } }
  function writeManifestPaths() { try { localStorage.setItem(IMG_LS_MANIFEST, JSON.stringify(manifestPaths)); } catch (e) {} }

  function hasQueuedPut(id) { return imgQueue.some(function (e) { return e.id === id && e.op === 'put'; }); }

  function enqueueImg(op) {
    if (!cloudMode) return;
    imgQueue.push(op);
    writeImgQueue();
    flushImg();
  }

  function dataUrlToBlob(dataUrl) {
    var parts = dataUrl.split(','), m = parts[0].match(/:(.*?);/);
    var mime = m ? m[1] : 'image/png', bin = atob(parts[1]), n = bin.length, u8 = new Uint8Array(n);
    while (n--) u8[n] = bin.charCodeAt(n);
    return new Blob([u8], { type: mime });
  }

  function checkOk(res) {
    if (res.ok) return res;
    return res.text().then(function (t) { var err = new Error(res.status + ' ' + t.slice(0, 140)); err.status = res.status; throw err; });
  }

  function cloudUploadObject(path, blob) {
    return fetch(CLOUD_URL + '/storage/v1/object/chart-images/' + encodeURIComponent(path), {
      method: 'POST',
      headers: { apikey: CLOUD_KEY, Authorization: 'Bearer ' + CLOUD_KEY, 'Content-Type': blob.type || 'application/octet-stream', 'x-upsert': 'true' },
      body: blob
    }).then(checkOk);
  }
  function cloudUpsertManifest(id, path) {
    return fetch(CLOUD_URL + '/rest/v1/images', {
      method: 'POST',
      headers: { apikey: CLOUD_KEY, Authorization: 'Bearer ' + CLOUD_KEY, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify([{ id: id, path: path }])
    }).then(checkOk);
  }
  // A missing object/row (404, or Supabase Storage's 400 "not found") is treated
  // as success — the end state (gone) already matches what a delete wants.
  function cloudDeleteObject(path) {
    return fetch(CLOUD_URL + '/storage/v1/object/chart-images/' + encodeURIComponent(path), {
      method: 'DELETE',
      headers: { apikey: CLOUD_KEY, Authorization: 'Bearer ' + CLOUD_KEY }
    }).then(function (res) {
      if (res.ok || res.status === 404) return;
      return res.text().then(function (t) {
        if (res.status === 400 && /not.?found/i.test(t)) return; // Storage's "object not found" shape
        var err = new Error(res.status + ' ' + t.slice(0, 140)); err.status = res.status; throw err;
      });
    });
  }
  function cloudDeleteManifest(id) {
    return fetch(CLOUD_URL + '/rest/v1/images?id=eq.' + encodeURIComponent(id), {
      method: 'DELETE',
      headers: { apikey: CLOUD_KEY, Authorization: 'Bearer ' + CLOUD_KEY, Prefer: 'return=minimal' }
    }).then(function (res) {
      if (res.ok || res.status === 404) return;
      return res.text().then(function (t) { var err = new Error(res.status + ' ' + t.slice(0, 140)); err.status = res.status; throw err; });
    });
  }
  function fetchManifest() {
    return fetch(CLOUD_URL + '/rest/v1/images?select=id,path,updated_at', {
      headers: { apikey: CLOUD_KEY, Authorization: 'Bearer ' + CLOUD_KEY }
    }).then(checkOk).then(function (res) { return res.json(); });
  }

  // Execute one queued op against the cloud. 'put' reads imageCache at SEND
  // time (not at enqueue time) so repeated edits before the first upload lands
  // just converge on the latest content — no dedup bookkeeping needed.
  function processImgOp(entry) {
    if (entry.op === 'put') {
      var dataUrl = getImage(entry.id);
      if (!dataUrl) return Promise.resolve(); // superseded by a later delete — nothing to upload
      var path = entry.id + '.' + extFor(dataUrl);
      var oldPath = manifestPaths[entry.id];
      return cloudUploadObject(path, dataUrlToBlob(dataUrl))
        .then(function () { return cloudUpsertManifest(entry.id, path); })
        .then(function () {
          manifestPaths[entry.id] = path; writeManifestPaths();
          // A replace that changed format (e.g. png -> jpg via compression) now
          // has the manifest pointing at the new path, but the OLD object is
          // still sitting in the bucket unreferenced — best-effort clean it up
          // so repeated replaces don't leak storage over time. Non-fatal: the
          // manifest already correctly points at the new object either way.
          if (oldPath && oldPath !== path) {
            return cloudDeleteObject(oldPath).catch(function (err) {
              console.warn('[ImageStore] failed to clean up superseded object "' + oldPath + '":', err);
            });
          }
        });
    }
    if (entry.op === 'del') {
      var knownPath = manifestPaths[entry.id];
      var delObj = knownPath ? cloudDeleteObject(knownPath) : Promise.resolve();
      return delObj
        .then(function () { return cloudDeleteManifest(entry.id); })
        .then(function () { delete manifestPaths[entry.id]; writeManifestPaths(); });
    }
    return Promise.resolve();
  }

  // Drain the queue FIFO; stop on the first failure (retried later) — mirrors
  // store.js's flush()/scheduleRetry() shape.
  function flushImg() {
    if (!cloudMode || imgFlushing) return;
    if (!imgQueue.length) return;
    imgFlushing = true;
    var entry = imgQueue[0];
    processImgOp(entry).then(function () {
      imgQueue.shift(); writeImgQueue(); imgFlushing = false; imgBackoff = 0; flushImg();
    }, function (err) {
      imgFlushing = false;
      try { console.warn('[ImageStore] cloud sync deferred for "' + entry.id + '" (' + entry.op + '):', err && err.message); } catch (e) {}
      scheduleImgRetry();
    });
  }
  function scheduleImgRetry() {
    if (imgRetryTimer || !cloudMode) return;
    if (!imgQueue.length) return;
    imgBackoff = Math.min(imgBackoff ? imgBackoff * 2 : 3000, 30000);
    imgRetryTimer = setTimeout(function () { imgRetryTimer = null; flushImg(); }, imgBackoff);
  }
  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('online', function () {
      imgBackoff = 0;
      if (imgRetryTimer) { clearTimeout(imgRetryTimer); imgRetryTimer = null; }
      flushImg();
    });
  }

  // Download one cloud-only image in the background and merge it into the
  // local cache (IndexedDB + Map), then re-render any currently-connected
  // <image-slot> showing that id. Re-checks imageCache right before writing
  // so a local edit that happened to land while the download was in flight
  // always wins over the (now-stale) cloud copy.
  function downloadOne(id, path) {
    return fetch(CLOUD_URL + '/storage/v1/object/public/chart-images/' + encodeURIComponent(path))
      .then(function (res) { if (!res.ok) throw new Error('download ' + res.status); return res.blob(); })
      .then(function (blob) {
        return new Promise(function (resolve, reject) {
          var reader = new FileReader();
          reader.onload = function () { resolve(reader.result); };
          reader.onerror = function () { reject(reader.error || new Error('FileReader failed')); };
          reader.readAsDataURL(blob);
        });
      })
      .then(function (dataUrl) {
        if (imageCache.has(id)) return; // superseded locally in the meantime — don't clobber
        setImage(id, dataUrl);
        connectedSlots.forEach(function (slot) { if (slot.slotId === id) slot.render(); });
      });
  }
  function downloadSequentially(rows) {
    var i = 0;
    (function next() {
      if (i >= rows.length) return;
      var row = rows[i++];
      downloadOne(row.id, row.path).catch(function (err) {
        console.warn('[ImageStore] background download failed for "' + row.id + '":', err);
      }).then(next);
    })();
  }

  // Boot-time cloud reconcile: fetch the manifest, pull down anything remote
  // that isn't local yet (background — does not block ready), and backfill
  // (enqueue a 'put' for) anything local that isn't in the manifest yet, e.g.
  // pre-existing local-only photos, or anything created while offline. The
  // "already queued" check keeps this idempotent across reboots so a pending
  // backfill upload isn't re-enqueued on every single load before it flushes.
  function cloudReconcile() {
    fetchManifest().then(function (manifest) {
      var remoteIds = {};
      manifest.forEach(function (row) { remoteIds[row.id] = row.path; manifestPaths[row.id] = row.path; });
      writeManifestPaths();

      var toDownload = manifest.filter(function (row) { return !imageCache.has(row.id); });
      downloadSequentially(toDownload);

      imageCache.forEach(function (_dataUrl, id) {
        if (remoteIds.hasOwnProperty(id)) return;
        if (hasQueuedPut(id)) return;
        enqueueImg({ id: id, op: 'put' });
      });
    }).catch(function (err) {
      console.warn('[ImageStore] cloud manifest fetch failed — local images remain fully usable; will retry on next reconnect/reload.', err);
    });
  }

  // Exposed boot-readiness hook: app.js awaits this (alongside Store.load)
  // before render. Resolves once LOCAL load is done — unchanged timing from
  // before cloud sync existed. The cloud reconcile is chained off the same
  // promise but runs as a background continuation, never delaying this.
  var localReady = migrateAndLoad();
  window.ImageStore = { ready: localReady };
  localReady.then(function () {
    if (!cloudMode) return;
    flushImg();       // drain anything left over from a previous session first
    cloudReconcile();
  });

  var ICON = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4.5" width="18" height="15" rx="2.5"></rect><circle cx="8.5" cy="10" r="1.6"></circle><path d="M4 17l4.5-4 3.5 3 3-3.5L20 17"></path></svg>';

  var hoveredSlot = null;
  var connectedSlots = new Set(); // currently-connected <image-slot> elements, for background-download re-render

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
      connectedSlots.add(this);
      if (this._built) return;
      this._built = true;
      this.slotId = this.getAttribute('id') || ('slot-' + Math.random().toString(36).slice(2));
      this.placeholder = this.getAttribute('placeholder') || 'วาง / เลือกรูป';
      this.tabIndex = 0;
      this.render();
      this.wire();
    }

    disconnectedCallback() {
      connectedSlots.delete(this);
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
      // Cloud sync (when configured) is enqueued here, not inside setImage():
      // this is the seam that represents a real user edit, so background
      // cloud-downloaded images (written via the same setImage()) don't loop
      // back into a redundant re-upload.
      enqueueImg({ id: this.slotId, op: 'put' });
      this.render();
    }
    clear() {
      setImage(this.slotId, null);
      enqueueImg({ id: this.slotId, op: 'del' });
      this.render();
    }
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
