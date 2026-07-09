/*
 * store.js — swappable storage adapter.
 *
 * Two backends behind one interface:
 *   • local  — localStorage only (default; works offline).
 *   • cloud  — Supabase (PostgREST) when APP_CONFIG has a URL + anon key.
 *
 * The live model is held by app.js; this layer keeps an offline localStorage
 * mirror and syncs to the cloud through a PERSISTED, ORDERED pending-op queue:
 * every change is written locally and appended to the queue, then flushed to the
 * cloud one op at a time (FIFO). Failed ops stay queued and are retried on the
 * next change or the next load, so an edit made while offline is never lost and
 * eventually reaches the cloud. The UI never blocks on the network.
 */
window.Store = (function () {
  'use strict';

  var LS_BLOB = 'gcjournal_v9';
  var LS_ACTIVE = 'gcjournal_active';
  var LS_QUEUE = 'gcjournal_pending';

  var cfg = window.APP_CONFIG || {};
  var URL_ = (cfg.SUPABASE_URL || '').replace(/\/+$/, '');
  var KEY_ = cfg.SUPABASE_ANON_KEY || '';
  var mode = (URL_ && KEY_) ? 'cloud' : 'local';

  var statusCbs = [];
  var inFlight = 0, flushing = false, seq = 0;
  var queue = readQueue();
  var loadFailed = false;          // last cloud load errored (honest status)
  var retryTimer = null, backoff = 0;

  function onStatus(cb) { statusCbs.push(cb); }
  function refresh() { var s = status(); statusCbs.forEach(function (cb) { try { cb(s); } catch (e) {} }); }
  function isOffline() { return typeof navigator !== 'undefined' && navigator.onLine === false; }
  function status() {
    if (mode === 'local') return 'local';
    if (inFlight > 0) return 'syncing';
    if (queue.length > 0 || loadFailed) return isOffline() ? 'offline' : 'error'; // unsynced/unloaded
    return 'synced';
  }
  // Retry a failed flush later (exponential backoff, capped) so a transient
  // network drop eventually syncs on its own — no manual edit/reload needed.
  function scheduleRetry() {
    if (retryTimer || mode !== 'cloud') return;
    if (!queue.length && !loadFailed) return;
    backoff = Math.min(backoff ? backoff * 2 : 3000, 30000);
    retryTimer = setTimeout(function () { retryTimer = null; if (loadFailed) reloadCloud(); flush(); }, backoff);
  }

  // ── localStorage mirror + queue ──────────────────────────────────────────
  function readLocal() { try { var s = localStorage.getItem(LS_BLOB); if (s) { var p = JSON.parse(s); if (p && p.assets && p.records) return p; } } catch (e) {} return null; }
  function mirror(blob) { try { localStorage.setItem(LS_BLOB, JSON.stringify(blob)); } catch (e) {} }
  function readActive() { try { return localStorage.getItem(LS_ACTIVE) || null; } catch (e) { return null; } }
  function setActive(id) { try { localStorage.setItem(LS_ACTIVE, id); } catch (e) {} }
  function readQueue() { try { var q = JSON.parse(localStorage.getItem(LS_QUEUE) || '[]'); return Array.isArray(q) ? q : []; } catch (e) { return []; } }
  function writeQueue() { try { localStorage.setItem(LS_QUEUE, JSON.stringify(queue)); } catch (e) {} }
  function enqueue(op) { op.id = Date.now().toString(36) + '-' + (seq++); queue.push(op); writeQueue(); flush(); }

  // ── Supabase REST ────────────────────────────────────────────────────────
  function headers(extra) { var h = { apikey: KEY_, Authorization: 'Bearer ' + KEY_, 'Content-Type': 'application/json' }; if (extra) for (var k in extra) h[k] = extra[k]; return h; }
  function api(path, opts) {
    return fetch(URL_ + '/rest/v1/' + path, opts).then(function (res) {
      if (!res.ok) return res.text().then(function (t) { throw new Error(res.status + ' ' + t.slice(0, 140)); });
      var ct = res.headers.get('content-type') || '';
      return ct.indexOf('application/json') > -1 ? res.json() : null;
    });
  }
  var UPSERT = { Prefer: 'resolution=merge-duplicates,return=minimal' };
  var MINIMAL = { Prefer: 'return=minimal' };
  function assetToRow(a, i) { return { id: a.id, name: a.name, sub: a.sub || '', badge: a.badge || '', colors: a.colors, trading_days: a.tradingDays, sort: (a.sort != null ? a.sort : i) }; }
  function rowToAsset(r) { return { id: r.id, name: r.name, sub: r.sub || '', badge: r.badge || '', colors: r.colors, tradingDays: r.trading_days || [], sort: r.sort }; }

  // Execute one queued op against the cloud.
  function send(op) {
    if (op.t === 'putRecord') return api('records', { method: 'POST', headers: headers(UPSERT), body: JSON.stringify([{ asset_id: op.a, date_key: op.k, data: op.data }]) });
    if (op.t === 'delRecord') return api('records?asset_id=eq.' + encodeURIComponent(op.a) + '&date_key=eq.' + encodeURIComponent(op.k), { method: 'DELETE', headers: headers(MINIMAL) });
    if (op.t === 'putAssets') return api('assets', { method: 'POST', headers: headers(UPSERT), body: JSON.stringify(op.assets.map(assetToRow)) });
    if (op.t === 'delAsset') return api('records?asset_id=eq.' + encodeURIComponent(op.a), { method: 'DELETE', headers: headers(MINIMAL) })
      .then(function () { return api('assets?id=eq.' + encodeURIComponent(op.a), { method: 'DELETE', headers: headers(MINIMAL) }); });
    return Promise.resolve();
  }
  // Drain the queue FIFO; stop on the first failure (retried later).
  function flush() {
    if (mode !== 'cloud' || flushing) return;
    if (!queue.length) { refresh(); return; }
    flushing = true; inFlight++; refresh();
    var op = queue[0];
    send(op).then(function () {
      queue.shift(); writeQueue(); flushing = false; inFlight--; backoff = 0; refresh(); flush();
    }, function (err) {
      flushing = false; inFlight--; refresh();
      try { console.warn('[cloud sync deferred]', err && err.message); } catch (e) {}
      scheduleRetry();
    });
  }

  function cloudFetchAll() {
    return Promise.all([
      api('assets?select=id,name,sub,badge,colors,trading_days,sort&order=sort.asc', { headers: headers() }),
      api('records?select=asset_id,date_key,data', { headers: headers() })
    ]).then(function (res) {
      var assets = (res[0] || []).map(rowToAsset), records = {};
      assets.forEach(function (a) { records[a.id] = {}; });
      (res[1] || []).forEach(function (r) { (records[r.asset_id] = records[r.asset_id] || {})[r.date_key] = r.data; });
      return { assets: assets, records: records };
    });
  }
  // Seed a fresh project: insert assets FIRST (records FK-reference them), THEN records.
  function cloudPushAll(b) {
    var recRows = [];
    b.assets.forEach(function (a) { var rc = b.records[a.id] || {}; Object.keys(rc).forEach(function (k) { recRows.push({ asset_id: a.id, date_key: k, data: rc[k] }); }); });
    return api('assets', { method: 'POST', headers: headers(UPSERT), body: JSON.stringify(b.assets.map(assetToRow)) }).then(function () {
      var ops = [];
      for (var i = 0; i < recRows.length; i += 200) ops.push(api('records', { method: 'POST', headers: headers(UPSERT), body: JSON.stringify(recRows.slice(i, i + 200)) }));
      return Promise.all(ops);
    });
  }

  // Overlay any not-yet-synced queued ops onto a freshly fetched cloud snapshot,
  // so unsynced local edits win over stale server rows (single-writer journal).
  function applyQueue(out) {
    queue.forEach(function (op) {
      if (op.t === 'putRecord') { (out.records[op.a] = out.records[op.a] || {})[op.k] = op.data; }
      else if (op.t === 'delRecord') { if (out.records[op.a]) delete out.records[op.a][op.k]; }
      else if (op.t === 'putAssets') { op.assets.forEach(function (a) { var ix = -1; out.assets.forEach(function (x, i) { if (x.id === a.id) ix = i; }); if (ix > -1) out.assets[ix] = a; else out.assets.push(a); out.records[a.id] = out.records[a.id] || {}; }); }
      else if (op.t === 'delAsset') { out.assets = out.assets.filter(function (x) { return x.id !== op.a; }); delete out.records[op.a]; }
    });
    return out;
  }

  // ── public: load ─────────────────────────────────────────────────────────
  var seedFactoryRef = null;
  function load(seedFactory) {
    seedFactoryRef = seedFactory;
    var local = readLocal();
    if (mode === 'local') {
      var b = local || seedFactory();
      b.activeAssetId = pickActive(b, readActive());
      mirror(b); setActive(b.activeAssetId);
      return Promise.resolve(b);
    }
    inFlight++; refresh();
    return cloudFetchAll().then(function (cloud) {
      inFlight--; loadFailed = false; backoff = 0;
      var out;
      if (!cloud.assets.length) {
        var seed = local || seedFactory();
        out = { assets: seed.assets, records: seed.records };
        // push the seed (or pre-existing local book) up as one atomic-ish batch
        inFlight++; refresh();
        cloudPushAll(out).then(function () { inFlight--; refresh(); flush(); }, function (e) { inFlight--; loadFailed = true; refresh(); scheduleRetry(); try { console.warn('[seed push]', e && e.message); } catch (x) {} });
      } else {
        out = applyQueue(cloud); // reconcile: unsynced local ops win, then re-push them
      }
      out.activeAssetId = pickActive(out, readActive());
      mirror(out); setActive(out.activeAssetId); refresh(); flush();
      return out;
    }, function (err) {
      inFlight--; loadFailed = true; refresh();
      try { console.warn('[cloud load failed, using local]', err && err.message); } catch (e) {}
      scheduleRetry();   // keep trying to reach the cloud on its own
      var b = local || seedFactory();
      b.activeAssetId = pickActive(b, readActive());
      mirror(b);
      return b;
    });
  }
  // Re-fetch the cloud after an earlier load failure (used by retry/online).
  function reloadCloud() {
    if (mode !== 'cloud' || !loadFailed || inFlight > 0) return;
    inFlight++; refresh();
    cloudFetchAll().then(function (cloud) {
      inFlight--; loadFailed = false; backoff = 0;
      var out = cloud.assets.length ? applyQueue(cloud) : { assets: (readLocal() || (seedFactoryRef ? seedFactoryRef() : { assets: [], records: {} })).assets, records: (readLocal() || { records: {} }).records || {} };
      out.activeAssetId = pickActive(out, readActive());
      mirror(out); setActive(out.activeAssetId); refresh(); flush();
      reloadCbs.forEach(function (cb) { try { cb(out); } catch (e) {} });
    }, function () { inFlight--; refresh(); scheduleRetry(); });
  }
  var reloadCbs = [];
  function onReload(cb) { reloadCbs.push(cb); }
  function pickActive(b, pref) {
    if (pref && b.assets.some(function (a) { return a.id === pref; })) return pref;
    if (b.activeAssetId && b.assets.some(function (a) { return a.id === b.activeAssetId; })) return b.activeAssetId;
    return b.assets[0] ? b.assets[0].id : null;
  }

  // ── public: granular writes (queue + flush) ──────────────────────────────
  function putRecord(a, k, data) { if (mode !== 'cloud') return; enqueue({ t: 'putRecord', a: a, k: k, data: data }); }
  function delRecord(a, k) { if (mode !== 'cloud') return; enqueue({ t: 'delRecord', a: a, k: k }); }
  function putAssets(assets) { if (mode !== 'cloud') return; enqueue({ t: 'putAssets', assets: assets.map(function (a, i) { return { id: a.id, name: a.name, sub: a.sub, badge: a.badge, colors: a.colors, tradingDays: a.tradingDays, sort: i }; }) }); }
  function delAsset(a) { if (mode !== 'cloud') return; enqueue({ t: 'delAsset', a: a }); }

  // When connectivity returns, immediately reconcile + flush instead of waiting
  // for the backoff timer or a manual edit.
  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('online', function () {
      backoff = 0;
      if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
      if (loadFailed) reloadCloud();
      flush(); refresh();
    });
    window.addEventListener('offline', function () { refresh(); });
  }

  return {
    get mode() { return mode; },
    onStatus: onStatus, onReload: onReload, status: status,
    load: load, mirror: mirror, setActive: setActive,
    putRecord: putRecord, delRecord: delRecord, putAssets: putAssets, delAsset: delAsset
  };
})();
