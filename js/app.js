/*
 * app.js — GC Trade Journal.
 * A faithful vanilla port of the Claude Design handoff "Trade Journal.dc.html".
 * The prototype was written in a reactive template DSL; this recreates the same
 * visual output and behaviour with plain state -> render, event delegation, and
 * the exact inline styles the design specifies. Data persists to localStorage.
 */
(function () {
  'use strict';

  // ── static config (ported verbatim) ──────────────────────────────────────
  var PROPS = { resultScheme: 'blue-orange', weekStart: 'sun', showWeekends: true, defaultPeriod: 'month' };
  var TODAY = '2026-07-07';
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
  var STORE = 'gcjournal_v9';

  // ── tiny utils ────────────────────────────────────────────────────────────
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
  function resultMeta(v) { var C = resultColor('correct'), W = resultColor('wrong'); if (v === 'correct') return { label: 'Bias ถูก', color: C, soft: hexToRgba(C, .12) }; if (v === 'wrong') return { label: 'Bias ผิด', color: W, soft: hexToRgba(W, .12) }; return { label: 'รอสรุป', color: '#8E8E93', soft: 'rgba(120,120,128,.14)' }; }

  // ── style generators (ported verbatim) ───────────────────────────────────
  function badgeStyleOf(colors, size, fs) { colors = colors || ['#8E8E93', '#B0B0B5']; return 'width:' + size + 'px;height:' + size + 'px;border-radius:' + Math.round(size * 0.3) + 'px;background:linear-gradient(155deg,' + colors[1] + ',' + colors[0] + ');display:flex;align-items:center;justify-content:center;font-weight:800;color:#fff;flex:none;font-size:' + fs + 'px;text-shadow:0 1px 2px rgba(0,0,0,.28);letter-spacing:-.02em;'; }
  function tradingDaysLabel(td) { if (!td || !td.length) return '—'; if (td.length === 7) return 'ทุกวัน · 24/7'; var wk = [1, 2, 3, 4, 5]; var isWk = td.length === 5 && wk.every(function (x) { return td.indexOf(x) > -1; }); if (isWk) return 'จันทร์–ศุกร์'; return td.slice().sort(function (a, b) { return a - b; }).map(function (i) { return DOW[i]; }).join(' '); }
  function dayChipStyle(on) { return 'flex:1;padding:11px 0;border-radius:11px;border:1px solid ' + (on ? '#007AFF' : 'rgba(60,60,67,.16)') + ';background:' + (on ? '#007AFF' : '#fff') + ';color:' + (on ? '#fff' : '#3c3c43') + ';font-weight:' + (on ? '700' : '500') + ';font-size:14px;cursor:pointer;font-family:inherit;transition:all .12s;'; }
  function colorSwatchStyle(c, on) { return 'width:34px;height:34px;border-radius:50%;border:none;background:linear-gradient(155deg,' + c[1] + ',' + c[0] + ');cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:' + (on ? '0 0 0 3px #fff, 0 0 0 5px ' + c[0] : '0 1px 3px rgba(0,0,0,.15)') + ';'; }
  function segFormStyle(a) { return 'flex:1;padding:9px 6px;border:none;border-radius:8px;font-family:inherit;font-size:14px;font-weight:' + (a ? '600' : '500') + ';cursor:pointer;transition:all .15s;white-space:nowrap;background:' + (a ? '#007AFF' : 'transparent') + ';color:' + (a ? '#fff' : '#1c1c1e') + ';box-shadow:' + (a ? '0 1px 2px rgba(0,122,255,.35)' : 'none') + ';'; }
  function gridOptStyle(a) { return 'padding:10px 8px;border:1px solid ' + (a ? '#007AFF' : 'rgba(60,60,67,.14)') + ';border-radius:10px;font-family:inherit;font-size:13.5px;font-weight:' + (a ? '600' : '500') + ';cursor:pointer;transition:all .15s;background:' + (a ? '#007AFF' : '#fff') + ';color:' + (a ? '#fff' : '#1c1c1e') + ';text-align:center;line-height:1.25;'; }
  function segViewStyle(a) { return 'padding:6px 16px;border:none;border-radius:7px;font-family:inherit;font-size:14px;font-weight:' + (a ? '600' : '500') + ';cursor:pointer;transition:all .2s;white-space:nowrap;background:' + (a ? '#fff' : 'transparent') + ';color:' + (a ? '#1c1c1e' : 'rgba(60,60,67,.6)') + ';box-shadow:' + (a ? '0 1px 3px rgba(0,0,0,.12)' : 'none') + ';'; }
  function chipStyle(a) { return 'padding:8px 15px;border-radius:19px;font-family:inherit;font-size:14px;font-weight:' + (a ? '600' : '500') + ';cursor:pointer;transition:all .15s;white-space:nowrap;border:1px solid ' + (a ? '#007AFF' : 'rgba(60,60,67,.15)') + ';background:' + (a ? '#007AFF' : '#fff') + ';color:' + (a ? '#fff' : '#3c3c43') + ';'; }
  function navStyle(a) { return 'display:flex;align-items:center;gap:11px;padding:11px 13px;border-radius:12px;border:none;margin-bottom:3px;background:' + (a ? 'rgba(0,122,255,.12)' : 'transparent') + ';color:' + (a ? '#007AFF' : '#1c1c1e') + ';font-size:15px;font-weight:' + (a ? '600' : '500') + ';cursor:pointer;text-align:left;font-family:inherit;transition:background .15s;width:100%;'; }
  function toggleStyle(on) { return 'width:51px;height:31px;border-radius:16px;border:none;padding:2px;cursor:pointer;display:flex;align-items:center;transition:background .2s;background:' + (on ? '#34C759' : 'rgba(120,120,128,.24)') + ';justify-content:' + (on ? 'flex-end' : 'flex-start') + ';'; }
  function knobStyle() { return 'width:27px;height:27px;border-radius:50%;background:#fff;box-shadow:0 2px 4px rgba(0,0,0,.2);display:block;'; }
  function weekCardStyle(isToday) { return 'flex:0 0 202px;min-height:232px;display:flex;flex-direction:column;text-align:left;padding:16px;border-radius:18px;background:#fff;border:' + (isToday ? '2px solid #007AFF' : '1px solid rgba(60,60,67,.1)') + ';box-shadow:0 1px 3px rgba(0,0,0,.05);cursor:pointer;font-family:inherit;'; }

  // ── seeded sample data (ported verbatim so it matches the mockups) ────────
  function rng(seed) { var a = seed; return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function genRecords(start, end, tradingDays, seedNum) {
    var r = rng(seedNum);
    var news = ['รอตัวเลข CPI สหรัฐคืนนี้', 'ประชุม FOMC — แถลง Powell', 'Nonfarm Payrolls (NFP) คืนวันศุกร์', 'ดัชนี PMI ภาคการผลิตสหรัฐ', 'ความตึงเครียดภูมิรัฐศาสตร์หนุนทอง', 'ดอลลาร์อ่อนค่า หนุนราคาทอง', 'บอนด์ยีลด์สหรัฐพุ่ง กดดันทอง', 'ตัวเลขจ้างงาน ADP', 'ยอดค้าปลีกสหรัฐ', 'จีนเพิ่มทุนสำรองทองคำ'];
    var pick = function (arr) { return arr[Math.floor(r() * arr.length)]; };
    var rec = {};
    for (var dt = new Date(start); dt <= end; dt.setDate(dt.getDate() + 1)) {
      var dow = dt.getDay(); if (tradingDays.indexOf(dow) === -1) continue;
      var k = keyOf(dt);
      var rr = r();
      var result;
      if (k >= '2026-07-06' && r() < 0.5) result = 'pending';
      else result = rr < 0.64 ? 'correct' : (rr < 0.92 ? 'wrong' : 'pending');
      var bias = pick(OPT.bias).v;
      var up = (bias === 'buy' || bias === 'sw_up');
      var base = Math.round((3300 + Math.round((r() - 0.5) * 130)) / 5) * 5;
      var tSec = base + (up ? 1 : -1) * 5 * (2 + Math.floor(r() * 5));
      var hasNews = r() < 0.42;
      var newsList = hasNews ? [pick(news)] : [];
      var opool = ['put_below', 'call_below', 'put_above', 'call_above'];
      var pickN = function (arr, n) { var c = arr.slice(), o = []; for (var j = 0; j < n && c.length; j++) { o.push(c.splice(Math.floor(r() * c.length), 1)[0]); } return o; };
      var addList = pickN(opool, 1 + Math.floor(r() * 2));
      var wdOn = r() >= 0.3;
      var wdList = wdOn ? pickN(opool, 1 + Math.floor(r() * 2)) : [];
      rec[k] = { bias: bias, result: result, tMain: base, tSec: tSec, news: newsList, newsOn: hasNews, pcr: pick(OPT.pcr).v, oi: pick(OPT.oi).v, add: addList, wd: wdList, wdOn: wdOn, magnet: pick(OPT.magnet).v, iv: pick(OPT.iv).v };
    }
    return rec;
  }
  function seedAll() {
    var gc = genRecords(new Date(2026, 3, 1, 12), new Date(2026, 6, 7, 12), [1, 2, 3, 4, 5], 778821);
    var btc = genRecords(new Date(2026, 4, 4, 12), new Date(2026, 6, 7, 12), [0, 1, 2, 3, 4, 5, 6], 220466);
    return { assets: [{ id: 'gc', name: 'GC', sub: 'ทองคำฟิวเจอร์', badge: 'GC', colors: ['#D4A017', '#FBD34D'], tradingDays: [1, 2, 3, 4, 5] }, { id: 'btc', name: 'BTC', sub: 'Bitcoin · 24/7', badge: '฿', colors: ['#F7931A', '#FDBE5B'], tradingDays: [0, 1, 2, 3, 4, 5, 6] }], activeAssetId: 'gc', records: { gc: gc, btc: btc } };
  }
  function loadData() {
    try { var s = localStorage.getItem(STORE); if (s) { var p = JSON.parse(s); if (p && p.assets && p.records && p.activeAssetId) return p; } } catch (e) {}
    var seeded = seedAll(); try { localStorage.setItem(STORE, JSON.stringify(seeded)); } catch (e) {} return seeded;
  }
  function saveData(blob) { try { localStorage.setItem(STORE, JSON.stringify(blob)); } catch (e) {} }

  // ── application state ─────────────────────────────────────────────────────
  var data = loadData();
  var S = {
    page: 'overview', returnPage: 'overview', period: (PROPS.defaultPeriod === 'week' ? 'month' : PROPS.defaultPeriod) || 'month',
    curY: 2026, curM: 6, focusKey: TODAY,
    assets: data.assets, activeAssetId: data.activeAssetId, records: data.records,
    assetMenuOpen: false, assetEditor: null,
    draft: null, sheetKey: null, sheetIsNew: false, newsInput: '',
    search: '', sortDir: 'desc', filtersOpen: false,
    filters: { result: [], bias: [], news: [], pcr: [], add: [], wd: [], magnet: [], iv: [] }
  };

  function activeAsset() { for (var i = 0; i < S.assets.length; i++) { if (S.assets[i].id === S.activeAssetId) return S.assets[i]; } return S.assets[0]; }
  function findAsset(id) { for (var i = 0; i < S.assets.length; i++) { if (S.assets[i].id === id) return S.assets[i]; } return null; }
  function recs() { return S.records[S.activeAssetId] || {}; }
  function isTradingDow(dow) { return activeAsset().tradingDays.indexOf(dow) > -1; }

  // ── calendar + stats (ported) ─────────────────────────────────────────────
  function weekdayHeaders() { var ws = weekStartNum(); var order = ws === 1 ? [1, 2, 3, 4, 5, 6, 0] : [0, 1, 2, 3, 4, 5, 6]; return order.map(function (i) { return { l: DOW[i], style: 'text-align:center;font-size:12px;font-weight:600;padding-bottom:2px;color:' + ((i === 0 || i === 6) ? 'rgba(60,60,67,.32)' : 'rgba(60,60,67,.55)') + ';' }; }); }
  function cellData(o) {
    var C = resultColor('correct'), W = resultColor('wrong');
    var blank = { dayNum: '', k: o.k, clickable: false, style: 'aspect-ratio:1/1;min-height:60px;border-radius:14px;border:1px solid transparent;background:transparent;', numStyle: 'display:none', badge: '', badgeStyle: 'display:none', dotStyle: 'display:none' };
    if (!o.inMonth) return blank;
    if (o.weekend && !showWeekends()) return blank;
    var bg = '#fff', border = '1px solid rgba(60,60,67,.09)', numColor = '#1c1c1e', numWeight = '600', cursor = o.clickable ? 'pointer' : 'default';
    var badge = '', badgeColor = '', dot = 'none';
    if (o.weekend) { bg = 'rgba(120,120,128,.045)'; border = '1px solid transparent'; numColor = 'rgba(60,60,67,.28)'; numWeight = '500'; }
    if (!o.weekend && o.rec) {
      if (o.rec.result === 'correct') { bg = hexToRgba(C, .1); border = '1px solid ' + hexToRgba(C, .28); badge = 'ถูก'; badgeColor = C; }
      else if (o.rec.result === 'wrong') { bg = hexToRgba(W, .12); border = '1px solid ' + hexToRgba(W, .3); badge = 'ผิด'; badgeColor = W; }
      else { bg = '#fff'; border = '1px dashed rgba(60,60,67,.3)'; badge = 'รอ'; badgeColor = 'rgba(60,60,67,.45)'; }
      var up = (o.rec.bias === 'buy' || o.rec.bias === 'sw_up'), down = (o.rec.bias === 'sell' || o.rec.bias === 'sw_down');
      dot = up ? '#34C759' : (down ? '#FF3B30' : '#8E8E93');
    }
    var base = 'position:relative;aspect-ratio:1/1;min-height:60px;border-radius:14px;padding:8px 9px;display:flex;flex-direction:column;align-items:flex-start;justify-content:space-between;text-align:left;font-family:inherit;background:' + bg + ';border:' + border + ';cursor:' + cursor + ';';
    if (o.k === TODAY) base += 'box-shadow:0 0 0 2px #007AFF inset;';
    return { dayNum: o.dayNum, k: o.k, clickable: !!o.clickable, style: base, numStyle: 'font-size:15px;font-weight:' + numWeight + ';color:' + numColor + ';line-height:1;', badge: badge, badgeStyle: badge ? ('font-size:11px;font-weight:700;color:' + badgeColor + ';') : 'display:none', dotStyle: dot === 'none' ? 'display:none' : ('position:absolute;top:9px;right:9px;width:8px;height:8px;border-radius:50%;background:' + dot + ';') };
  }
  function monthWeeks(y, m) {
    var ws = weekStartNum(); var first = new Date(y, m, 1, 12); var off = (first.getDay() - ws + 7) % 7; var dim = new Date(y, m + 1, 0).getDate(); var rows = Math.ceil((off + dim) / 7); var weeks = []; var rec = recs();
    for (var w = 0; w < rows; w++) { var days = []; for (var d = 0; d < 7; d++) { var dt = new Date(y, m, 1 - off + w * 7 + d, 12); var inM = dt.getMonth() === m && dt.getFullYear() === y; var dow = dt.getDay(); var we = !isTradingDow(dow); var k = keyOf(dt); days.push(cellData({ k: k, dayNum: dt.getDate(), inMonth: inM, weekend: we, rec: rec[k], clickable: inM && !we })); } weeks.push({ days: days }); }
    return weeks;
  }
  function microCell(o) {
    if (!o.inMonth) return { dayNum: '', k: o.k, clickable: false, style: 'width:100%;aspect-ratio:1/1;border-radius:5px;background:transparent;border:none;', txtStyle: 'display:none' };
    var C = resultColor('correct'), W = resultColor('wrong'); var bg = 'transparent', col = 'rgba(60,60,67,.45)';
    if (!o.weekend && o.rec) { if (o.rec.result === 'correct') { bg = C; col = '#fff'; } else if (o.rec.result === 'wrong') { bg = W; col = '#fff'; } else { bg = '#E5E5EA'; col = '#6b6b70'; } }
    else if (o.weekend) { col = 'rgba(60,60,67,.2)'; }
    var st = 'width:100%;aspect-ratio:1/1;border-radius:5px;border:none;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;padding:0;background:' + bg + ';cursor:' + (o.clickable ? 'pointer' : 'default') + ';';
    if (o.k === TODAY) st += 'box-shadow:0 0 0 1.5px #007AFF;';
    return { dayNum: o.dayNum, k: o.k, clickable: !!o.clickable, style: st, txtStyle: 'color:' + col + ';' };
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
    return { label: label, hasData: dec > 0, summary: dec ? (c + ' ถูก · ' + w + ' ผิด') : 'ไม่มีข้อมูล', blueWidth: (dec ? rate : 0) + '%', rateText: dec ? rate + '%' : '–', rateColor: !dec ? 'rgba(60,60,67,.3)' : (rate >= 50 ? C : W) };
  }
  function weeklySummary(weeks) {
    // Count only in-month, non-weekend days (d.clickable === inMonth && !weekend),
    // so records from adjacent months bleeding into a week row aren't tallied.
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

  // ── mutations ─────────────────────────────────────────────────────────────
  function setState(patch) { Object.assign(S, patch); render(); }
  function persist() { saveData({ assets: S.assets, activeAssetId: S.activeAssetId, records: S.records }); }

  function selectAsset(id) { S.activeAssetId = id; persist(); setState({ assetMenuOpen: false, curY: 2026, curM: 6, focusKey: TODAY }); }
  function openAssetEditor(id) { var ed; if (id) { var a = findAsset(id); ed = { id: id, name: a.name, tradingDays: a.tradingDays.slice(), colors: (a.colors || ['#8E8E93', '#B0B0B5']).slice() }; } else { ed = { id: null, name: '', tradingDays: [1, 2, 3, 4, 5], colors: ASSET_COLORS[S.assets.length % ASSET_COLORS.length] }; } setState({ assetEditor: ed, assetMenuOpen: false }); }
  function setEditor(patch) { setState({ assetEditor: Object.assign({}, S.assetEditor, patch) }); }
  function toggleEditorDay(dow) { var td = S.assetEditor.tradingDays.slice(); var i = td.indexOf(dow); if (i > -1) td.splice(i, 1); else td.push(dow); td.sort(function (a, b) { return a - b; }); setEditor({ tradingDays: td }); }
  function saveAsset() {
    var ed = S.assetEditor; if (!ed) return; var name = (ed.name || '').trim(); if (!name) return;
    var td = ed.tradingDays.length ? ed.tradingDays.slice().sort(function (a, b) { return a - b; }) : [1, 2, 3, 4, 5]; var badge = makeBadge(name);
    if (ed.id) { S.assets = S.assets.map(function (a) { return a.id === ed.id ? Object.assign({}, a, { name: name, badge: badge, tradingDays: td, colors: ed.colors }) : a; }); persist(); setState({ assetEditor: null }); }
    else { var id = 'a' + Date.now().toString(36); var na = { id: id, name: name, sub: '', badge: badge, colors: ed.colors, tradingDays: td }; S.assets = S.assets.concat([na]); S.records[id] = {}; S.activeAssetId = id; persist(); setState({ assetEditor: null, curY: 2026, curM: 6, focusKey: TODAY }); }
  }
  function deleteAsset(id) { if (S.assets.length <= 1) return; S.assets = S.assets.filter(function (a) { return a.id !== id; }); delete S.records[id]; if (S.activeAssetId === id) S.activeAssetId = S.assets[0].id; persist(); setState({ assetEditor: null, assetMenuOpen: false }); }

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
    persist(); setState({ page: (S.returnPage || 'overview'), draft: null, sheetKey: null });
  }
  function deleteDraft() { var aid = S.activeAssetId; S.records[aid] = Object.assign({}, S.records[aid] || {}); delete S.records[aid][S.sheetKey]; persist(); setState({ page: (S.returnPage || 'overview'), draft: null, sheetKey: null }); }
  function setField(k, v) { S.draft = Object.assign({}, S.draft); S.draft[k] = v; render(); }
  function setFieldSilent(k, v) { S.draft[k] = v; } // for text/number inputs; no re-render
  function addNewsItem() { var t = (S.newsInput || '').trim(); if (!t) return; var list = (S.draft.news || []).concat([t]); setState({ draft: Object.assign({}, S.draft, { news: list }), newsInput: '' }); }
  function removeNewsItem(i) { var list = (S.draft.news || []).slice(); list.splice(i, 1); setState({ draft: Object.assign({}, S.draft, { news: list }) }); }
  function toggleMulti(field, value) { var cur = (S.draft[field] || []).slice(); var i = cur.indexOf(value); if (i > -1) cur.splice(i, 1); else cur.push(value); S.draft = Object.assign({}, S.draft); S.draft[field] = cur; render(); }
  function toggleFlag(field) { S.draft = Object.assign({}, S.draft); S.draft[field] = !S.draft[field]; render(); }

  function prev() { if (S.period === 'year') setState({ curY: S.curY - 1 }); else { var m = S.curM - 1, y = S.curY; if (m < 0) { m = 11; y--; } setState({ curM: m, curY: y }); } }
  function next() { if (S.period === 'year') setState({ curY: S.curY + 1 }); else { var m = S.curM + 1, y = S.curY; if (m > 11) { m = 0; y++; } setState({ curM: m, curY: y }); } }
  function goToday() { setState({ curY: 2026, curM: 6, focusKey: TODAY }); }
  function setFilter(dim, val) { var arr = (S.filters[dim] || []).slice(); var i = arr.indexOf(val); if (i > -1) arr.splice(i, 1); else arr.push(val); var f = Object.assign({}, S.filters); f[dim] = arr; setState({ filters: f }); }
  function clearFilters() { setState({ filters: { result: [], bias: [], news: [], pcr: [], add: [], wd: [], magnet: [], iv: [] }, search: '' }); }

  // ── render helpers ────────────────────────────────────────────────────────
  var CHEV_R = '<svg width="9" height="15" viewBox="0 0 9 15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 1.5L7 7.5l-5.5 6"></path></svg>';
  var CHEV_L = '<svg width="9" height="15" viewBox="0 0 9 15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M7.5 1.5L2 7.5l5.5 6"></path></svg>';

  function segBtns(dim, cur) { return OPT[dim].map(function (o) { return '<button data-a="setField" data-k="' + dim + '" data-v="' + o.v + '" style="' + segFormStyle(o.v === cur) + '">' + esc(o.l) + '</button>'; }).join(''); }
  function multiBtns(dim, arr) { arr = arr || []; return OPT[dim].map(function (o) { var a = arr.indexOf(o.v) > -1; return '<button data-a="toggleMulti" data-k="' + dim + '" data-v="' + o.v + '" style="' + gridOptStyle(a) + '"><span style="' + (a ? 'font-weight:800;' : 'display:none') + '">✓ </span>' + esc(o.l) + '</button>'; }).join(''); }

  function sidebar() {
    var a = activeAsset();
    var allStats = computeStats(Object.keys(recs()));
    var menu = '';
    if (S.assetMenuOpen) {
      var rows = S.assets.map(function (as) {
        var rc = S.records[as.id] || {}; var st = computeStats(Object.keys(rc), rc); var isActive = as.id === S.activeAssetId;
        return '<div class="c-row" data-a="selectAsset" data-id="' + as.id + '" style="display:flex;align-items:center;gap:10px;padding:8px 9px;border-radius:11px;cursor:pointer;background:' + (isActive ? 'rgba(0,122,255,.09)' : 'transparent') + ';">' +
          '<span style="' + badgeStyleOf(as.colors, 34, 13) + '">' + esc(as.badge || makeBadge(as.name)) + '</span>' +
          '<span style="flex:1;min-width:0;"><span style="display:block;font-size:14px;font-weight:600;">' + esc(as.name) + '</span><span style="display:block;font-size:11px;color:rgba(60,60,67,.5);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(tradingDaysLabel(as.tradingDays) + ' · ' + st.total + ' วัน') + '</span></span>' +
          '<span style="' + (isActive ? 'display:flex;color:#007AFF;flex:none;' : 'display:none') + '"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5l5 5L20 6.5"></path></svg></span>' +
          '<button class="c-editbtn" data-a="openAssetEditor" data-id="' + as.id + '" style="width:28px;height:28px;border-radius:8px;border:none;background:rgba(118,118,128,.12);color:rgba(60,60,67,.6);cursor:pointer;display:flex;align-items:center;justify-content:center;flex:none;transition:background .15s;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3z"></path><path d="M13.5 6.5l3 3"></path></svg></button>' +
          '</div>';
      }).join('');
      menu = '<div data-a="closeAssetMenu" style="position:fixed;inset:0;z-index:35;"></div>' +
        '<div style="position:absolute;top:100%;left:0;right:0;z-index:37;background:#fff;border-radius:16px;box-shadow:0 14px 38px rgba(0,0,0,.2);border:1px solid rgba(60,60,67,.1);padding:7px;margin-top:5px;animation:fadeIn .14s ease;">' +
        '<div style="font-size:11px;font-weight:700;color:rgba(60,60,67,.42);text-transform:uppercase;letter-spacing:.05em;padding:5px 9px;">สินทรัพย์</div>' + rows +
        '<button data-a="addAsset" style="width:100%;display:flex;align-items:center;gap:9px;padding:10px 9px;margin-top:4px;border-top:1px solid rgba(60,60,67,.08);background:none;border:none;cursor:pointer;color:#007AFF;font-weight:600;font-size:14px;font-family:inherit;">' +
        '<span style="width:22px;height:22px;border-radius:7px;background:rgba(0,122,255,.12);display:flex;align-items:center;justify-content:center;"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 5v14M5 12h14"></path></svg></span>เพิ่มสินทรัพย์</button></div>';
    }
    return '<aside style="width:262px;flex:none;position:relative;z-index:30;background:rgba(249,249,251,.97);border-right:1px solid rgba(60,60,67,.13);display:flex;flex-direction:column;padding:20px 15px;">' +
      '<div style="position:relative;margin-bottom:16px;">' +
        '<button class="c-assetbtn" data-a="toggleAssetMenu" style="position:relative;z-index:36;width:100%;display:flex;align-items:center;gap:11px;padding:7px 8px;background:none;border:none;cursor:pointer;text-align:left;border-radius:13px;font-family:inherit;">' +
          '<span style="' + badgeStyleOf(a.colors, 40, 15) + '">' + esc(a.badge || makeBadge(a.name)) + '</span>' +
          '<span style="min-width:0;flex:1;"><span style="display:block;font-size:16px;font-weight:700;letter-spacing:-.01em;">' + esc(a.name) + '</span><span style="display:block;font-size:12px;color:rgba(60,60,67,.5);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(a.sub || tradingDaysLabel(a.tradingDays)) + '</span></span>' +
          '<span style="display:flex;color:rgba(60,60,67,.4);transition:transform .2s;transform:rotate(' + (S.assetMenuOpen ? '90' : '0') + 'deg);"><svg width="8" height="13" viewBox="0 0 9 15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 1.5L7 7.5l-5.5 6"></path></svg></span>' +
        '</button>' + menu +
      '</div>' +
      '<button data-a="navOverview" style="' + navStyle(S.page === 'overview') + '"><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><rect x="3" y="3" width="7" height="8" rx="1.6"></rect><rect x="14" y="3" width="7" height="5" rx="1.6"></rect><rect x="14" y="11" width="7" height="10" rx="1.6"></rect><rect x="3" y="14" width="7" height="7" rx="1.6"></rect></svg>ภาพรวม</button>' +
      '<button data-a="navSearch" style="' + navStyle(S.page === 'search') + '"><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><circle cx="11" cy="11" r="7"></circle><path d="M20 20l-3.2-3.2" stroke-linecap="round"></path></svg>ค้นหา</button>' +
      '<div style="flex:1"></div>' +
      '<div style="padding:10px 12px;border-radius:14px;background:rgba(118,118,128,.09);margin-bottom:10px;">' +
        '<div style="font-size:11px;color:rgba(60,60,67,.5);font-weight:600;margin-bottom:2px;">Win rate ทั้งหมด</div>' +
        '<div style="display:flex;align-items:baseline;gap:6px;"><span style="font-size:24px;font-weight:800;color:' + resultColor('correct') + ';">' + allStats.winPct + '%</span><span style="font-size:12px;color:rgba(60,60,67,.45);">' + allStats.decided + ' ครั้ง</span></div>' +
      '</div>' +
      '<button data-a="addToday" style="padding:13px;border-radius:14px;border:none;background:#007AFF;color:#fff;font-weight:700;font-size:15px;cursor:pointer;box-shadow:0 5px 14px rgba(0,122,255,.32);display:flex;align-items:center;justify-content:center;gap:7px;"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"></path></svg>บันทึกวันนี้</button>' +
    '</aside>';
  }

  function header() {
    if (S.page === 'record') {
      var dateLabel = fmtDowFull(S.sheetKey) + ' ' + fmtLong(S.sheetKey);
      var dateSub = (S.sheetIsNew ? 'บันทึกใหม่' : 'แก้ไขบันทึก') + ' · ' + activeAsset().name;
      return '<div style="display:flex;align-items:center;justify-content:space-between;width:100%;gap:14px;">' +
        '<button data-a="closeSheet" style="display:flex;align-items:center;gap:4px;background:none;border:none;color:#007AFF;font-size:16px;font-weight:500;cursor:pointer;flex:1;justify-content:flex-start;padding:0;"><svg width="10" height="16" viewBox="0 0 9 15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M7.5 1.5L2 7.5l5.5 6"></path></svg>กลับ</button>' +
        '<div style="text-align:center;flex:none;"><div style="font-size:17px;font-weight:800;letter-spacing:-.01em;">' + esc(dateLabel) + '</div><div style="font-size:12px;color:rgba(60,60,67,.5);">' + esc(dateSub) + '</div></div>' +
        '<div style="flex:1;display:flex;justify-content:flex-end;"><button data-a="saveDraft" style="background:#007AFF;border:none;color:#fff;font-size:15px;font-weight:700;padding:9px 20px;border-radius:11px;cursor:pointer;">บันทึก</button></div>' +
      '</div>';
    }
    var right = '';
    if (S.page === 'overview') {
      right = '<div style="display:inline-flex;background:rgba(118,118,128,.12);border-radius:9px;padding:2px;gap:2px;">' +
        [['month', 'เดือน'], ['year', 'ปี']].map(function (p) { return '<button data-a="setPeriod" data-v="' + p[0] + '" style="' + segViewStyle(S.period === p[0]) + '">' + p[1] + '</button>'; }).join('') + '</div>';
    } else {
      right = '<div style="font-size:14px;color:rgba(60,60,67,.5);font-weight:500;">' + filteredResults().length + ' รายการ</div>';
    }
    return '<div style="display:flex;align-items:center;justify-content:space-between;width:100%;">' +
      '<div style="font-size:22px;font-weight:800;letter-spacing:-.02em;">' + (S.page === 'search' ? 'ค้นหา' : 'ภาพรวม') + '</div>' + right + '</div>';
  }

  function kpiCard(cap, valueHtml, subHtml, iconBg, iconColor, icon) {
    return '<div style="background:#fff;border-radius:16px;padding:14px 16px;box-shadow:0 1px 3px rgba(0,0,0,.05);display:flex;flex-direction:column;gap:10px;">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;"><span style="font-size:12.5px;font-weight:600;color:rgba(60,60,67,.6);">' + cap + '</span>' +
      '<span style="width:28px;height:28px;border-radius:8px;background:' + iconBg + ';display:flex;align-items:center;justify-content:center;color:' + iconColor + ';flex:none;">' + icon + '</span></div>' +
      '<div style="display:flex;align-items:baseline;gap:7px;flex-wrap:wrap;">' + valueHtml + subHtml + '</div></div>';
  }

  function overviewBody() {
    var C = resultColor('correct'), W = resultColor('wrong');
    var theme = { correct: C, wrong: W, correctSoft: hexToRgba(C, .12), wrongSoft: hexToRgba(W, .12) };
    var stats = computeStats(scopeKeys());
    var vNum = function (n, color) { return '<span style="font-size:27px;font-weight:800;line-height:1;letter-spacing:-.02em;' + (color ? 'color:' + color + ';' : '') + '">' + n + '</span>'; };
    var sub = function (t) { return '<span style="font-size:11.5px;color:rgba(60,60,67,.45);">' + t + '</span>'; };
    var icCheck = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5l5 5L20 6.5"></path></svg>';
    var icX = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"></path></svg>';
    var icTarget = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8.5"></circle><circle cx="12" cy="12" r="3.5"></circle></svg>';
    var icCal = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="15.5" rx="3"></rect><path d="M3.5 9.5h17M8 3v4M16 3v4"></path></svg>';
    var icDoc = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4.5" y="3.5" width="15" height="17" rx="2.5"></rect><path d="M8 8.5h8M8 12.5h8M8 16.5h5"></path></svg>';
    var kpis = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(184px,1fr));gap:12px;margin-bottom:20px;">' +
      kpiCard('Bias ถูก', vNum(stats.correct, theme.correct), sub('ครั้งในช่วงนี้'), theme.correctSoft, theme.correct, icCheck) +
      kpiCard('Bias ผิด', vNum(stats.wrong, theme.wrong), sub('ครั้งในช่วงนี้'), theme.wrongSoft, theme.wrong, icX) +
      kpiCard('อัตราชนะ', vNum(stats.winPct + '%', theme.correct), sub('ถูก ' + stats.correct + ' · ผิด ' + stats.wrong), theme.correctSoft, theme.correct, icTarget) +
      kpiCard('จดทั้งหมด', vNum(stats.total), sub('วันเทรด'), 'rgba(120,120,128,.12)', '#8E8E93', icCal) +
      kpiCard('วันมีข่าว', vNum(stats.news, '#AF52DE'), sub('มีข่าวสำคัญ'), 'rgba(175,82,222,.13)', '#AF52DE', icDoc) +
    '</div>';

    var periodLabel = S.period === 'year' ? String(S.curY + 543) : (MONTHS_FULL[S.curM] + ' ' + (S.curY + 543));
    var calInner;
    if (S.period === 'year') {
      calInner = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:20px;">' +
        yearMonths(S.curY).map(function (ym) {
          return '<div><div style="font-size:14px;font-weight:700;margin-bottom:9px;">' + ym.name + '</div>' +
            ym.weeks.map(function (wk) {
              return '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:3px;margin-bottom:3px;">' +
                wk.days.map(function (mc) { return '<button ' + (mc.clickable ? 'data-a="openDay" data-k="' + mc.k + '" class="c-microcell"' : '') + ' style="' + mc.style + '"><span style="' + mc.txtStyle + '">' + mc.dayNum + '</span></button>'; }).join('') + '</div>';
            }).join('') + '</div>';
        }).join('') + '</div>';
    } else {
      var wh = weekdayHeaders().map(function (h) { return '<div style="' + h.style + '">' + h.l + '</div>'; }).join('');
      var weeks = monthWeeks(S.curY, S.curM);
      var wksHtml = weeks.map(function (w) {
        return '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:7px;margin-bottom:7px;">' +
          w.days.map(function (c) { return '<button ' + (c.clickable ? 'data-a="openDay" data-k="' + c.k + '" class="c-cell"' : '') + ' style="' + c.style + '"><span style="' + c.numStyle + '">' + c.dayNum + '</span><span style="' + c.dotStyle + '"></span><span style="' + c.badgeStyle + '">' + c.badge + '</span></button>'; }).join('') + '</div>';
      }).join('');
      var legend = '<div style="display:flex;flex-wrap:wrap;gap:16px;margin-top:14px;padding-top:14px;border-top:1px solid rgba(60,60,67,.09);font-size:12px;color:rgba(60,60,67,.55);">' +
        '<span style="display:flex;align-items:center;gap:6px;"><span style="width:13px;height:13px;border-radius:4px;background:' + theme.correctSoft + ';border:1px solid ' + theme.correct + ';"></span>Bias ถูก</span>' +
        '<span style="display:flex;align-items:center;gap:6px;"><span style="width:13px;height:13px;border-radius:4px;background:' + theme.wrongSoft + ';border:1px solid ' + theme.wrong + ';"></span>Bias ผิด</span>' +
        '<span style="display:flex;align-items:center;gap:6px;"><span style="width:13px;height:13px;border-radius:4px;border:1px dashed rgba(60,60,67,.35);"></span>รอสรุป</span>' +
        '<span style="display:flex;align-items:center;gap:6px;"><span style="width:9px;height:9px;border-radius:50%;background:#34C759;"></span>ทิศขึ้น<span style="width:9px;height:9px;border-radius:50%;background:#FF3B30;margin-left:8px;"></span>ทิศลง</span></div>';
      calInner = '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:7px;margin-bottom:8px;">' + wh + '</div>' + wksHtml + legend;
    }
    var calPanel = '<div style="flex:1 1 580px;min-width:0;background:#fff;border-radius:22px;padding:20px 22px;box-shadow:0 1px 3px rgba(0,0,0,.05);">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">' +
        '<div style="display:flex;align-items:center;gap:8px;">' +
          '<button data-a="prev" style="width:34px;height:34px;border-radius:10px;border:none;background:rgba(118,118,128,.11);color:#007AFF;cursor:pointer;display:flex;align-items:center;justify-content:center;">' + CHEV_L + '</button>' +
          '<div style="font-size:19px;font-weight:800;min-width:210px;text-align:center;letter-spacing:-.01em;">' + periodLabel + '</div>' +
          '<button data-a="next" style="width:34px;height:34px;border-radius:10px;border:none;background:rgba(118,118,128,.11);color:#007AFF;cursor:pointer;display:flex;align-items:center;justify-content:center;">' + CHEV_R + '</button>' +
        '</div>' +
        '<button data-a="today" style="padding:8px 16px;border-radius:11px;border:none;background:rgba(0,122,255,.1);color:#007AFF;font-weight:600;font-size:14px;cursor:pointer;">วันนี้</button>' +
      '</div>' + calInner + '</div>';

    var rightIsYear = S.period === 'year';
    var rightRows = rightIsYear ? monthlySummary(S.curY) : weeklySummary(monthWeeks(S.curY, S.curM));
    var rows = rightRows.map(function (r) {
      return '<div style="padding:11px 0;border-bottom:1px solid rgba(60,60,67,.08);">' +
        '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px;"><span style="font-size:14px;font-weight:700;">' + r.label + '</span><span style="font-size:12px;color:rgba(60,60,67,.55);">' + r.summary + '</span></div>' +
        '<div style="display:flex;align-items:center;gap:9px;"><div style="flex:1;height:8px;border-radius:4px;background:rgba(120,120,128,.14);overflow:hidden;"><div style="height:100%;width:' + r.blueWidth + ';background:' + theme.correct + ';border-radius:4px;transition:width .3s;"></div></div>' +
        '<span style="font-size:12px;font-weight:800;color:' + r.rateColor + ';min-width:36px;text-align:right;">' + r.rateText + '</span></div></div>';
    }).join('');
    var rightPanel = '<div style="flex:0 1 336px;min-width:288px;background:#fff;border-radius:22px;padding:19px 21px;box-shadow:0 1px 3px rgba(0,0,0,.05);">' +
      '<div style="font-size:16px;font-weight:800;margin-bottom:6px;letter-spacing:-.01em;">' + (rightIsYear ? 'สรุปรายเดือน' : 'สรุปรายสัปดาห์') + '</div>' +
      '<div style="font-size:12px;color:rgba(60,60,67,.5);margin-bottom:14px;">สัดส่วน Bias ถูก แต่ละช่วง</div>' + rows + '</div>';

    return '<div style="max-width:1440px;margin:0 auto;padding:24px 28px 64px;">' + kpis +
      '<div style="display:flex;gap:18px;align-items:flex-start;flex-wrap:wrap;">' + calPanel + rightPanel + '</div></div>';
  }

  function searchBody() {
    var results = filteredResults();
    var fcount = 0; for (var fk in S.filters) fcount += (S.filters[fk] || []).length;
    var hasFilters = (!!S.search.trim()) || fcount > 0;
    var filterChevron = 'display:flex;transition:transform .2s;transform:rotate(' + (S.filtersOpen ? '90' : '0') + 'deg);';
    var groups = [
      { label: 'ผลลัพธ์', dim: 'result', opts: OPT.result },
      { label: 'Bias', dim: 'bias', opts: OPT.bias },
      { label: 'ข่าว', dim: 'news', opts: [{ v: 'yes', l: 'มีข่าว' }, { v: 'no', l: 'ไม่มีข่าว' }] },
      { label: 'PCR OI Change', dim: 'pcr', opts: OPT.pcr },
      { label: 'เติมเงิน', dim: 'add', opts: OPT.add },
      { label: 'ถอนเงิน', dim: 'wd', opts: OPT.wd },
      { label: 'Magnet', dim: 'magnet', opts: OPT.magnet },
      { label: 'IV', dim: 'iv', opts: OPT.iv }
    ];
    var groupsHtml = groups.map(function (g) {
      var chips = g.opts.map(function (o) { var active = (S.filters[g.dim] || []).indexOf(o.v) > -1; return '<button data-a="setFilter" data-dim="' + g.dim + '" data-v="' + o.v + '" style="' + chipStyle(active) + '"><span style="' + (active ? 'font-weight:800;' : 'display:none') + '">✓ </span>' + esc(o.l) + '</button>'; }).join('');
      return '<div style="margin-bottom:9px;"><div style="font-size:11px;font-weight:700;color:rgba(60,60,67,.5);text-transform:uppercase;letter-spacing:.04em;margin-bottom:7px;">' + g.label + '</div><div style="display:flex;flex-wrap:wrap;gap:6px;">' + chips + '</div></div>';
    }).join('');

    var filterCard = '<div style="background:#fff;border-radius:18px;box-shadow:0 1px 3px rgba(0,0,0,.05);margin-bottom:16px;overflow:hidden;">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:15px 18px;">' +
        '<button data-a="toggleFilters" style="flex:1;min-width:0;display:flex;align-items:center;gap:9px;background:none;border:none;cursor:pointer;text-align:left;padding:0;font-family:inherit;">' +
          '<span style="' + filterChevron + '"><svg width="9" height="14" viewBox="0 0 9 15" fill="none" stroke="rgba(60,60,67,.5)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 1.5L7 7.5l-5.5 6"></path></svg></span>' +
          '<span style="font-size:14px;font-weight:800;color:#1c1c1e;">ตัวกรอง</span>' +
          (fcount > 0 ? '<span style="font-size:12px;font-weight:700;color:#fff;background:#007AFF;border-radius:20px;padding:2px 9px;min-width:20px;text-align:center;">' + fcount + '</span>' : '') +
        '</button>' +
        (hasFilters ? '<button data-a="clearFilters" style="font-size:13px;color:#007AFF;background:none;border:none;cursor:pointer;font-weight:600;white-space:nowrap;flex:none;">ล้างทั้งหมด</button>' : '') +
      '</div>' +
      (S.filtersOpen ? '<div style="padding:0 18px 10px;border-top:1px solid rgba(60,60,67,.07);"><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:11px 24px;margin-top:14px;">' + groupsHtml + '</div></div>' : '') +
    '</div>';

    var fC = 0, fW = 0; results.forEach(function (e) { if (e.result === 'correct') fC++; else if (e.result === 'wrong') fW++; }); var fD = fC + fW;
    var statsLine = fD > 0 ? '<span style="font-size:13px;color:rgba(60,60,67,.55);">Bias <span style="color:' + resultColor('correct') + ';font-weight:700;">ถูก ' + fC + '</span> · <span style="color:' + resultColor('wrong') + ';font-weight:700;">ผิด ' + fW + '</span> · ชนะ <span style="font-weight:800;color:#1c1c1e;">' + (fD ? Math.round(fC / fD * 100) : 0) + '%</span></span>' : '';
    var sortLabel = (S.sortDir === 'desc') ? 'ใหม่ → เก่า' : 'เก่า → ใหม่';
    var resultsHead = '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin:4px 2px 13px;">' +
      '<div style="display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;"><span style="font-size:16px;font-weight:800;">' + results.length + ' รายการ</span>' + statsLine + '</div>' +
      '<button data-a="toggleSort" style="font-size:13px;color:#007AFF;background:rgba(0,122,255,.08);border:none;border-radius:9px;padding:8px 14px;cursor:pointer;font-weight:600;white-space:nowrap;">↕ ' + sortLabel + '</button></div>';

    var list = results.length ? results.map(function (e) { return resultCard(e); }).join('') :
      '<div style="text-align:center;padding:70px 20px;color:rgba(60,60,67,.35);"><svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" style="margin-bottom:10px;"><circle cx="11" cy="11" r="7"></circle><path d="M20 20l-3.2-3.2" stroke-linecap="round"></path></svg><div style="font-size:16px;font-weight:600;color:rgba(60,60,67,.5);">ไม่พบรายการ</div><div style="font-size:14px;margin-top:6px;">ลองปรับคำค้นหรือตัวกรอง</div></div>';

    var searchInput = '<div style="position:relative;margin-bottom:16px;">' +
      '<span style="position:absolute;left:16px;top:50%;transform:translateY(-50%);color:rgba(60,60,67,.4);display:flex;"><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><circle cx="11" cy="11" r="7"></circle><path d="M20 20l-3.2-3.2" stroke-linecap="round"></path></svg></span>' +
      '<input class="inp-search" data-a="search" value="' + esc(S.search) + '" placeholder="ค้นหาวันที่ หรือข่าว เช่น CPI, FOMC, NFP..." style="width:100%;padding:15px 16px 15px 46px;border-radius:14px;border:1px solid rgba(60,60,67,.1);background:#fff;font-size:16px;box-shadow:0 1px 3px rgba(0,0,0,.04);"></div>';

    return '<div style="max-width:1060px;margin:0 auto;padding:22px 28px 72px;">' + searchInput + filterCard + resultsHead + list + '</div>';
  }

  function resultCard(e) {
    var bi = biasMeta(e.bias), rm = resultMeta(e.result); var a = e.k.split('-').map(Number); var dt = new Date(a[0], a[1] - 1, a[2], 12);
    var hn = (e.newsOn && e.news && e.news.length > 0);
    var tag = function (t) { return '<span style="font-size:11px;font-weight:600;color:rgba(60,60,67,.72);background:rgba(118,118,128,.1);padding:4px 9px;border-radius:7px;">' + t + '</span>'; };
    return '<button data-a="openDay" data-k="' + e.k + '" class="c-card" style="width:100%;text-align:left;display:flex;align-items:stretch;gap:0;margin-bottom:10px;background:#fff;border:none;border-radius:16px;box-shadow:0 1px 3px rgba(0,0,0,.05);cursor:pointer;overflow:hidden;transition:transform .12s, box-shadow .12s;">' +
      '<span style="width:5px;flex:none;background:' + rm.color + ';"></span>' +
      '<div style="flex:1;min-width:0;display:flex;gap:15px;align-items:center;padding:14px 16px;">' +
        '<div style="min-width:54px;text-align:center;flex:none;"><div style="font-size:24px;font-weight:800;line-height:1;">' + a[2] + '</div><div style="font-size:11px;color:rgba(60,60,67,.55);margin-top:3px;">' + MONTHS_SHORT[a[1] - 1] + ' ' + (a[0] + 543) + '</div><div style="font-size:11px;color:rgba(60,60,67,.4);">' + DOW_FULL[dt.getDay()] + '</div></div>' +
        '<div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:7px;">' +
          '<div style="display:flex;align-items:center;gap:9px;flex-wrap:wrap;"><span style="font-size:12px;font-weight:700;padding:4px 11px;border-radius:8px;background:' + rm.soft + ';color:' + rm.color + ';">' + rm.label + '</span>' +
            '<span style="font-size:14px;font-weight:700;color:' + bi.color + ';">' + bi.arrow + ' ' + esc(bi.label) + '</span>' +
            '<span style="font-size:13px;color:rgba(60,60,67,.5);">เป้า ' + esc(e.tMain) + ' / ' + esc(e.tSec) + '</span></div>' +
          '<div style="display:flex;gap:6px;flex-wrap:wrap;">' + tag('PCR ' + optLabel('pcr', e.pcr)) + tag('OI ' + optLabel('oi', e.oi)) + tag('Magnet ' + optLabel('magnet', e.magnet)) + tag('IV ' + optLabel('iv', e.iv)) +
            (hn ? '<span style="font-size:11px;font-weight:600;color:#AF52DE;background:rgba(175,82,222,.1);padding:4px 9px;border-radius:7px;">📰 ' + esc(e.news.join(' · ')) + '</span>' : '') + '</div>' +
        '</div>' +
        '<span style="color:rgba(60,60,67,.28);flex:none;"><svg width="9" height="15" viewBox="0 0 9 15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 1.5L7 7.5l-5.5 6"></path></svg></span>' +
      '</div></button>';
  }

  function sectionTitle(title, aux) {
    return '<div style="display:flex;align-items:center;gap:9px;margin:0 2px 13px;"><span style="width:4px;height:17px;border-radius:2px;background:#007AFF;flex:none;"></span><span style="font-size:16px;font-weight:800;letter-spacing:-.01em;">' + title + '</span>' + (aux ? '<span style="font-size:12px;color:rgba(60,60,67,.45);font-weight:500;">' + aux + '</span>' : '') + '</div>';
  }
  function fieldRow(label, control, noBorder) {
    return '<div style="display:flex;align-items:center;gap:14px;padding:15px 0;' + (noBorder ? '' : 'border-bottom:1px solid rgba(60,60,67,.07);') + '"><div style="font-size:15px;font-weight:600;min-width:92px;flex:none;">' + label + '</div><div style="flex:1;display:flex;gap:3px;background:rgba(118,118,128,.1);border-radius:10px;padding:3px;">' + control + '</div></div>';
  }

  function recordBody() {
    var d = S.draft;
    var imgGroups = imageGroups().map(function (g) {
      return '<div style="background:#fff;border-radius:18px;padding:15px 17px;box-shadow:0 1px 3px rgba(0,0,0,.05);">' +
        '<div style="display:flex;align-items:baseline;gap:9px;margin-bottom:12px;"><span style="font-size:15px;font-weight:700;">' + g.label + '</span><span style="font-size:12px;color:rgba(60,60,67,.45);">' + g.time + '</span></div>' +
        '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;">' +
        g.items.map(function (it) { return '<div style="display:flex;flex-direction:column;gap:6px;"><div style="height:122px;border-radius:12px;overflow:hidden;background:rgba(118,118,128,.08);"><image-slot id="' + it.id + '" placeholder="' + esc(it.placeholder) + '" shape="rounded" radius="12"></image-slot></div><span style="font-size:11px;font-weight:600;color:rgba(60,60,67,.55);text-align:center;">' + esc(it.label) + '</span></div>'; }).join('') +
        '</div></div>';
    }).join('');
    var imagesSection = '<div style="margin-bottom:24px;">' + sectionTitle('รูปภาพประกอบ', 'แยกตามช่วงเวลา') +
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(420px,1fr));gap:14px;">' + imgGroups + '</div></div>';

    // target inputs
    var tInput = function (val, act, capt) { return '<label style="flex:1;display:flex;flex-direction:column;gap:4px;"><input class="inp-form" data-a="input" data-k="' + act + '" value="' + esc(val === undefined ? '' : val) + '" type="number" inputmode="decimal" placeholder="0" style="width:100%;padding:11px 13px;border-radius:10px;border:1px solid rgba(60,60,67,.16);background:#F2F2F7;font-size:16px;text-align:right;font-weight:600;"><span style="font-size:11px;color:rgba(60,60,67,.45);text-align:right;">' + capt + '</span></label>'; };

    // news block
    var newsBlock = '';
    if (d.newsOn) {
      var items = (d.news || []).length ? '<div style="display:flex;flex-direction:column;gap:7px;">' + (d.news || []).map(function (t, i) { return '<div style="display:flex;align-items:center;gap:10px;padding:9px 12px;background:#F2F2F7;border-radius:10px;"><span style="flex:1;font-size:14px;color:#1c1c1e;">' + esc(t) + '</span><button data-a="removeNews" data-i="' + i + '" style="width:22px;height:22px;border-radius:50%;border:none;background:rgba(60,60,67,.14);color:rgba(60,60,67,.65);font-size:12px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex:none;">✕</button></div>'; }).join('') + '</div>' : '<div style="font-size:13px;color:rgba(60,60,67,.4);">ยังไม่มีข่าว · พิมพ์แล้วกดเพิ่ม</div>';
      newsBlock = '<div style="margin-top:13px;"><div style="display:flex;gap:8px;margin-bottom:10px;">' +
        '<input class="inp-form" data-a="newsInput" data-k="newsInput" value="' + esc(S.newsInput) + '" type="text" placeholder="พิมพ์ข่าว แล้วกด Enter เช่น CPI สหรัฐ 19:30" style="flex:1;padding:11px 13px;border-radius:10px;border:1px solid rgba(60,60,67,.16);background:#F2F2F7;font-size:15px;">' +
        '<button data-a="addNews" style="padding:0 20px;border-radius:10px;border:none;background:#007AFF;color:#fff;font-weight:700;font-size:14px;cursor:pointer;white-space:nowrap;">+ เพิ่ม</button></div>' + items + '</div>';
    }
    var tradeCard = '<div><div style="display:flex;align-items:center;gap:9px;margin:0 2px 13px;"><span style="width:4px;height:17px;border-radius:2px;background:#007AFF;flex:none;"></span><span style="font-size:16px;font-weight:800;letter-spacing:-.01em;">ข้อมูลเทรด</span></div>' +
      '<div style="background:#fff;border-radius:18px;padding:4px 18px;box-shadow:0 1px 3px rgba(0,0,0,.05);">' +
        fieldRow('Bias', segBtns('bias', d.bias)) +
        '<div style="display:flex;align-items:center;gap:14px;padding:15px 0;border-bottom:1px solid rgba(60,60,67,.07);"><div style="font-size:15px;font-weight:600;min-width:92px;flex:none;">เป้าหมาย</div><div style="flex:1;display:flex;gap:10px;">' + tInput(d.tMain, 'tMain', 'เป้าหลัก') + tInput(d.tSec, 'tSec', 'เป้ารอง') + '</div></div>' +
        '<div style="padding:15px 0;"><div style="display:flex;align-items:center;justify-content:space-between;"><span style="font-size:15px;font-weight:600;">มีข่าว</span><button data-a="toggleFlag" data-k="newsOn" style="' + toggleStyle(!!d.newsOn) + '"><span style="' + knobStyle() + '"></span></button></div>' + newsBlock + '</div>' +
      '</div></div>';

    var resultCardEl = '<div><div style="display:flex;align-items:center;gap:9px;margin:0 2px 13px;"><span style="width:4px;height:17px;border-radius:2px;background:#007AFF;flex:none;"></span><span style="font-size:16px;font-weight:800;letter-spacing:-.01em;">ผลลัพธ์</span></div>' +
      '<div style="background:#fff;border-radius:18px;padding:4px 18px;box-shadow:0 1px 3px rgba(0,0,0,.05);">' + fieldRow('Bias ถูก/ผิด', segBtns('result', d.result), true) + '</div>' +
      (!S.sheetIsNew ? '<button data-a="deleteDraft" style="width:100%;margin-top:14px;padding:13px;border-radius:14px;border:none;background:rgba(255,59,48,.1);color:#FF3B30;font-size:15px;font-weight:600;cursor:pointer;">ลบบันทึก</button>' : '') + '</div>';

    var leftCol = '<div style="flex:1 1 384px;min-width:0;display:flex;flex-direction:column;gap:24px;">' + tradeCard + resultCardEl + '</div>';

    var wdBlock = d.wdOn ? '<div style="margin-top:12px;"><div style="font-size:11px;color:rgba(60,60,67,.42);margin-bottom:9px;">เลือกได้หลายตัว</div><div style="display:grid;grid-template-columns:1fr 1fr;gap:7px;">' + multiBtns('wd', d.wd) + '</div></div>' : '';
    var researchCard = '<div style="flex:1 1 384px;min-width:0;">' + sectionTitle('ข้อมูลวิจัย', 'Option Flow') +
      '<div style="background:#fff;border-radius:18px;padding:4px 18px;box-shadow:0 1px 3px rgba(0,0,0,.05);">' +
        fieldRow('PCR OI Change', segBtns('pcr', d.pcr)) +
        '<div style="display:flex;align-items:baseline;gap:8px;padding:15px 2px 11px;margin-top:2px;border-top:1px solid rgba(60,60,67,.09);"><span style="font-size:13px;font-weight:800;color:#007AFF;letter-spacing:.02em;">อ่าน Strike</span><span style="font-size:11px;color:rgba(60,60,67,.42);">เม็ดเงินMMจากออปชัน</span></div>' +
        '<div style="padding:6px 0 15px;border-bottom:1px solid rgba(60,60,67,.07);"><div style="display:flex;align-items:baseline;gap:8px;margin-bottom:10px;"><span style="font-size:15px;font-weight:600;">เติมเงิน</span><span style="font-size:11px;color:rgba(60,60,67,.42);">เลือกได้หลายตัว</span></div><div style="display:grid;grid-template-columns:1fr 1fr;gap:7px;">' + multiBtns('add', d.add) + '</div></div>' +
        '<div style="padding:15px 0;border-bottom:1px solid rgba(60,60,67,.07);"><div style="display:flex;align-items:center;justify-content:space-between;"><span style="font-size:15px;font-weight:600;">ถอนเงิน</span><button data-a="toggleFlag" data-k="wdOn" style="' + toggleStyle(!!d.wdOn) + '"><span style="' + knobStyle() + '"></span></button></div>' + wdBlock + '</div>' +
        fieldRow('Magnet', segBtns('magnet', d.magnet)) +
        fieldRow('IV', segBtns('iv', d.iv), true) +
      '</div></div>';

    return '<div style="max-width:1120px;margin:0 auto;padding:24px 28px 80px;">' + imagesSection +
      '<div style="display:flex;gap:20px;align-items:flex-start;flex-wrap:wrap;">' + leftCol + researchCard + '</div></div>';
  }

  function assetEditorModal() {
    if (!S.assetEditor) return '';
    var ed = S.assetEditor; var nm = (ed.name || '').trim();
    var dayOpts = [0, 1, 2, 3, 4, 5, 6].map(function (i) { var on = ed.tradingDays.indexOf(i) > -1; return '<button data-a="editorDay" data-i="' + i + '" style="' + dayChipStyle(on) + '">' + DOW[i] + '</button>'; }).join('');
    var colorOpts = ASSET_COLORS.map(function (c, idx) { var on = c[0] === ed.colors[0]; return '<button data-a="editorColor" data-i="' + idx + '" style="' + colorSwatchStyle(c, on) + '"><span style="' + (on ? 'color:#fff;font-size:15px;font-weight:800;line-height:1;' : 'display:none') + '">✓</span></button>'; }).join('');
    return '<div data-a="closeEditor" style="position:fixed;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(0,0,0,.34);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);animation:fadeIn .2s ease;">' +
      '<div data-a="stop" style="width:100%;max-width:452px;background:#fff;border-radius:24px;box-shadow:0 30px 70px rgba(0,0,0,.34);animation:sheetIn .3s cubic-bezier(.2,.75,.2,1);overflow:hidden;">' +
        '<div style="padding:22px 24px 8px;"><div style="font-size:20px;font-weight:800;letter-spacing:-.02em;">' + (ed.id ? 'แก้ไขสินทรัพย์' : 'เพิ่มสินทรัพย์') + '</div><div style="font-size:13px;color:rgba(60,60,67,.5);margin-top:2px;">ตั้งชื่อ เลือกสี และวันที่เทรด</div></div>' +
        '<div style="padding:16px 24px 4px;display:flex;flex-direction:column;gap:22px;">' +
          '<div style="display:flex;align-items:flex-end;gap:14px;"><span style="' + badgeStyleOf(ed.colors, 48, 18) + '">' + esc(makeBadge(ed.name)) + '</span>' +
            '<label style="flex:1;min-width:0;"><span style="display:block;font-size:12px;font-weight:600;color:rgba(60,60,67,.55);margin-bottom:6px;">ชื่อสินทรัพย์</span><input class="inp-form" data-a="editorName" value="' + esc(ed.name) + '" placeholder="เช่น GC, SET50, BTC" style="width:100%;padding:12px 14px;border-radius:12px;border:1px solid rgba(60,60,67,.16);background:#F2F2F7;font-size:16px;font-weight:600;"></label></div>' +
          '<div><div style="font-size:12px;font-weight:600;color:rgba(60,60,67,.55);margin-bottom:10px;">สี</div><div style="display:flex;gap:11px;flex-wrap:wrap;">' + colorOpts + '</div></div>' +
          '<div><div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:10px;"><span style="font-size:12px;font-weight:600;color:rgba(60,60,67,.55);">วันที่เทรด</span><span style="font-size:11px;font-weight:600;color:#007AFF;">' + esc(tradingDaysLabel(ed.tradingDays)) + '</span></div><div style="display:flex;gap:6px;">' + dayOpts + '</div></div>' +
        '</div>' +
        '<div style="display:flex;align-items:center;gap:10px;padding:18px 24px 22px;">' +
          (ed.id && S.assets.length > 1 ? '<button data-a="deleteAsset" style="padding:12px 16px;border-radius:13px;border:none;background:rgba(255,59,48,.1);color:#FF3B30;font-weight:600;font-size:15px;cursor:pointer;">ลบ</button>' : '') +
          '<div style="flex:1"></div>' +
          '<button data-a="closeEditor" style="padding:12px 20px;border-radius:13px;border:none;background:rgba(118,118,128,.14);color:#1c1c1e;font-weight:600;font-size:15px;cursor:pointer;">ยกเลิก</button>' +
          '<button data-a="saveAsset" style="padding:12px 26px;border-radius:13px;border:none;background:' + (nm ? '#007AFF' : 'rgba(0,122,255,.4)') + ';color:#fff;font-weight:700;font-size:15px;cursor:' + (nm ? 'pointer' : 'not-allowed') + ';">บันทึก</button>' +
        '</div>' +
      '</div></div>';
  }

  // ── render ────────────────────────────────────────────────────────────────
  var root = document.getElementById('app');
  function captureFocus() {
    var el = document.activeElement;
    if (!el || !el.dataset || el.dataset.a == null || !root.contains(el)) return null;
    var info = { a: el.dataset.a, k: el.dataset.k || '', dim: el.dataset.dim || '' };
    try { if (el.type !== 'number') { info.start = el.selectionStart; info.end = el.selectionEnd; } } catch (e) {}
    return info;
  }
  function restoreFocus(info) {
    if (!info) return;
    var sel = '[data-a="' + info.a + '"]' + (info.k ? '[data-k="' + info.k + '"]' : '') + (info.dim ? '[data-dim="' + info.dim + '"]' : '');
    var el = root.querySelector(sel);
    if (!el) return;
    el.focus();
    if (info.start != null && el.setSelectionRange) { try { el.setSelectionRange(info.start, info.end); } catch (e) {} }
  }
  function captureScroll() { var s = root.querySelector('#mainScroll'); return s ? s.scrollTop : 0; }

  function render() {
    var focus = captureFocus();
    var scroll = captureScroll();
    var body = S.page === 'overview' ? overviewBody() : S.page === 'search' ? searchBody() : recordBody();
    root.innerHTML =
      '<div style="display:flex;height:100vh;width:100%;overflow:hidden;">' + sidebar() +
        '<main style="flex:1;display:flex;flex-direction:column;min-width:0;min-height:0;">' +
          '<header style="flex:none;height:62px;display:flex;align-items:center;justify-content:space-between;padding:0 28px;background:rgba(255,255,255,.78);backdrop-filter:saturate(180%) blur(20px);-webkit-backdrop-filter:saturate(180%) blur(20px);border-bottom:1px solid rgba(60,60,67,.12);z-index:5;">' + header() + '</header>' +
          '<div id="mainScroll" style="flex:1;overflow:auto;min-height:0;">' + body + '</div>' +
        '</main>' +
      '</div>' + assetEditorModal();
    var s = root.querySelector('#mainScroll'); if (s) s.scrollTop = scroll;
    restoreFocus(focus);
  }

  // ── event delegation ──────────────────────────────────────────────────────
  var NUMERIC = { tMain: 1, tSec: 1 };
  var ACTIONS = {
    toggleAssetMenu: function () { setState({ assetMenuOpen: !S.assetMenuOpen }); },
    closeAssetMenu: function () { setState({ assetMenuOpen: false }); },
    selectAsset: function (ds) { selectAsset(ds.id); },
    openAssetEditor: function (ds) { openAssetEditor(ds.id); },
    addAsset: function () { openAssetEditor(null); },
    navOverview: function () { setState({ page: 'overview' }); },
    navSearch: function () { setState({ page: 'search' }); },
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
    stop: function (ds, e) { e.stopPropagation(); }
  };

  root.addEventListener('click', function (e) {
    var el = e.target.closest('[data-a]');
    if (!el || !root.contains(el)) return;
    var a = el.dataset.a;
    if (a === 'stop') return; // container; let inner clicks pass
    var fn = ACTIONS[a];
    if (fn) { e.stopPropagation(); fn(el.dataset, e); }
  });
  root.addEventListener('input', function (e) {
    var el = e.target; if (!el.dataset) return; var a = el.dataset.a;
    if (a === 'input') { if (NUMERIC[el.dataset.k]) setFieldSilent(el.dataset.k, el.value); }
    else if (a === 'search') { setState({ search: el.value }); }
    else if (a === 'newsInput') { S.newsInput = el.value; }
    else if (a === 'editorName') { setEditor({ name: el.value }); }
  });
  root.addEventListener('keydown', function (e) {
    var el = e.target; if (el.dataset && el.dataset.a === 'newsInput' && e.key === 'Enter') { e.preventDefault(); addNewsItem(); }
    if (e.key === 'Escape') { if (S.assetEditor) setState({ assetEditor: null }); else if (S.assetMenuOpen) setState({ assetMenuOpen: false }); }
  });

  render();
})();
