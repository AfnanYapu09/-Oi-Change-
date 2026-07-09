/*
 * tests/smoke.mjs — headless smoke test for CI.
 * Serves the repo over a local static server, loads the app in Chromium, and
 * asserts it boots cleanly (no uncaught errors) and that the seeded book renders
 * the expected figures and core flows (open a day, save, year view, search).
 * Run with: npm test   (requires: npx playwright install chromium)
 */
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright';

const ROOT = process.cwd();
const TYPES = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.mjs': 'text/javascript', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

function startServer() {
  const server = http.createServer(async (req, res) => {
    try {
      let p = decodeURIComponent((req.url || '/').split('?')[0]);
      if (p === '/') p = '/index.html';
      const file = normalize(join(ROOT, p));
      if (!file.startsWith(ROOT) || !existsSync(file) || !statSync(file).isFile()) {
        res.writeHead(404); res.end('not found'); return;
      }
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
      res.end(body);
    } catch (e) { res.writeHead(500); res.end(String(e)); }
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

let failures = 0;
function check(name, cond, extra) {
  if (cond) { console.log('  ✓ ' + name); }
  else { failures++; console.error('  ✗ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const server = await startServer();
const port = server.address().port;
const base = `http://127.0.0.1:${port}/index.html`;
console.log('serving on ' + base);

const browser = await chromium.launch();
const pageErrors = [];
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', e => pageErrors.push(String(e)));
await page.addInitScript(() => { try { localStorage.clear(); } catch (e) {} });

try {
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.kpi', { timeout: 15000 });
  await page.waitForTimeout(300);

  const kpis = await page.$$eval('.kpi .kpi-val', els => els.map(e => e.textContent));
  check('overview starts at zero: [0,0,0%,0,0]', eq(kpis, ['0', '0', '0%', '0', '0']), kpis);

  const weekly = await page.$$eval('.sum-row', els => els.slice(0, 2).map(e => e.textContent.replace(/\s+/g, ' ').trim()));
  check('week 1 has no data yet', /สัปดาห์ 1.*ไม่มีข้อมูล/.test(weekly[0] || ''), weekly);

  const mode = await page.evaluate(() => window.Store.mode);
  check('storage mode defaults to local (no config)', mode === 'local', mode);

  const assetIds = await page.evaluate(() => JSON.parse(localStorage.getItem('gcjournal_v9') || '{}').assets?.map(a => a.id));
  check('seeds exactly one asset: GC', eq(assetIds, ['gc']), assetIds);

  await page.click('[data-a="setPeriod"][data-v="year"]');
  await page.waitForTimeout(250);
  const yk = await page.$$eval('.kpi .kpi-val', els => els.map(e => e.textContent));
  check('year starts at zero: [0,0,0%,0,0]', eq(yk, ['0', '0', '0%', '0', '0']), yk);
  await page.click('[data-a="setPeriod"][data-v="month"]');
  await page.waitForTimeout(150);

  // Click whichever cell the app marks as "today" — TODAY is computed from the
  // real clock (see app.js), so it must not be hardcoded here.
  const todayKey = await page.$eval('.cell.today', el => el.dataset.k);
  await page.click(`[data-a="openDay"][data-k="${todayKey}"]`);
  await page.waitForTimeout(250);
  const recOpen = await page.$('.wrap-record');
  const slots = await page.$$eval('image-slot', e => e.length);
  check('record editor opens', !!recOpen);
  check('record has 11 image slots', slots === 11, slots);

  await page.click('[data-a="setField"][data-k="bias"][data-v="buy"]');
  await page.click('[data-a="setField"][data-k="result"][data-v="correct"]');
  await page.click('[data-a="saveDraft"]');
  await page.waitForTimeout(250);
  const backHome = await page.$('[data-a="setPeriod"]');
  check('save returns to overview', !!backHome);

  await page.click('[data-a="navSearch"]');
  await page.waitForTimeout(200);
  const results = await page.$$eval('.result-card', e => e.length);
  check('search lists results', results > 0, results);

  check('no uncaught page errors', pageErrors.length === 0, pageErrors);
} catch (e) {
  failures++;
  console.error('  ✗ threw: ' + (e && e.stack || e));
} finally {
  await browser.close();
  server.close();
}

if (failures) { console.error(`\nSMOKE FAILED (${failures})`); process.exit(1); }
console.log('\nSMOKE PASSED');
