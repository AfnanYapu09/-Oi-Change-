/*
 * app.js — GC Trade Journal (Blue Liquid Glass edition).
 * Ported from the Claude Design handoff, reskinned to an iOS-26 liquid-glass
 * system and wired to a swappable Store (localStorage or Supabase, no login).
 * Logic, seeded data and Thai formatting are unchanged; the view is class-based
 * and data loading is async.
 */
(function () {
  'use strict';

  var PROPS = { resultScheme: 'blue-orange', weekStart: 'sun', showWeekends: true, defaultPeriod: 'month' };
  var NOW = new Date();
  var TODAY = keyOf(NOW);
  var MONTHS_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  var MONTHS_FULL = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
  var DOW = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
  var DOW_FULL = ['วันอาทิตย์', 'วันจันทร์', 'วันอังคาร', 'วันพุธ', 'วันพฤหัสบดี', 'วันศุกร์', 'วันเสาร์'];
  var OPT = {
    bias: [{ v: 'buy', l: 'Buy' }, { v: 'sell', l: 'Sell' }, { v: 'sw_up', l: 'SW ขึ้น' }, { v: 'sw_down', l: 'SW ลง' }],
    oi: [{ v: 'buy', l: 'Buy' }, { v: 'sell', l: 'Sell' }, { v: 'sideway', l: 'Sideway' }],
    add: [{ v: 'put_below', l: 'Put เด่นล่าง' }, { v: 'call_below', l: 'Call เด่นล่าง' }, { v: 'put_above', l: 'Put เด่นบน' }, { v: 'call_above', l: 'Call เด่นบน' }],
    wd: [{ v: 'put_below', l: 'Put เด่นล่าง' }, { v: 'call_below', l: 'Call เด่นล่าง' }, { v: 'put_above', l: 'Put เด่นบน' }, { v: 'call_above', l: 'Call เด่นบน' }],
    magnet: [{ v: 'up', l: 'บน' }, { v: 'down', l: 'ล่าง' }, { v: 'both', l: 'ทั้งสอง' }],
    iv: [{ v: 'left', l: 'เอนซ้าย' }, { v: 'right', l: 'เอนขวา' }, { v: 'smile', l: 'รูปยิ้ม' }],
    pcr: [{ v: 'buy', l: 'Buy' }, { v: 'sell', l: 'Sell' }, { v: 'sideway', l: 'Sideway' }],
    result: [{ v: 'correct', l: 'ถูก' }, { v: 'wrong', l: 'ผิด' }, { v: 'pending', l: 'รอสรุป' }]
  };
  var ASSET_COLORS = [['#D4A017', '#FBD34D'], ['#F7931A', '#FDBE5B'], ['#007AFF', '#5AC8FA'], ['#34C759', '#8CE3A3'], ['#AF52DE', '#D08BF0'], ['#FF3B30', '#FF8A82'], ['#5856D6', '#9D9BF0'], ['#00B8A9', '#5FE0D3']];

  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function key(y, m, d) { return y + '-' + pad(m + 1) + '-' + pad(d); }
  function keyOf(dt) { return key(dt.getFullYear(), dt.getMonth(), dt.getDate()); }
  function parse(k) { var a = k.split('-').map(Number); return new Date(a[0], a[1] - 1, a[2], 12); }
  function hexToRgba(h, a) { h = h.replace('#', ''); var n = parseInt(h, 16); return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')'; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function resultColor(kind) { var g = (PROPS.resultScheme || 'blue-orange') === 'green-red'; if (kind === 'correct') return g ? '#34C759' : '#007AFF'; if (kind === 'wrong') return g ? '#FF3B30' : '#FF9500'; return '#C7C7CC'; }
  function weekStartNum() { return (PROPS.weekStart || 'sun') === 'mon' ? 1 : 0; }
  function showWeekends() { return PROPS.showWeekends === undefined ? true : PROPS.showWeekends; }
  function makeBadge(name) { name = (name || '').trim(); if (!name) return '?'; var up = name.toUpperCase(); return up.length <= 3 ? up : up.slice(0, 3); }
  function fmtLong(k) { var a = k.split('-').map(Number); return a[2] + ' ' + MONTHS_SHORT[a[1] - 1] + ' ' + (a[0] + 543); }
  function fmtDowFull(k) { return DOW_FULL[parse(k).getDay()]; }
  function optLabel(k, v) { var o = OPT[k].find(function (x) { return x.v === v; }); return o ? o.l : '–'; }
  function biasMeta(v) { var o = OPT.bias.find(function (x) { return x.v === v; }) || { l: '-' }; var up = (v === 'buy' || v === 'sw_up'), down = (v === 'sell' || v === 'sw_down'); return { label: o.l, color: up ? '#34C759' : (down ? '#FF3B30' : '#8E8E93'), arrow: up ? '↑' : (down ? '↓' : '→') }; }
  function resultMeta(v) { var C = resultColor('correct'), W = resultColor('wrong'); if (v === 'correct') return { label: 'Bias ถูก', color: C, soft: hexToRgba(C, .14) }; if (v === 'wrong') return { label: 'Bias ผิด', color: W, soft: hexToRgba(W, .14) }; return { label: 'รอสรุป', color: '#8E8E93', soft: 'rgba(120,140,180,.16)' }; }
  function badgeStyle(colors, size, fs) { colors = colors || ['#8E8E93', '#B0B0B5']; return 'width:' + size + 'px;height:' + size + 'px;border-radius:' + Math.round(size * 0.3) + 'px;font-size:' + fs + 'px;background:linear-gradient(155deg,' + colors[1] + ',' + colors[0] + ');'; }
  function tradingDaysLabel(td) { if (!td || !td.length) return '—'; if (td.length === 7) return 'ทุกวัน · 24/7'; var wk = [1, 2, 3, 4, 5]; var isWk = td.length === 5 && wk.every(function (x) { return td.indexOf(x) > -1; }); if (isWk) return 'จันทร์–ศุกร์'; return td.slice().sort(function (a, b) { return a - b; }).map(function (i) { return DOW[i]; }).join(' '); }

  // ── starting state: one asset (GC), no records ─────────────────────────────
  function seedAll() {
    return { assets: [{ id: 'gc', name: 'GC', sub: 'ทองคำฟิวเจอร์', badge: 'GC', colors: ['#D4A017', '#FBD34D'], tradingDays: [1, 2, 3, 4, 5] }], activeAssetId: 'gc', records: { gc: {} } };
  }

  // ── state ─────────────────────────────────────────────────────────────────
  var S = {
    page: 'overview', returnPage: 'overview', period: 'month',
    curY: NOW.getFullYear(), curM: NOW.getMonth(), focusKey: TODAY,
    assets: [], activeAssetId: null, records: {},
    assetMenuOpen: false, assetEditor: null,
    draft: null, sheetKey: null, sheetIsNew: false, newsInput: '',
    search: '', sortDir: 'desc', filtersOpen: false,
    filters: { result: [], bias: [], news: [], pcr: [], add: [], wd: [], magnet: [], iv: [] },
    ready: false,
    // Collapsible left rail (persisted). Open by default; collapse to give the
    // calendar the full frame width. Read once at boot from localStorage.
    railOpen: (function () { try { return localStorage.getItem('gcjournal_rail') !== '0'; } catch (e) { return true; } })()
  };
  function activeAsset() { for (var i = 0; i < S.assets.length; i++) { if (S.assets[i].id === S.activeAssetId) return S.assets[i]; } return S.assets[0]; }
  function findAsset(id) { for (var i = 0; i < S.assets.length; i++) { if (S.assets[i].id === id) return S.assets[i]; } return null; }
  function recs() { return S.records[S.activeAssetId] || {}; }
  function isTradingDow(dow) { return activeAsset().tradingDays.indexOf(dow) > -1; }
  function blob() { return { assets: S.assets, activeAssetId: S.activeAssetId, records: S.records }; }
  function mirror() { window.Store.mirror(blob()); }

  // ── calendar + stats ───────────────────────────────────────────────────────
  function cellData(o) {
    var blank = { dayNum: '', k: o.k, clickable: false, cls: 'blank', dot: '', badge: '', badgeCls: '' };
    if (!o.inMonth) return blank;
    if (o.weekend && !showWeekends()) return blank;
    var cls = '', dot = '', badge = '', badgeCls = '';
    if (o.weekend) cls = 'we';
    else if (o.rec) {
      if (o.rec.result === 'correct') { cls = 'correct'; badge = 'ถูก'; badgeCls = 'correct'; }
      else if (o.rec.result === 'wrong') { cls = 'wrong'; badge = 'ผิด'; badgeCls = 'wrong'; }
      else { cls = 'pending'; badge = 'รอ'; badgeCls = 'pending'; }
      var up = (o.rec.bias === 'buy' || o.rec.bias === 'sw_up'), down = (o.rec.bias === 'sell' || o.rec.bias === 'sw_down');
      dot = up ? 'up' : (down ? 'down' : '');
    }
    if (o.k === TODAY) cls += ' today';
    return { dayNum: o.dayNum, k: o.k, clickable: !!o.clickable, cls: cls.trim(), dot: dot, badge: badge, badgeCls: badgeCls };
  }
  function monthWeeks(y, m) {
    var ws = weekStartNum(); var first = new Date(y, m, 1, 12); var off = (first.getDay() - ws + 7) % 7; var dim = new Date(y, m + 1, 0).getDate(); var rows = Math.ceil((off + dim) / 7); var weeks = []; var rec = recs();
    for (var w = 0; w < rows; w++) { var days = []; for (var d = 0; d < 7; d++) { var dt = new Date(y, m, 1 - off + w * 7 + d, 12); var inM = dt.getMonth() === m && dt.getFullYear() === y; var dow = dt.getDay(); var we = !isTradingDow(dow); var k = keyOf(dt); days.push(cellData({ k: k, dayNum: dt.getDate(), inMonth: inM, weekend: we, rec: rec[k], clickable: inM && !we })); } weeks.push({ days: days }); }
    return weeks;
  }
  function microCell(o) {
    if (!o.inMonth) return { dayNum: '', k: o.k, clickable: false, cls: 'blank' };
    var cls = 'plain';
    if (!o.weekend && o.rec) { cls = o.rec.result === 'correct' ? 'correct' : o.rec.result === 'wrong' ? 'wrong' : 'pending'; }
    else if (o.weekend) cls = 'we';
    if (o.k === TODAY) cls += ' today';
    return { dayNum: o.dayNum, k: o.k, clickable: !!o.clickable, cls: cls };
  }
  function yearMonths(y) {
    var ws = weekStartNum(); var rec = recs();
    return Array.from({ length: 12 }, function (_, m) {
      var first = new Date(y, m, 1, 12); var off = (first.getDay() - ws + 7) % 7; var dim = new Date(y, m + 1, 0).getDate(); var rows = Math.ceil((off + dim) / 7); var weeks = [];
      for (var w = 0; w < rows; w++) { var days = []; for (var d = 0; d < 7; d++) { var dt = new Date(y, m, 1 - off + w * 7 + d, 12); var inM = dt.getMonth() === m && dt.getFullYear() === y; var dow = dt.getDay(); var we = !isTradingDow(dow); var k = keyOf(dt); days.push(microCell({ k: k, dayNum: dt.getDate(), inMonth: inM, weekend: we, rec: rec[k], clickable: inM && !we })); } weeks.push({ days: days }); }
      return { name: MONTHS_FULL[m], weeks: weeks };
    });
  }
  function scopeKeys() {
    var rec = recs(); var all = Object.keys(rec);
    if (S.period === 'year') return all.filter(function (k) { return k.slice(0, 4) === String(S.curY); });
    var pre = S.curY + '-' + pad(S.curM + 1); return all.filter(function (k) { return k.slice(0, 7) === pre; });
  }
  function computeStats(keys, recArg) {
    var rec = recArg || recs(); var c = 0, w = 0, p = 0, n = 0;
    keys.forEach(function (k) { var r = rec[k]; if (!r) return; if (r.result === 'correct') c++; else if (r.result === 'wrong') w++; else p++; if (r.newsOn) n++; });
    var total = keys.filter(function (k) { return rec[k]; }).length; var dec = c + w;
    return { correct: c, wrong: w, pending: p, total: total, news: n, decided: dec, winPct: dec ? Math.round(c / dec * 100) : 0 };
  }
  function summaryRow(label, c, w) {
    var dec = c + w; var rate = dec ? Math.round(c / dec * 100) : 0; var C = resultColor('correct'), W = resultColor('wrong');
    return { label: label, summary: dec ? (c + ' ถูก · ' + w + ' ผิด') : 'ไม่มีข้อมูล', blueWidth: (dec ? rate : 0) + '%', rateText: dec ? rate + '%' : '–', rateColor: !dec ? 'var(--ink-4)' : (rate >= 50 ? C : W) };
  }
  function weeklySummary(weeks) {
    var rec = recs();
    return weeks.map(function (wk, i) { var c = 0, w = 0; wk.days.forEach(function (d) { if (d.clickable) { var r = rec[d.k]; if (r) { if (r.result === 'correct') c++; else if (r.result === 'wrong') w++; } } }); return summaryRow('สัปดาห์ ' + (i + 1), c, w); });
  }
  function monthlySummary(y) {
    var rec = recs(); var out = [];
    for (var m = 0; m < 12; m++) { var pre = y + '-' + pad(m + 1); var c = 0, w = 0; Object.keys(rec).forEach(function (k) { if (k.slice(0, 7) === pre) { if (rec[k].result === 'correct') c++; else if (rec[k].result === 'wrong') w++; } }); out.push(summaryRow(MONTHS_SHORT[m], c, w)); }
    return out;
  }
  function imageGroups() {
    var k = (S.activeAssetId || 'x') + '-' + (S.sheetKey || 'x');
    var g = [{ key: 'baai', label: 'บ่าย', time: '12:30–15:30', slots: ['OI Change', '+OI', '+Intraday'] }, { key: 'yen', label: 'เย็น', time: '15:30–19:00', slots: ['OI Change', '+OI', '+Intraday'] }, { key: 'kham', label: 'ค่ำ', time: '19:00–23:30', slots: ['OI Change', '+OI', '+Intraday'] }, { key: 'chaloey', label: 'เฉลย', time: 'สรุปหลังตลาดปิด', slots: ['ภาพเฉลย', 'สรุปแนวโน้ม'] }];
    return g.map(function (grp) { return { label: grp.label, time: grp.time, items: grp.slots.map(function (s, i) { return { label: s, id: 'img-' + k + '-' + grp.key + '-' + i, placeholder: 'วาง / เลือกรูป' }; }) }; });
  }
  function filteredResults() {
    var rec = recs(); var entries = Object.keys(rec).map(function (k) { var o = { k: k }; for (var p in rec[k]) o[p] = rec[k][p]; return o; });
    if (S.search.trim()) { var q = S.search.trim().toLowerCase(); entries = entries.filter(function (e) { return ((e.news || []).join(' ')).toLowerCase().indexOf(q) > -1 || e.k.indexOf(q) > -1 || fmtLong(e.k).indexOf(S.search.trim()) > -1; }); }
    var f = S.filters; var has = function (arr, v) { return (arr || []).indexOf(v) > -1; };
    if (f.result.length) entries = entries.filter(function (e) { return has(f.result, e.result); });
    if (f.bias.length) entries = entries.filter(function (e) { return has(f.bias, e.bias); });
    if (f.news.length) entries = entries.filter(function (e) { var hn = !!e.newsOn; return (has(f.news, 'yes') && hn) || (has(f.news, 'no') && !hn); });
    if (f.pcr.length) entries = entries.filter(function (e) { return has(f.pcr, e.pcr); });
    if (f.magnet.length) entries = entries.filter(function (e) { return has(f.magnet, e.magnet); });
    if (f.iv.length) entries = entries.filter(function (e) { return has(f.iv, e.iv); });
    if (f.add.length) entries = entries.filter(function (e) { return (e.add || []).some(function (x) { return has(f.add, x); }); });
    if (f.wd.length) entries = entries.filter(function (e) { return e.wdOn && (e.wd || []).some(function (x) { return has(f.wd, x); }); });
    entries.sort(function (a, b) { return (S.sortDir === 'asc') ? (a.k > b.k ? 1 : -1) : (a.k < b.k ? 1 : -1); });
    return entries;
  }

  // ── mutations ───────────────────────────────────────────────────────────────
  function setState(patch) { Object.assign(S, patch); render(); }
  function selectAsset(id) { S.activeAssetId = id; window.Store.setActive(id); mirror(); setState({ assetMenuOpen: false, curY: NOW.getFullYear(), curM: NOW.getMonth(), focusKey: TODAY }); }
  function openAssetEditor(id) { var ed; if (id) { var a = findAsset(id); ed = { id: id, name: a.name, tradingDays: a.tradingDays.slice(), colors: (a.colors || ['#8E8E93', '#B0B0B5']).slice() }; } else { ed = { id: null, name: '', tradingDays: [1, 2, 3, 4, 5], colors: ASSET_COLORS[S.assets.length % ASSET_COLORS.length] }; } setState({ assetEditor: ed, assetMenuOpen: false }); }
  function setEditor(patch) { setState({ assetEditor: Object.assign({}, S.assetEditor, patch) }); }
  function toggleEditorDay(dow) { var td = S.assetEditor.tradingDays.slice(); var i = td.indexOf(dow); if (i > -1) td.splice(i, 1); else td.push(dow); td.sort(function (a, b) { return a - b; }); setEditor({ tradingDays: td }); }
  function saveAsset() {
    var ed = S.assetEditor; if (!ed) return; var name = (ed.name || '').trim(); if (!name) return;
    var td = ed.tradingDays.length ? ed.tradingDays.slice().sort(function (a, b) { return a - b; }) : [1, 2, 3, 4, 5]; var badge = makeBadge(name);
    if (ed.id) { S.assets = S.assets.map(function (a) { return a.id === ed.id ? Object.assign({}, a, { name: name, badge: badge, tradingDays: td, colors: ed.colors }) : a; }); }
    else { var id = 'a' + Date.now().toString(36); S.assets = S.assets.concat([{ id: id, name: name, sub: '', badge: badge, colors: ed.colors, tradingDays: td }]); S.records[id] = {}; S.activeAssetId = id; window.Store.setActive(id); }
    mirror(); window.Store.putAssets(S.assets);
    setState({ assetEditor: null, curY: NOW.getFullYear(), curM: NOW.getMonth(), focusKey: TODAY });
  }
  function deleteAsset(id) { if (S.assets.length <= 1) return; S.assets = S.assets.filter(function (a) { return a.id !== id; }); delete S.records[id]; if (S.activeAssetId === id) { S.activeAssetId = S.assets[0].id; window.Store.setActive(S.activeAssetId); } mirror(); window.Store.delAsset(id); setState({ assetEditor: null, assetMenuOpen: false }); }

  function openDay(k) {
    var rec = recs()[k]; var isNew = !rec;
    var draft = rec ? Object.assign({}, rec) : { bias: '', result: 'pending', tMain: '', tSec: '', news: [], newsOn: false, pcr: '', oi: '', add: [], wd: [], wdOn: false, magnet: '', iv: '' };
    if (!draft.news) draft.news = [];
    if (!Array.isArray(draft.add)) draft.add = [];
    if (!Array.isArray(draft.wd)) draft.wd = [];
    if (draft.newsOn === undefined) draft.newsOn = (draft.news && draft.news.length > 0);
    if (draft.wdOn === undefined) draft.wdOn = (draft.wd && draft.wd.length > 0);
    var rp = (S.page === 'record' ? S.returnPage : S.page);
    setState({ page: 'record', returnPage: rp, draft: draft, sheetKey: k, sheetIsNew: isNew, newsInput: '' });
  }
  function closeSheet() { setState({ page: (S.returnPage || 'overview'), draft: null, sheetKey: null }); }
  function saveDraft() {
    var d = S.draft; var num = function (x) { return x === '' || x === null || x === undefined ? '' : Number(x); };
    var clean = Object.assign({}, d, { tMain: num(d.tMain), tSec: num(d.tSec) });
    var aid = S.activeAssetId; S.records[aid] = Object.assign({}, S.records[aid] || {}); S.records[aid][S.sheetKey] = clean;
    mirror(); window.Store.putRecord(aid, S.sheetKey, clean);
    setState({ page: (S.returnPage || 'overview'), draft: null, sheetKey: null });
  }
  function deleteDraft() { var aid = S.activeAssetId, k = S.sheetKey; S.records[aid] = Object.assign({}, S.records[aid] || {}); delete S.records[aid][k]; mirror(); window.Store.delRecord(aid, k); setState({ page: (S.returnPage || 'overview'), draft: null, sheetKey: null }); }
  function setField(k, v) { S.draft = Object.assign({}, S.draft); S.draft[k] = v; render(); }
  function setFieldSilent(k, v) { S.draft[k] = v; }
  function addNewsItem() { var t = (S.newsInput || '').trim(); if (!t) return; var list = (S.draft.news || []).concat([t]); setState({ draft: Object.assign({}, S.draft, { news: list }), newsInput: '' }); }
  function removeNewsItem(i) { var list = (S.draft.news || []).slice(); list.splice(i, 1); setState({ draft: Object.assign({}, S.draft, { news: list }) }); }
  function toggleMulti(field, value) { var cur = (S.draft[field] || []).slice(); var i = cur.indexOf(value); if (i > -1) cur.splice(i, 1); else cur.push(value); S.draft = Object.assign({}, S.draft); S.draft[field] = cur; render(); }
  function toggleFlag(field) { S.draft = Object.assign({}, S.draft); S.draft[field] = !S.draft[field]; render(); }
  function prev() { if (S.period === 'year') setState({ curY: S.curY - 1 }); else { var m = S.curM - 1, y = S.curY; if (m < 0) { m = 11; y--; } setState({ curM: m, curY: y }); } }
  function next() { if (S.period === 'year') setState({ curY: S.curY + 1 }); else { var m = S.curM + 1, y = S.curY; if (m > 11) { m = 0; y++; } setState({ curM: m, curY: y }); } }
  function goToday() { setState({ curY: NOW.getFullYear(), curM: NOW.getMonth(), focusKey: TODAY }); }
  function setFilter(dim, val) { var arr = (S.filters[dim] || []).slice(); var i = arr.indexOf(val); if (i > -1) arr.splice(i, 1); else arr.push(val); var f = Object.assign({}, S.filters); f[dim] = arr; setState({ filters: f }); }
  function clearFilters() { setState({ filters: { result: [], bias: [], news: [], pcr: [], add: [], wd: [], magnet: [], iv: [] }, search: '' }); }

  // ── icons ────────────────────────────────────────────────────────────────
  var IC = {
    chevR: '<svg width="9" height="15" viewBox="0 0 9 15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 1.5L7 7.5l-5.5 6"></path></svg>',
    chevL: '<svg width="9" height="15" viewBox="0 0 9 15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M7.5 1.5L2 7.5l5.5 6"></path></svg>',
    grid: '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><rect x="3" y="3" width="7" height="8" rx="1.6"></rect><rect x="14" y="3" width="7" height="5" rx="1.6"></rect><rect x="14" y="11" width="7" height="10" rx="1.6"></rect><rect x="3" y="14" width="7" height="7" rx="1.6"></rect></svg>',
    search: '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><circle cx="11" cy="11" r="7"></circle><path d="M20 20l-3.2-3.2" stroke-linecap="round"></path></svg>',
    plus: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"></path></svg>',
    edit: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3z"></path><path d="M13.5 6.5l3 3"></path></svg>',
    check: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5l5 5L20 6.5"></path></svg>',
    x: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"></path></svg>',
    target: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8.5"></circle><circle cx="12" cy="12" r="3.5"></circle></svg>',
    cal: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="15.5" rx="3"></rect><path d="M3.5 9.5h17M8 3v4M16 3v4"></path></svg>',
    doc: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4.5" y="3.5" width="15" height="17" rx="2.5"></rect><path d="M8 8.5h8M8 12.5h8M8 16.5h5"></path></svg>',
    back: '<svg width="10" height="16" viewBox="0 0 9 15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M7.5 1.5L2 7.5l5.5 6"></path></svg>',
    menu: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h16"></path></svg>',
    panel: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2.5"></rect><path d="M9 4v16"></path></svg>'
  };

  // ── render pieces ────────────────────────────────────────────────────────

  function sidebar() {
    var a = activeAsset();
    var allStats = computeStats(Object.keys(recs()));
    var menu = '';
    if (S.assetMenuOpen) {
      var rows = S.assets.map(function (as) {
        var rc = S.records[as.id] || {}; var st = computeStats(Object.keys(rc), rc); var isActive = as.id === S.activeAssetId;
        return '<div class="menu-row c-row' + (isActive ? ' active' : '') + '" data-a="selectAsset" data-id="' + as.id + '">' +
          '<span class="badge" style="' + badgeStyle(as.colors, 34, 13) + '">' + esc(as.badge || makeBadge(as.name)) + '</span>' +
          '<span style="flex:1;min-width:0;"><span class="menu-row-name">' + esc(as.name) + '</span><span class="menu-row-meta">' + esc(tradingDaysLabel(as.tradingDays) + ' · ' + st.total + ' วัน') + '</span></span>' +
          (isActive ? '<span style="display:flex;color:var(--accent);flex:none;">' + IC.check + '</span>' : '') +
          '<button class="icon-btn" data-a="openAssetEditor" data-id="' + as.id + '">' + IC.edit + '</button></div>';
      }).join('');
      menu = '<div data-a="closeAssetMenu" style="position:fixed;inset:0;z-index:35;"></div>' +
        '<div class="menu' + enterCls(ENTER.menu) + '"><div class="menu-cap">สินทรัพย์</div>' + rows +
        '<button class="menu-add" data-a="addAsset"><span style="width:22px;height:22px;border-radius:7px;background:rgba(10,132,255,.14);display:flex;align-items:center;justify-content:center;"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 5v14M5 12h14"></path></svg></span>เพิ่มสินทรัพย์</button></div>';
    }
    return '<aside class="sidebar">' +
      '<div class="brand"><button class="brand-btn" data-a="toggleAssetMenu">' +
        '<span class="badge" style="' + badgeStyle(a.colors, 42, 15) + '">' + esc(a.badge || makeBadge(a.name)) + '</span>' +
        '<span style="min-width:0;flex:1;"><span class="brand-name">' + esc(a.name) + '</span><span class="brand-sub">' + esc(a.sub || tradingDaysLabel(a.tradingDays)) + '</span></span>' +
        '<span class="chev' + (S.assetMenuOpen ? ' open' : '') + '"><svg width="8" height="13" viewBox="0 0 9 15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 1.5L7 7.5l-5.5 6"></path></svg></span>' +
      '</button>' + menu + '</div>' +
      '<button class="nav-item' + (S.page === 'overview' ? ' active' : '') + '" data-a="navOverview">' + IC.grid + 'ภาพรวม</button>' +
      '<button class="nav-item' + (S.page === 'search' ? ' active' : '') + '" data-a="navSearch">' + IC.search + 'ค้นหา</button>' +
      '<div class="spacer" style="flex:1"></div>' +
      '<div class="winrate-card"><div class="winrate-cap">Win rate ทั้งหมด</div><div style="display:flex;align-items:baseline;gap:6px;"><span class="winrate-val">' + allStats.winPct + '%</span><span style="font-size:12px;color:var(--ink-3);">' + allStats.decided + ' ครั้ง</span></div></div>' +
      '<button class="btn btn-primary btn-record" data-a="addToday">' + IC.plus + 'บันทึกวันนี้</button>' +
    '</aside>';
  }

  function topbar() {
    if (S.page === 'record') {
      var dateLabel = fmtDowFull(S.sheetKey) + ' ' + fmtLong(S.sheetKey);
      var dateSub = (S.sheetIsNew ? 'บันทึกใหม่' : 'แก้ไขบันทึก') + ' · ' + activeAsset().name;
      return '<button class="back-btn" data-a="closeSheet" style="flex:1;justify-content:flex-start;">' + IC.back + 'กลับ</button>' +
        '<div class="date-center"><div class="d1">' + esc(dateLabel) + '</div><div class="d2">' + esc(dateSub) + '</div></div>' +
        '<div style="flex:1;display:flex;justify-content:flex-end;gap:10px;align-items:center;"><button class="btn btn-primary btn-save" data-a="saveDraft">บันทึก</button></div>';
    }
    var right;
    if (S.page === 'overview') {
      right = '<div class="seg-view">' + [['month', 'เดือน'], ['year', 'ปี']].map(function (p) { return '<button class="' + (S.period === p[0] ? 'active' : '') + '" data-a="setPeriod" data-v="' + p[0] + '">' + p[1] + '</button>'; }).join('') + '</div>';
    } else {
      right = '<span class="results-stat">' + filteredResults().length + ' รายการ</span>';
    }
    var toggle = '<button class="rail-toggle" data-a="toggleRail" aria-label="สลับแถบเมนู" title="ซ่อน/แสดงแถบเมนู">' + (S.railOpen ? IC.panel : IC.menu) + '</button>';
    return '<div style="display:flex;align-items:center;gap:12px;min-width:0;">' + toggle + '<div class="page-title">' + (S.page === 'search' ? 'ค้นหา' : 'ภาพรวม') + '</div></div>' +
      '<div style="display:flex;align-items:center;gap:12px;">' + right + '</div>';
  }

  function overviewBody() {
    var stats = computeStats(scopeKeys());
    var kpi = function (cap, val, valColor, sub, icBg, icColor, icon) {
      return '<div class="card kpi"><div class="kpi-top"><span class="kpi-cap">' + cap + '</span><span class="kpi-icon" style="background:' + icBg + ';color:' + icColor + ';">' + icon + '</span></div>' +
        '<div class="kpi-body"><span class="kpi-val"' + (valColor ? ' style="color:' + valColor + ';"' : '') + '>' + val + '</span><span class="kpi-sub">' + sub + '</span></div></div>';
    };
    var kpis = '<div class="kpis">' +
      kpi('Bias ถูก', stats.correct, resultColor('correct'), 'ครั้งในช่วงนี้', resultColor('correct') === '#007AFF' ? 'rgba(0,122,255,.14)' : 'rgba(52,199,89,.16)', resultColor('correct'), IC.check) +
      kpi('Bias ผิด', stats.wrong, resultColor('wrong'), 'ครั้งในช่วงนี้', resultColor('wrong') === '#FF9500' ? 'rgba(255,149,0,.16)' : 'rgba(255,59,48,.16)', resultColor('wrong'), IC.x) +
      kpi('อัตราชนะ', stats.winPct + '%', resultColor('correct'), 'ถูก ' + stats.correct + ' · ผิด ' + stats.wrong, 'rgba(0,122,255,.14)', resultColor('correct'), IC.target) +
      kpi('จดทั้งหมด', stats.total, '', 'วันเทรด', 'rgba(120,140,180,.16)', '#7C8AA6', IC.cal) +
      kpi('วันมีข่าว', stats.news, '#FF3B30', 'มีข่าวสำคัญ', 'rgba(255,59,48,.14)', '#FF3B30', IC.doc) +
    '</div>';

    var periodLabel = S.period === 'year' ? String(S.curY + 543) : (MONTHS_FULL[S.curM] + ' ' + (S.curY + 543));
    var calInner;
    if (S.period === 'year') {
      calInner = '<div class="year-grid">' + yearMonths(S.curY).map(function (ym) {
        return '<div><div class="ym-name">' + ym.name + '</div>' + ym.weeks.map(function (wk) {
          return '<div class="ym-week">' + wk.days.map(function (mc) { return '<button class="mcell ' + mc.cls + '" ' + (mc.clickable ? 'data-a="openDay" data-k="' + mc.k + '"' : '') + '>' + mc.dayNum + '</button>'; }).join('') + '</div>';
        }).join('') + '</div>';
      }).join('') + '</div>';
    } else {
      var ws = weekStartNum(); var order = ws === 1 ? [1, 2, 3, 4, 5, 6, 0] : [0, 1, 2, 3, 4, 5, 6];
      var dowRow = '<div class="dow-row">' + order.map(function (i) { return '<div class="dow' + ((i === 0 || i === 6) ? ' we' : '') + '">' + DOW[i] + '</div>'; }).join('') + '</div>';
      var weeks = monthWeeks(S.curY, S.curM);
      var wksHtml = weeks.map(function (w) {
        return '<div class="week">' + w.days.map(function (c) {
          return '<button class="cell ' + c.cls + '" ' + (c.clickable ? 'data-a="openDay" data-k="' + c.k + '"' : '') + '>' +
            '<span class="cell-num">' + c.dayNum + '</span>' + (c.dot ? '<span class="cell-dot ' + c.dot + '"></span>' : '') + (c.badge ? '<span class="cell-badge ' + c.badgeCls + '">' + c.badge + '</span>' : '') + '</button>';
        }).join('') + '</div>';
      }).join('');
      var legend = '<div class="legend">' +
        '<span><span class="lg-sw" style="background:' + resultColor('correct') + '22;border:1px solid ' + resultColor('correct') + ';"></span>Bias ถูก</span>' +
        '<span><span class="lg-sw" style="background:' + resultColor('wrong') + '22;border:1px solid ' + resultColor('wrong') + ';"></span>Bias ผิด</span>' +
        '<span><span class="lg-sw" style="border:1px dashed rgba(70,110,180,.5);"></span>รอสรุป</span>' +
        '<span><span class="lg-dot" style="background:#34C759;"></span>ทิศขึ้น<span class="lg-dot" style="background:#FF3B30;margin-left:8px;"></span>ทิศลง</span></div>';
      calInner = dowRow + wksHtml + legend;
    }
    var calPanel = '<div class="card cal-panel"><div class="cal-head"><div class="cal-nav">' +
      '<button class="round-btn" data-a="prev">' + IC.chevL + '</button><div class="cal-title">' + periodLabel + '</div><button class="round-btn" data-a="next">' + IC.chevR + '</button></div>' +
      '<button class="today-btn" data-a="today">วันนี้</button></div>' + calInner + '</div>';

    var rightIsYear = S.period === 'year';
    var rows = (rightIsYear ? monthlySummary(S.curY) : weeklySummary(monthWeeks(S.curY, S.curM))).map(function (r) {
      return '<div class="sum-row"><div class="sum-top"><span class="sum-label">' + r.label + '</span><span class="sum-meta">' + r.summary + '</span></div>' +
        '<div class="sum-bar-row"><div class="bar"><div class="bar-fill" style="width:' + r.blueWidth + ';"></div></div><span class="sum-rate" style="color:' + r.rateColor + ';">' + r.rateText + '</span></div></div>';
    }).join('');
    var sidePanel = '<div class="card side-panel"><div class="side-title">' + (rightIsYear ? 'สรุปรายเดือน' : 'สรุปรายสัปดาห์') + '</div><div class="side-sub">สัดส่วน Bias ถูก แต่ละช่วง</div>' + rows + '</div>';

    return '<div class="wrap">' + kpis + '<div class="cols">' + calPanel + sidePanel + '</div></div>';
  }

  function searchBody() {
    var results = filteredResults();
    var fcount = 0; for (var fk in S.filters) fcount += (S.filters[fk] || []).length;
    var hasFilters = (!!S.search.trim()) || fcount > 0;
    var groups = [
      { label: 'ผลลัพธ์', dim: 'result', opts: OPT.result }, { label: 'Bias', dim: 'bias', opts: OPT.bias },
      { label: 'ข่าว', dim: 'news', opts: [{ v: 'yes', l: 'มีข่าว' }, { v: 'no', l: 'ไม่มีข่าว' }] },
      { label: 'PCR OI Change', dim: 'pcr', opts: OPT.pcr }, { label: 'เติมเงิน', dim: 'add', opts: OPT.add },
      { label: 'ถอนเงิน', dim: 'wd', opts: OPT.wd }, { label: 'Magnet', dim: 'magnet', opts: OPT.magnet }, { label: 'IV', dim: 'iv', opts: OPT.iv }
    ];
    var groupsHtml = groups.map(function (g) {
      var chips = g.opts.map(function (o) { var active = (S.filters[g.dim] || []).indexOf(o.v) > -1; return '<button class="chip' + (active ? ' active' : '') + '" data-a="setFilter" data-dim="' + g.dim + '" data-v="' + o.v + '">' + (active ? '✓ ' : '') + esc(o.l) + '</button>'; }).join('');
      return '<div><div class="filter-group-cap">' + g.label + '</div><div class="chips">' + chips + '</div></div>';
    }).join('');
    var filterCard = '<div class="card filter-card"><div class="filter-head">' +
      '<button class="filter-toggle" data-a="toggleFilters"><span class="chev' + (S.filtersOpen ? ' open' : '') + '"><svg width="9" height="14" viewBox="0 0 9 15" fill="none" stroke="var(--ink-3)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 1.5L7 7.5l-5.5 6"></path></svg></span>' +
      '<span class="h-strong">ตัวกรอง</span>' + (fcount > 0 ? '<span class="filter-badge">' + fcount + '</span>' : '') + '</button>' +
      (hasFilters ? '<button class="filter-clear" data-a="clearFilters">ล้างทั้งหมด</button>' : '') + '</div>' +
      (S.filtersOpen ? '<div class="filter-body"><div class="filter-grid">' + groupsHtml + '</div></div>' : '') + '</div>';

    var fC = 0, fW = 0; results.forEach(function (e) { if (e.result === 'correct') fC++; else if (e.result === 'wrong') fW++; }); var fD = fC + fW;
    var statsLine = fD > 0 ? '<span class="results-stat">Bias <span style="color:' + resultColor('correct') + ';font-weight:800;">ถูก ' + fC + '</span> · <span style="color:' + resultColor('wrong') + ';font-weight:800;">ผิด ' + fW + '</span> · ชนะ <span style="font-weight:800;color:var(--ink);">' + (fD ? Math.round(fC / fD * 100) : 0) + '%</span></span>' : '';
    var resultsHead = '<div class="results-head"><div style="display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;"><span class="results-count">' + results.length + ' รายการ</span>' + statsLine + '</div>' +
      '<button class="sort-btn" data-a="toggleSort">↕ ' + (S.sortDir === 'desc' ? 'ใหม่ → เก่า' : 'เก่า → ใหม่') + '</button></div>';
    var list = results.length ? results.map(resultCard).join('') :
      '<div class="empty"><svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" style="margin-bottom:10px;opacity:.5;"><circle cx="11" cy="11" r="7"></circle><path d="M20 20l-3.2-3.2" stroke-linecap="round"></path></svg><div class="e1">ไม่พบรายการ</div><div class="e2">ลองปรับคำค้นหรือตัวกรอง</div></div>';
    var searchInput = '<div class="search-box"><span class="s-icon">' + IC.search + '</span><input class="search-input inp-search" data-a="search" value="' + esc(S.search) + '" placeholder="ค้นหาวันที่ หรือข่าว เช่น CPI, FOMC, NFP..."></div>';
    return '<div class="wrap-search">' + searchInput + filterCard + resultsHead + list + '</div>';
  }
  function resultCard(e) {
    var bi = biasMeta(e.bias), rm = resultMeta(e.result); var a = e.k.split('-').map(Number); var dt = new Date(a[0], a[1] - 1, a[2], 12);
    var hn = (e.newsOn && e.news && e.news.length > 0);
    var tag = function (t) { return '<span class="tag">' + t + '</span>'; };
    return '<button class="result-card" data-a="openDay" data-k="' + e.k + '"><span class="rc-accent" style="background:' + rm.color + ';"></span>' +
      '<div class="rc-body"><div class="rc-date"><div class="rc-daynum">' + a[2] + '</div><div class="rc-month">' + MONTHS_SHORT[a[1] - 1] + ' ' + (a[0] + 543) + '</div><div class="rc-dow">' + DOW_FULL[dt.getDay()] + '</div></div>' +
      '<div class="rc-main"><div class="rc-line"><span class="pill-result" style="background:' + rm.soft + ';color:' + rm.color + ';">' + rm.label + '</span>' +
      '<span class="rc-bias" style="color:' + bi.color + ';">' + bi.arrow + ' ' + esc(bi.label) + '</span><span class="rc-target">เป้า ' + esc(e.tMain) + ' / ' + esc(e.tSec) + '</span></div>' +
      '<div class="tags">' + tag('PCR ' + optLabel('pcr', e.pcr)) + tag('OI ' + optLabel('oi', e.oi)) + tag('Magnet ' + optLabel('magnet', e.magnet)) + tag('IV ' + optLabel('iv', e.iv)) +
      (hn ? '<span class="tag tag-news">📰 ' + esc(e.news.join(' · ')) + '</span>' : '') + '</div></div>' +
      '<span class="rc-chev">' + IC.chevR + '</span></div></button>';
  }

  function segBtns(dim, cur) { return OPT[dim].map(function (o) { return '<button class="' + (o.v === cur ? 'active' : '') + '" data-a="setField" data-k="' + dim + '" data-v="' + o.v + '">' + esc(o.l) + '</button>'; }).join(''); }
  function multiBtns(dim, arr) { arr = arr || []; return OPT[dim].map(function (o) { var a = arr.indexOf(o.v) > -1; return '<button class="gridopt' + (a ? ' active' : '') + '" data-a="toggleMulti" data-k="' + dim + '" data-v="' + o.v + '">' + (a ? '✓ ' : '') + esc(o.l) + '</button>'; }).join(''); }
  function secTitle(name, aux) { return '<div class="sec-title"><span class="sec-bar"></span><span class="sec-name">' + name + '</span>' + (aux ? '<span class="sec-aux">' + aux + '</span>' : '') + '</div>'; }

  function recordBody() {
    var d = S.draft;
    var imgGroups = imageGroups().map(function (g) {
      return '<div class="card img-card"><div class="img-card-head"><span class="img-card-label">' + g.label + '</span><span class="img-card-time">' + g.time + '</span></div>' +
        '<div class="img-slots">' + g.items.map(function (it) { return '<div class="img-slot-wrap"><div class="img-frame"><image-slot id="' + it.id + '" label="' + esc(it.label) + '" placeholder="' + esc(it.placeholder) + '" shape="rounded" radius="14"></image-slot></div><span class="img-slot-cap">' + esc(it.label) + '</span></div>'; }).join('') + '</div></div>';
    }).join('');
    var imagesSection = '<div style="margin-bottom:24px;">' + secTitle('รูปภาพประกอบ', 'แยกตามช่วงเวลา') + '<div class="img-groups">' + imgGroups + '</div></div>';

    var tInput = function (val, act, capt) { return '<label class="target-field"><input class="input num inp-form" data-a="input" data-k="' + act + '" value="' + esc(val === undefined ? '' : val) + '" type="number" inputmode="decimal" placeholder="0"><span class="input-cap">' + capt + '</span></label>'; };
    var newsBlock = '';
    if (d.newsOn) {
      var items = (d.news || []).length ? '<div class="news-list">' + (d.news || []).map(function (t, i) { return '<div class="news-item"><span>' + esc(t) + '</span><button class="news-x" data-a="removeNews" data-i="' + i + '">✕</button></div>'; }).join('') + '</div>' : '<div class="news-empty">ยังไม่มีข่าว · พิมพ์แล้วกดเพิ่ม</div>';
      newsBlock = '<div class="news-add"><input class="news-input inp-form" data-a="newsInput" data-k="newsInput" value="' + esc(S.newsInput) + '" type="text" placeholder="พิมพ์ข่าว แล้วกด Enter เช่น CPI สหรัฐ 19:30"><button class="news-add-btn" data-a="addNews">+ เพิ่ม</button></div>' + items;
    }
    var tradeCard = '<div>' + secTitle('ข้อมูลเทรด') + '<div class="card form-card">' +
      '<div class="frow"><div class="frow-label">Bias</div><div class="frow-body"><div class="seg">' + segBtns('bias', d.bias) + '</div></div></div>' +
      '<div class="frow"><div class="frow-label">เป้าหมาย</div><div class="targets">' + tInput(d.tMain, 'tMain', 'เป้าหลัก') + tInput(d.tSec, 'tSec', 'เป้ารอง') + '</div></div>' +
      '<div class="frow" style="border-bottom:none;flex-direction:column;align-items:stretch;"><div class="stack-head"><span class="stack-label">มีข่าว</span><button class="toggle' + (d.newsOn ? ' on' : '') + '" data-a="toggleFlag" data-k="newsOn"><span class="toggle-knob"></span></button></div>' + newsBlock + '</div>' +
      '</div></div>';
    var resultCardEl = '<div>' + secTitle('ผลลัพธ์') + '<div class="card form-card"><div class="frow" style="border-bottom:none;"><div class="frow-label">Bias ถูก/ผิด</div><div class="frow-body"><div class="seg">' + segBtns('result', d.result) + '</div></div></div></div>' +
      (!S.sheetIsNew ? '<button class="delete-btn" data-a="deleteDraft">ลบบันทึก</button>' : '') + '</div>';
    var leftCol = '<div class="col">' + tradeCard + resultCardEl + '</div>';

    var wdBlock = d.wdOn ? '<div style="margin-top:12px;"><div class="multi-head" style="margin-bottom:9px;"><span class="m2">เลือกได้หลายตัว</span></div><div class="gridopts">' + multiBtns('wd', d.wd) + '</div></div>' : '';
    var researchCard = '<div class="col" style="gap:0;">' + secTitle('ข้อมูลวิจัย', 'Option Flow') + '<div class="card form-card">' +
      '<div class="frow"><div class="frow-label">PCR OI Change</div><div class="frow-body"><div class="seg">' + segBtns('pcr', d.pcr) + '</div></div></div>' +
      '<div class="strike-row"><span class="strike-title">อ่าน Strike</span><span class="strike-sub">เม็ดเงินMMจากออปชัน</span></div>' +
      '<div class="multi-block"><div class="multi-head"><span class="m1">เติมเงิน</span><span class="m2">เลือกได้หลายตัว</span></div><div class="gridopts">' + multiBtns('add', d.add) + '</div></div>' +
      '<div class="stack" style="border-bottom:1px solid rgba(120,150,210,.16);"><div class="stack-head"><span class="stack-label">ถอนเงิน</span><button class="toggle' + (d.wdOn ? ' on' : '') + '" data-a="toggleFlag" data-k="wdOn"><span class="toggle-knob"></span></button></div>' + wdBlock + '</div>' +
      '<div class="frow"><div class="frow-label">Magnet</div><div class="frow-body"><div class="seg">' + segBtns('magnet', d.magnet) + '</div></div></div>' +
      '<div class="frow" style="border-bottom:none;"><div class="frow-label">IV</div><div class="frow-body"><div class="seg">' + segBtns('iv', d.iv) + '</div></div></div>' +
      '</div></div>';

    return '<div class="wrap-record">' + imagesSection + '<div class="two-col">' + leftCol + researchCard + '</div></div>';
  }

  function assetEditorModal() {
    if (!S.assetEditor) return '';
    var ed = S.assetEditor; var nm = (ed.name || '').trim();
    var dayOpts = [0, 1, 2, 3, 4, 5, 6].map(function (i) { var on = ed.tradingDays.indexOf(i) > -1; return '<button class="day-chip' + (on ? ' on' : '') + '" data-a="editorDay" data-i="' + i + '">' + DOW[i] + '</button>'; }).join('');
    var colorOpts = ASSET_COLORS.map(function (c, idx) { var on = c[0] === ed.colors[0]; return '<button class="swatch' + (on ? ' on' : '') + '" data-a="editorColor" data-i="' + idx + '" style="background:linear-gradient(155deg,' + c[1] + ',' + c[0] + ');color:' + c[0] + ';">' + (on ? '✓' : '') + '</button>'; }).join('');
    return '<div class="backdrop' + enterCls(ENTER.modal) + '" data-a="closeEditor"><div class="modal" data-a="stop">' +
      '<div class="modal-head"><div class="modal-title">' + (ed.id ? 'แก้ไขสินทรัพย์' : 'เพิ่มสินทรัพย์') + '</div><div class="modal-sub">ตั้งชื่อ เลือกสี และวันที่เทรด</div></div>' +
      '<div class="modal-body">' +
        '<div class="editor-name-row"><span class="badge" style="' + badgeStyle(ed.colors, 48, 18) + '">' + esc(makeBadge(ed.name)) + '</span>' +
          '<label style="flex:1;min-width:0;"><span class="field-cap">ชื่อสินทรัพย์</span><input class="input inp-form" data-a="editorName" value="' + esc(ed.name) + '" placeholder="เช่น GC, SET50, BTC" style="font-weight:700;"></label></div>' +
        '<div><div class="field-cap">สี</div><div class="swatches">' + colorOpts + '</div></div>' +
        '<div><div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:10px;"><span class="field-cap" style="margin:0;">วันที่เทรด</span><span class="days-label">' + esc(tradingDaysLabel(ed.tradingDays)) + '</span></div><div class="day-opts">' + dayOpts + '</div></div>' +
      '</div>' +
      '<div class="modal-foot">' + (ed.id && S.assets.length > 1 ? '<button class="btn-modal btn-danger-soft" data-a="deleteAsset">ลบ</button>' : '') + '<div class="grow"></div>' +
        '<button class="btn-modal btn-ghost" data-a="closeEditor">ยกเลิก</button>' +
        '<button class="btn-modal btn-primary" data-a="saveAsset" style="' + (nm ? '' : 'opacity:.5;cursor:not-allowed;') + '">บันทึก</button>' +
      '</div></div></div>';
  }

  // ── render ───────────────────────────────────────────────────────────────
  var root = document.getElementById('app');
  // Entrance animations play only when something first appears (page switch /
  // overlay open) — never on the frequent in-place re-renders — so the UI stays
  // calm. ENTER is recomputed each render by diffing against the previous state.
  var RPREV = { page: null, menu: false, modal: false };
  var ENTER = { page: false, menu: false, modal: false };
  function enterCls(flag) { return flag ? ' enter' : ''; }
  function captureFocus() {
    var el = document.activeElement;
    if (!el || !el.dataset || el.dataset.a == null || !root.contains(el)) return null;
    var info = { a: el.dataset.a, k: el.dataset.k || '', dim: el.dataset.dim || '', v: el.dataset.v || '' };
    try { if (el.type !== 'number') { info.start = el.selectionStart; info.end = el.selectionEnd; } } catch (e) {}
    return info;
  }
  function restoreFocus(info) {
    if (!info) return;
    var sel = '[data-a="' + info.a + '"]' + (info.k ? '[data-k="' + info.k + '"]' : '') + (info.dim ? '[data-dim="' + info.dim + '"]' : '') + (info.v ? '[data-v="' + info.v + '"]' : '');
    var el = root.querySelector(sel); if (!el) return; el.focus();
    if (info.start != null && el.setSelectionRange) { try { el.setSelectionRange(info.start, info.end); } catch (e) {} }
  }
  function render() {
    if (!S.ready) { root.innerHTML = '<div class="loading"><div class="spinner"></div><div>กำลังโหลดสมุดบันทึก…</div></div>'; return; }
    ENTER = {
      page: RPREV.page !== S.page,
      menu: S.assetMenuOpen && !RPREV.menu,
      modal: !!S.assetEditor && !RPREV.modal
    };
    var focus = captureFocus();
    var scEl = root.querySelector('.scroll'); var scroll = scEl ? scEl.scrollTop : 0;
    var body = S.page === 'overview' ? overviewBody() : S.page === 'search' ? searchBody() : recordBody();
    root.innerHTML = '<div class="shell' + (S.railOpen ? '' : ' rail-collapsed') + '">' + sidebar() +
      '<main class="main"><header class="topbar">' + topbar() + '</header>' +
      '<div class="scroll"><div class="view' + enterCls(ENTER.page) + '">' + body + '</div></div></main></div>' + assetEditorModal();
    var s2 = root.querySelector('.scroll'); if (s2) s2.scrollTop = scroll;
    restoreFocus(focus);
    RPREV = { page: S.page, menu: S.assetMenuOpen, modal: !!S.assetEditor };
  }

  // ── delegation ───────────────────────────────────────────────────────────
  var NUMERIC = { tMain: 1, tSec: 1 };
  var ACTIONS = {
    toggleAssetMenu: function () { setState({ assetMenuOpen: !S.assetMenuOpen }); },
    closeAssetMenu: function () { setState({ assetMenuOpen: false }); },
    selectAsset: function (ds) { selectAsset(ds.id); },
    openAssetEditor: function (ds) { openAssetEditor(ds.id); },
    addAsset: function () { openAssetEditor(null); },
    navOverview: function () { setState({ page: 'overview' }); },
    navSearch: function () { setState({ page: 'search' }); },
    toggleRail: function () { S.railOpen = !S.railOpen; try { localStorage.setItem('gcjournal_rail', S.railOpen ? '1' : '0'); } catch (e) {} render(); },
    addToday: function () { openDay(TODAY); },
    prev: prev, next: next, today: goToday,
    setPeriod: function (ds) { setState({ period: ds.v }); },
    openDay: function (ds) { openDay(ds.k); },
    closeSheet: closeSheet, saveDraft: saveDraft, deleteDraft: deleteDraft,
    setField: function (ds) { setField(ds.k, ds.v); },
    toggleMulti: function (ds) { toggleMulti(ds.k, ds.v); },
    toggleFlag: function (ds) { toggleFlag(ds.k); },
    addNews: addNewsItem,
    removeNews: function (ds) { removeNewsItem(parseInt(ds.i, 10)); },
    toggleFilters: function () { setState({ filtersOpen: !S.filtersOpen }); },
    clearFilters: clearFilters,
    setFilter: function (ds) { setFilter(ds.dim, ds.v); },
    toggleSort: function () { setState({ sortDir: S.sortDir === 'desc' ? 'asc' : 'desc' }); },
    editorColor: function (ds) { setEditor({ colors: ASSET_COLORS[parseInt(ds.i, 10)] }); },
    editorDay: function (ds) { toggleEditorDay(parseInt(ds.i, 10)); },
    saveAsset: saveAsset, closeEditor: function () { setState({ assetEditor: null }); },
    deleteAsset: function () { if (S.assetEditor) deleteAsset(S.assetEditor.id); },
    stop: function () {}
  };
  root.addEventListener('click', function (e) {
    var el = e.target.closest('[data-a]'); if (!el || !root.contains(el)) return;
    var a = el.dataset.a; if (a === 'stop') return;
    var fn = ACTIONS[a]; if (fn) { e.stopPropagation(); fn(el.dataset, e); }
  });
  root.addEventListener('input', function (e) {
    var el = e.target; if (!el.dataset) return; var a = el.dataset.a;
    if (a === 'input') { if (NUMERIC[el.dataset.k]) setFieldSilent(el.dataset.k, el.value); }
    else if (a === 'search') { setState({ search: el.value }); }
    else if (a === 'newsInput') { S.newsInput = el.value; }
    else if (a === 'editorName') {
      S.assetEditor = Object.assign({}, S.assetEditor, { name: el.value });
      var nm = el.value.trim();
      var badgeEl = root.querySelector('.editor-name-row .badge'); if (badgeEl) badgeEl.textContent = makeBadge(el.value);
      var saveBtn = root.querySelector('[data-a="saveAsset"]'); if (saveBtn) saveBtn.style.cssText = nm ? '' : 'opacity:.5;cursor:not-allowed;';
    }
  });
  root.addEventListener('keydown', function (e) {
    var el = e.target; if (el.dataset && el.dataset.a === 'newsInput' && e.key === 'Enter') { e.preventDefault(); addNewsItem(); }
    if (e.key === 'Escape') { if (S.assetEditor) setState({ assetEditor: null }); else if (S.assetMenuOpen) setState({ assetMenuOpen: false }); }
  });

  // ── boot ─────────────────────────────────────────────────────────────────
  // A background reconcile (after connectivity returns) refreshes on-screen data,
  // but never while the user is mid-edit on the record sheet.
  window.Store.onReload(function (data) {
    if (!S.ready || S.page === 'record') return;
    S.assets = data.assets; S.records = data.records;
    S.activeAssetId = data.activeAssetId || S.activeAssetId;
    render();
  });
  render(); // loading screen
  Promise.all([window.Store.load(seedAll), window.ImageStore.ready]).then(function (results) {
    var data = results[0];
    S.assets = data.assets; S.records = data.records; S.activeAssetId = data.activeAssetId; S.ready = true;
    render();
  });
})();
