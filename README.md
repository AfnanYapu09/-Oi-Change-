# GC · Trade Journal — สมุดบันทึกไบแอสรายวัน

A daily **market-bias journal** for discretionary traders, implemented from the
Claude Design handoff **`Trade Journal.dc.html`**. You log your directional bias
for an instrument each trading day (e.g. GC / ทองคำฟิวเจอร์), attach chart
screenshots by session, record the option-flow research behind the call, then
mark whether the bias turned out **ถูก / ผิด** and review your win rate over time.

iOS / macOS-HIG visual language: `#F2F2F7` canvas, `#007AFF` accent, Anuphan +
IBM Plex Sans Thai + IBM Plex Mono, soft cards and 22px radii. No build step, no
runtime dependencies — plain HTML/CSS/JS that runs from a static server.

## Screens

- **ภาพรวม (Overview)** — five KPI tiles (Bias ถูก / ผิด / อัตราชนะ / จดทั้งหมด /
  วันมีข่าว), a month or year calendar heatmap, and a per-week / per-month
  breakdown of your correct-bias rate. Toggle **เดือน / ปี**.
- **ค้นหา (Search)** — free-text search over dates and news, plus faceted filters
  (result, Bias, news, PCR OI change, เติมเงิน / ถอนเงิน option flow, Magnet, IV),
  sortable newest ↔ oldest.
- **บันทึก (Record editor)** — chart image slots split by session
  (บ่าย / เย็น / ค่ำ / เฉลย), trade data (Bias, targets, news), the Option Flow
  research card, and the result. Images paste, drag-drop, or browse in.
- **สินทรัพย์ (Asset manager)** — switch between instruments (GC, BTC, …) and a
  name / colour / trading-days editor. Add or remove your own.

## Run it

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

Everything persists to `localStorage` (records under `gcjournal_v9`, chart images
under `gcjournal_images_v1`); nothing leaves the browser. The app ships with a
seeded sample book (GC · Apr–Jul 2569, plus BTC) so every screen has data on
first load — the numbers reproduce the design mockups exactly.

> Dates are shown in the Thai Buddhist calendar (year + 543). The demo is anchored
> to **7 ก.ค. 2569 (2026-07-07)** to match the sample data.

## Project layout

```
index.html         app shell + font links
css/styles.css     base reset + interaction states + the image-slot component
js/app.js          the whole app: state, seeded data, calendar/stats, and every screen
js/image-slot.js   <image-slot> web component (browse / drag-drop / paste, persisted)
```

## Data model

```js
// records[assetId][YYYY-MM-DD]
{
  bias: 'buy' | 'sell' | 'sw_up' | 'sw_down',
  result: 'correct' | 'wrong' | 'pending',
  tMain, tSec,                 // primary / secondary target
  news: [string], newsOn: bool,
  pcr: 'buy' | 'sell' | 'sideway',   // PCR OI change
  oi:  'buy' | 'sell' | 'sideway',
  add: [...], wd: [...], wdOn: bool,  // เติมเงิน / ถอนเงิน (Put/Call เด่นบน·ล่าง)
  magnet: 'up' | 'down' | 'both',
  iv: 'left' | 'right' | 'smile'
}
```

## Notes on the port

The design was authored in Claude Design's reactive `.dc.html` DSL. This is a
faithful, framework-free re-implementation: the exact inline styles, the seeded
sample generator (so the mockup numbers match to the digit), and every
interaction were ported to a plain state → render loop with event delegation.
