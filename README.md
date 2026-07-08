# GC · Trade Journal — สมุดบันทึกไบแอสรายวัน

A daily **market-bias journal** for discretionary traders, dressed in a
**blue "liquid glass" (iOS 26/27) interface**. Log your directional bias for an
instrument each trading day (e.g. GC / ทองคำฟิวเจอร์), attach chart screenshots
by session, record the option-flow research behind the call, then mark whether
the bias turned out **ถูก / ผิด** and review your win rate over time.

Built from the Claude Design handoff `Trade Journal.dc.html`, then reskinned to a
liquid-glass system and wired to optional **cloud sync (Supabase, no login)**.
Plain HTML/CSS/JS — no build step, no framework.

## Screens

- **ภาพรวม (Overview)** — five glass KPI tiles, a month/year calendar heatmap,
  and a per-week / per-month breakdown of your correct-bias rate. Toggle **เดือน / ปี**.
- **ค้นหา (Search)** — search dates & news, plus faceted filters (result, Bias,
  news, PCR OI change, เติมเงิน / ถอนเงิน, Magnet, IV), sortable newest ↔ oldest.
- **บันทึก (Record editor)** — chart image slots by session (บ่าย / เย็น / ค่ำ / เฉลย),
  trade data, the Option Flow research card, and the result. Images paste, drop, or browse in.
- **สินทรัพย์ (Asset manager)** — switch instruments and a name / colour /
  trading-days editor.

## Run it

```bash
python3 -m http.server 8000     # or: bunx serve -p 8000
# open http://localhost:8000
```

Works fully offline out of the box — data lives in `localStorage` and the app
ships with a seeded sample book (GC · Apr–Jul 2569, plus BTC) so every screen has
data on first load. The topbar pill reads **บันทึกในเครื่อง** in this mode.

## Cloud sync (Supabase — no login)

The storage layer is a swappable adapter (`js/store.js`). Add a Supabase project
and your journal syncs to the cloud across devices; the topbar pill switches to
**☁ ซิงก์แล้ว / กำลังซิงก์… / ซิงก์ไม่สำเร็จ**.

1. Create a free project at [supabase.com](https://supabase.com).
2. In the SQL Editor, run [`supabase/schema.sql`](supabase/schema.sql).
3. Paste your **Project URL** and **anon (publishable) key** into `js/config.js`:
   ```js
   window.APP_CONFIG = {
     SUPABASE_URL: 'https://YOUR-PROJECT.supabase.co',
     SUPABASE_ANON_KEY: 'eyJhbGciOi...'
   };
   ```

How it behaves: on first connect to an empty project the seed (or your existing
local data) is uploaded; thereafter each saved day / asset change is pushed
optimistically (the UI never blocks), with `localStorage` kept as an offline
mirror and fallback. The anon key is safe in a browser; keep it private since
this is a single no-login workspace.

**Notes / limitations.** Chart images stay in `localStorage` per device (journal
records — bias, targets, option flow, result — are what sync to the cloud). Writes
are fire-and-forget with no retry queue, so a change made while offline reaches
the cloud the next time that record is edited (the local mirror never loses it).
Want per-user accounts? Add Supabase Auth and tighten the RLS policies in
`schema.sql` from `to anon` to `to authenticated using (auth.uid() = user_id)`.

## Project layout

```
index.html         app shell + font links + script order
css/styles.css     the blue liquid-glass design system
js/config.js       Supabase URL + anon key (blank = offline)
js/store.js        storage adapter: localStorage + Supabase (PostgREST), sync status
js/app.js          state, seeded data, calendar/stats, and every screen
js/image-slot.js   <image-slot> web component (browse / drag-drop / paste)
supabase/schema.sql  tables + row-level policies for the no-login workspace
```

## Data model

```js
// records[assetId][YYYY-MM-DD]
{
  bias: 'buy' | 'sell' | 'sw_up' | 'sw_down',
  result: 'correct' | 'wrong' | 'pending',
  tMain, tSec,                        // primary / secondary target
  news: [string], newsOn: bool,
  pcr: 'buy' | 'sell' | 'sideway',    // PCR OI change
  oi:  'buy' | 'sell' | 'sideway',
  add: [...], wd: [...], wdOn: bool,  // เติมเงิน / ถอนเงิน (Put/Call เด่นบน·ล่าง)
  magnet: 'up' | 'down' | 'both',
  iv: 'left' | 'right' | 'smile'
}
```

> Dates use the Thai Buddhist calendar (year + 543). The demo is anchored to
> **7 ก.ค. 2569 (2026-07-07)** to match the seeded sample data.
