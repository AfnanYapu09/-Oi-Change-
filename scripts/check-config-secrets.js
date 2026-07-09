#!/usr/bin/env node
/*
 * check-config-secrets.js
 *
 * Fails (non-zero exit) if js/config.js -- as committed to the repo -- has a
 * non-empty SUPABASE_URL or SUPABASE_ANON_KEY. Permanent guard against
 * repeating the PR #2 incident (real Supabase credentials briefly committed,
 * reverted in PR #3). The committed version of js/config.js must always ship
 * with both values blank; real credentials belong only in an uncommitted
 * local working tree.
 *
 * Usage: node scripts/check-config-secrets.js [path-to-config.js]
 *   Defaults to js/config.js (relative to the current working directory,
 *   i.e. the repo root when run from CI). An optional path argument is
 *   accepted purely so this exact script can be exercised against a scratch
 *   copy during manual testing, without touching the real file.
 *
 * Does not print secret contents to logs, only their lengths.
 */
const fs = require('fs');

const target = process.argv[2] || 'js/config.js';
const raw = fs.readFileSync(target, 'utf8');

// Strip block (/* ... */) and line (// ...) comments first. config.js's own
// header comment contains example values (e.g. SUPABASE_URL: '...supabase.co')
// that would otherwise be matched instead of the real assignment below it.
const src = raw
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/.*$/gm, '');

const urlMatch = src.match(/SUPABASE_URL\s*:\s*(['"])([^'"]*)\1/);
const keyMatch = src.match(/SUPABASE_ANON_KEY\s*:\s*(['"])([^'"]*)\1/);

if (!urlMatch || !keyMatch) {
  console.error(`ERROR: could not find SUPABASE_URL / SUPABASE_ANON_KEY assignments in ${target} -- file format may have changed, please review.`);
  process.exit(1);
}

const url = urlMatch[2].trim();
const key = keyMatch[2].trim();

if (url.length > 0 || key.length > 0) {
  console.error(`ERROR: ${target} has a non-empty Supabase credential committed to the repo.`);
  console.error(`SUPABASE_URL length: ${url.length} chars, SUPABASE_ANON_KEY length: ${key.length} chars.`);
  console.error('Real credentials must never be committed to js/config.js (see PR #2 leak / PR #3 revert). Blank both values before committing; keep real credentials only in your local, uncommitted working tree.');
  process.exit(1);
}

console.log(`OK: ${target} has blank SUPABASE_URL and SUPABASE_ANON_KEY as committed.`);
