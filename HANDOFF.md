# RaceLogger — Engineering Handoff

*A DIY GPS + IMU race-telemetry rig (lap timing, data logging, on-phone analysis)
for autocross / rallycross / track days. Written to get a capable new collaborator
productive fast: what it is, where it's going, how it's built, and the landmines.*

---

## 1. TL;DR

- **What:** A small Arduino logger (Seeed **XIAO nRF52840 Sense** + u-blox GPS) records
  GPS + g-force to onboard flash and streams live data over **Bluetooth LE** to a
  **phone web app** (a single static HTML file). The phone is the entire user interface:
  set up the track, time laps live, review runs, analyse data.
- **Where it's going:** From "a lap timer that works" toward "a genuine coaching tool" —
  map-first session review, lap-vs-lap comparison, braking/acceleration-point detection,
  an **optimal (theoretical-best) lap**, delta-vs-optimal, and plain-English pointers on
  where to find time. Rivalling RaceChrono/Dragy/VBOX, but DIY and phone-first.
- **State (2026-07-13):** Very heavily iterated across two intensive days. The learning
  loop exists (venue memory → named corners → carried focus → debrief → leaderboards →
  compare-with-scrubber), a real backend exists (Netlify Functions + Blobs: share links
  `/api/session`, leaderboards `/api/lb`), and the data pipeline is trustworthy with
  honest labelling (vintage badges, rate labels, rebuilt-clock banners). **The bottleneck
  is now validation, not features** — most of the last two days is field-unproven; run
  `FIELD_TEST.md` at the next outing before building anything else.
- **Primary files:** `dashboard/index.html` (the whole app, ~5,300 lines, vanilla JS +
  Leaflet — outgrowing single-file; see Strategy in §8), `firmware-xiao/RaceLoggerXiao/*`
  (logger firmware), `dashboard/netlify/functions/*.mjs` (backend), `FIELD_TEST.md`,
  `LICENSE` (proprietary — © Josh "Yoshi" Retief).

---

## 2. Vision & product principles

These have been earned through the build; honour them.

1. **Driver-first, not data-scientist-first.** The person using this is strapped into an
   E36 pulling to a start line with gloves on. Controls must be huge, obvious, and
   forgiving. Every time the UI exposed hardware/implementation mechanics, it got
   simplified. Example: recording is now *always on* (dashcam model); the driver only ever
   taps one big **START SESSION** button.
2. **The phone is the interface.** The logger should "just record." Anything the driver
   needs to do, they do on the phone. Avoid forcing them to manage device state.
3. **Reliability over features.** The user tests in the wild and reports real failures
   (GPS glitches, missed gates, screen-off catch-up, storage limits). Robustness work is
   valued as much as new features. Filter bad data, degrade gracefully, never lose a
   session, never white-screen.
4. **The `.BIN` on the logger is ground truth.** BLE can drop; flash doesn't. Live/phone
   data is convenience; the full-rate log is authoritative.
5. **Make the useful thing the default; hide the rest.** The user explicitly dislikes
   "hunting" for functions and dislikes "useless graphs." Lead with what matters (the map,
   the times), tuck depth behind clear affordances.
6. **Verify before shipping.** Every change has been syntax-checked and, where there's real
   logic (crossing detection, interpolation, outlier rejection, eviction), unit-tested with
   a small Node harness. Keep doing this — the review environment can't run the app live.

---

## 3. The user (Yoshi) — how to work with him

- Races an **E36** at **autocross and rallycross**. Real driver, hands-on builder.
- Hardware: **u-blox M9 (25 Hz)** GPS taped to the **car roof** (good sky view) with the
  XIAO directly beneath it. Antenna placement is *good* — don't blame placement.
- **Comfortable reflashing firmware** ("firmware changes are 5 seconds") — so firmware
  changes are on the table, but tell him clearly when a reflash is required.
- Deploys via **GitHub → Netlify auto-deploy** (private repo `corgon67/racetelemetry`,
  paid Personal plan): he replaces `index.html` on github.com, Netlify builds in ~30 s.
  If something "isn't there," he may not have uploaded the latest file. **End every
  update with a one-line deploy instruction** ("Deploy: upload `index.html`" / "+ reflash
  firmware" / "nothing to deploy") — he asked for this explicitly.
- **Communication style: concise and direct.** He wants outcomes, not essays. Own mistakes
  plainly (I mis-diagnosed a "1 Hz GPS" problem once — it was actually 25 Hz; the real issue
  was the 10 Hz *BLE transport*, see §7). He values honesty about what's inherent vs fixable.
- He gives excellent field feedback and often diagnoses root causes himself (e.g. realised
  "long laps" were the paddock loop crossing the start/finish line). Listen closely.

---

## 4. System architecture

### 4.1 Hardware
- **XIAO nRF52840 Sense**: nRF52840 (BLE), onboard **LSM6DS3 6-axis IMU** (the "Sense" part),
  2 MB QSPI flash exposed as a USB drive. No spare user button (only RESET). No video out.
- **u-blox GPS** (M8Q/M9N/M10 supported; user has **M9N @ 25 Hz**), UART to XIAO pins 6/7.
- Powered from car; screen-wake handled on the phone side.

### 4.2 Data flow
```
GPS (25 Hz) + IMU (50 Hz)
      │
      ▼
XIAO firmware ── writes ──► LOGxxxx.BIN on QSPI flash   (RTL1 format, full rate, GROUND TRUTH)
      │
      ├── BLE JSON status @ 10 Hz  ──►  phone: live dashboard, map, lap display
      ├── BLE "#T" binary telem @ ~10 Hz batches ──► phone: full-rate (25 Hz GPS / 50 Hz IMU) for hi-res replay
      └── BLE "#FILE" transfer (on request) ──► phone: pull a whole .BIN for analysis
```
The phone app parses all three, stores sessions in `localStorage`, and does all
analysis/replay client-side (same maths as the Python `analysis/racetel.py`).

### 4.3 The three concepts (internalise this — the UX is built on it)
- **Recording** — logger writing the `.BIN`. **Always on** once connected. Not a user action.
- **Timing / "session"** — the driver taps **START SESSION**; this arms lap detection and
  bundles the resulting laps/runs into one reviewable outing. One session = one outing/day.
- **Track** — the saved layout: start/finish line, splits, mode (loop/stage), walked outline.
  Persists across sessions.

### 4.4 Loop vs Stage
- **Loop** (rallycross/track day): one **start/finish** line crossed repeatedly. Laps timed
  **on the device** (`laps.h`). Has a configurable **cooldown** (see §5) to make a loop behave
  stage-like so paddock returns aren't timed.
- **Stage** (autocross): separate **start** and **finish** lines; each run timed
  **client-side** on the phone (`checkStage()`), because the device timer only understands one
  reusable gate. **Two independent lap-timing code paths that must stay conceptually in sync.**

### 4.5 BLE protocol (Nordic UART Service)
- Phone→logger commands (newline-terminated text): `start`, `stop`, `gate <lat>,<lon>`,
  `hires 0|1`, `cooldown <s>`, `level`, `ls`, `get <name>`, `erase`.
- Logger→phone lines:
  - `{...}` JSON **status** @ 10 Hz (fix, sats, speed, lat/lon, heading, lateral g `ay`,
    horizontal accuracy `ha`, lap state `a`/`c`/`b`/`n`/`l`, recording `r`, filename `fn`, …).
  - `#T <hex>` — batched **binary telemetry** (raw `.BIN` records, hex-encoded) for full-rate
    live streaming. Gated by `hires 1`.
  - `#FILE name size` then raw bytes then `#END` — file transfer.
  - `#LEVELED`, `#ERR ...` — acks/errors.

### 4.6 Record / file formats (`binlog.h` ↔ phone parser must stay byte-identical)
- File: 8-byte `RTL1` header, then a stream of records:
  - **G record** (41 B, type `'G'`=71): ms, iTOW, lat_e7, lon_e7, alt, speed_cms, heading,
    fixType, numSV, hAcc, ax/ay/az (milli-g), gx/gy/gz (centi-dps). @ GPS rate (25 Hz).
  - **I record** (17 B, type `'I'`=73): ms, ax/ay/az, gx/gy/gz. @ 50 Hz (IMU between fixes).
- The phone reuses the **exact same byte offsets** to parse both the `.BIN` and the live
  `#T` stream. If you touch `binlog.h`, update `analysis/bin2csv.py` **and** the phone parser.

### 4.7 Key files
| Path | Role |
|---|---|
| `dashboard/index.html` | **The app.** Single file: HTML + CSS + vanilla JS + Leaflet (CDN). Everything. |
| `dashboard/netlify/functions/session.mjs` | Share-link backend: POST/GET session bundles (Netlify Blobs). |
| `dashboard/netlify/functions/leaderboard.mjs` | Venue leaderboards: entry-per-blob, best-per-driver top 20. |
| `dashboard/package.json` | `@netlify/blobs` dep — functions need a git/CLI deploy, not drag-drop. |
| `dashboard/LICENSE` | Proprietary licence (also referenced in the HTML header comment). |
| `FIELD_TEST.md` | Structured validation checklist — run at the next outing (see §8 Strategy). |
| `firmware-xiao/RaceLoggerXiao/RaceLoggerXiao.ino` | Main firmware: BLE, logging, telemetry stream, commands, IMU leveling. |
| `firmware-xiao/RaceLoggerXiao/laps.h` | On-device loop lap timer (gate crossing, cooldown). |
| `firmware-xiao/RaceLoggerXiao/gps_ubx.h` | u-blox UBX driver + config (rate, constellations, dyn model). |
| `firmware-xiao/RaceLoggerXiao/binlog.h` | Binary record structs (the wire/file format). |
| `analysis/*.py` | Desktop analysis (`racetel.py` is the reference algorithm), `.BIN`→CSV, GoPro overlay. Source of truth for the schema. |
| `firmware/src/*` | **ESP32 alternative build — NOT maintained, far behind. The user doesn't use it.** |
| `docs/log_format.md` | Log schema doc. |
| `docs/ui-design-handoff.html` | **STALE** — documents an older UI (old LAPS tab, separate Recording button). Don't trust it. |
| `CLAUDE.md` | Project instructions. |

---

## 5. What's been built (feature inventory)

A lot. Grouped by system. All in `index.html` unless noted.

**Recording / session model**
- Always-on recording (auto-`start` on connect); recording button removed; only a small
  secondary stop (needed to free the link for downloads).
- Single **START SESSION** button = arm timing + bundle a session. Loop arms the device gate;
  stage auto-detects each run. Live banner: OFF → ARMED → TIMING.
- Full session trail saved on the phone (10 Hz) so any session is replayable/analysable
  without USB, even with zero completed laps.

**Tabs:** `LIVE · MAP · ACCEL · HISTORY` *(ANALYZE tab killed — July 2026 rebuild)*
- **HISTORY** — chronological **card feed** of sessions; **one tap opens the map-first
  session view** (see below). Raw-`.BIN` tools (logger file list over BLE + open-from-phone)
  live at the bottom of this tab.
- **SESSION VIEW** (the §9 rebuild, done 2026-07-12) — single full-screen page per session:
  hero **Leaflet satellite map** of the whole outing at the best rate stored (hi-res if
  captured, else 10 Hz trail; honest `~X Hz` label), scrubbable, colour modes
  phase/g/delta, brake-throttle onset dots, corner-g labels. Below: runs table (tap MAP to
  scope the map to one lap, FULL RUN to zoom back out), lap & sector table, sector verdicts
  + theoretical best, lap compare, speed/delta-vs-distance, g-g, accel bests, share/CSV/
  delete. The same view renders raw `.BIN` files (map included). `renderSvRuns`/
  `openSessionView`/`setupReplay` are the entry points.
- **ACCEL** — configurable speed brackets (0–60, 40–120, any) with live timing + best-per-
  session; post-run bests computed from the trace. Dedicated tab (was on Live, moved off).
- **MAP** — Leaflet satellite (Esri) map; place/edit start-finish/splits (gate lines have
  heading + width); walk-capture a track **outline** (visual reference only, not gates);
  compact gate editor (rotate + width together, move behind a toggle, trash, Back).

**Gate / split logic**
- Splits auto-numbered by **driving order** (nearest point along outline/best-lap/trail) and
  fire **sequentially** (crossing an early part of track can't trigger a later split).
- Analysis crossing detection (`gateCrossTimes`) uses the **actual placed gate line** (same
  geometry as the live timer) and works at low speed — replaced an older path-reconstruction
  method that missed slow/odd crossings.

**Replay & analysis**
- Full-screen **replay**: scrubbable, satellite map, colour modes (phase / g / delta),
  brake-throttle onset dots, corner-g labels. Uses **50 Hz** hi-res if the session has it,
  else 10 Hz trail. Per-lap "VIEW" is still 10 Hz (alignment TODO).
- **Analysis overlay**: lap/sector table, sector verdicts + theoretical best, lap compare
  (map coloured by who's faster + delta trace), speed-vs-distance, delta-vs-distance, g-g,
  acceleration bests. **Theme-aware colours** (was hard-coded for dark; broke on light).
  **Whole-run fallback** when no laps detected. Single-lap sessions hide compare/delta panels.
- **Out-lap flagging**: laps > 1.5× median greyed as "OUT", excluded from best & charts
  (fixes the paddock-lap pollution).

**Reliability**
- **GPS outlier rejection** (`acceptFix`): rejects "teleport" jumps beyond what speed allows,
  and (with firmware `ha`) low-accuracy fixes — protects trail, crossings, map. Self-recovers;
  large time gaps (screen was off) allow bigger jumps.
- Device-side: `laps.update` skipped for fixes with `hAcc > 25 m`.
- **Screen-wake**: re-baseline + snap map on visibility resume (no fast-forward catch-up).
- **localStorage quota resilience**: hi-res stored in its own per-session keys; every write
  quota-guarded; on overflow sheds oldest hi-res → old trails → old sessions, never the active
  one; user notified. Corrupt-DB load falls back to defaults.
- **Auto-connect** to a previously-paired logger on load (needs Chrome `getDevices`; there's a
  Settings toggle + on-screen diagnostics for why it might not connect).

**Firmware features** (all **need a reflash** to be active)
- 50 Hz binary telemetry stream (`hires`), `hAcc` in status, low-accuracy fix rejection,
  loop **cooldown** (`cooldown` cmd + `laps.h` disarm-after-lap), **on-demand re-level**
  (`level` cmd; `calibrateLevel` now resets `Rcal` to identity first so re-leveling is
  absolute), automotive dynamic model + baud/rate config.

**Sensor / calibration**
- Boot-time IMU leveling maps gravity to +Z so lateral/longitudinal g read ~0 at rest —
  **but it's a one-shot snapshot tied to the mounted orientation.** Handle-and-replace changes
  the reading (this confused the user until explained). The `level` command / a future tap-tare
  fixes it on demand. Leveling only corrects tilt (pitch/roll), **not yaw** — the board's X must
  point fore-aft or lateral/longitudinal g get mixed.

**Sharing**
- **SHARE / EXPORT**: bundles a session (metadata + gates + 10 Hz trail + 50 Hz trace) as one
  JSON to the phone's native share sheet (or downloads).
- **OPEN A SHARED SESSION**: imports that JSON as its own session in History (SHARED badge,
  recreates the sender's track so it's fully analysable). No server — file-based sharing.

---

## 6. Current state (2026-07-13)

- **Deployed:** GitHub → Netlify auto-deploy (see §3). Backend live: `session` +
  `leaderboard` functions on Netlify Blobs.
- **Firmware:** current flash includes 25/50 Hz `#T` streaming, backfill (`bf`), device-ms
  timestamps, `gr`/`ci` diagnostics, UART-overrun fixes (pumpGps + 57600 baud), GPS config
  self-heal, fast-conn-interval request, auto-stop-on-fetch. Bench-verified to
  `link 10/s · gps 17–25/s`; **not yet proven over a full event.**
- **Old data:** pre-fix sessions carry burst-corrupted clocks; the app rebuilds their time
  axis (distance ÷ speed) and badges them **≈ CLOCK** (recomputed times ±1–2%). The runs
  table (line-timed) is always exact. Session vintage badges: 25 Hz / 10 Hz / ≈ CLOCK.
- **Validation is the bottleneck:** run `FIELD_TEST.md` top-to-bottom at the next outing.
  Riskiest unproven surfaces: camera reparenting, GoPro BLE, gate drag handles, backfill
  under real packet loss, leaderboard concurrency.
- **ESP32 build is abandoned/behind.** Ignore unless asked.

---

## 7. Non-obvious constraints & gotchas — READ THIS

1. **The `.BIN` is 25 Hz, but the *live BLE status* is only 10 Hz.** This is the root cause of
   "sparse replay." The GPS/logger are fine; the throttle is the transport. The 10 Hz JSON
   status was kept light historically (verbose JSON + Web Bluetooth notification-rate limits +
   battery). The newer `#T` binary stream *does* carry full 25 Hz GPS / 50 Hz IMU at only
   ~1–4 KB/s — well within BLE's ~15–25 KB/s. **So "keep it light" no longer really applies to
   the binary channel; there's headroom to push more.** (Open question the user raised — see §8.)
2. **Three clocks.** Device `millis`, GPS time-of-week (`iTOW`), and phone wall-clock
   (`Date.now`) all appear. Live timing uses `millis`; hi-res samples use device `ms`; the
   10 Hz trail uses wall-clock. **Aligning a single lap to the hi-res stream is unsolved** —
   that's why per-lap replay is still 10 Hz. GPS time is the right basis for precise timing and
   isn't fully used yet.
3. **Two lap-timing implementations** (device `laps.h` for loop, phone `checkStage` for stage).
   Keep them conceptually consistent; the offline analyser (`gateCrossTimes`) is a third path
   deliberately matched to the placed-line geometry.
4. **IMU leveling is a one-shot, tilt-only (no yaw), boot-time snapshot.** See §5 Sensor.
5. **Web Bluetooth reality:** HTTPS required; first connect needs a user gesture; silent
   reconnect (`getDevices`) is behind a Chrome flag on some Androids. Chrome can suspend JS /
   drop BLE when the screen locks (hence the wake lock + resume handling).
6. **u-blox config isn't ACK-checked.** Commands are fired and assumed to land. A rate the
   module rejects silently stays at default. (M9N does 25 Hz here; an M8Q would need 10 Hz.)
   Adding ACK+retry is a known reliability gap.
7. **Review-environment quirk (for an AI working the same way I did):** the Linux sandbox mount
   served a *size-capped snapshot* of large files, so `grep`/`node --check` couldn't see the
   tail of `index.html` (the dashboard). I verified by (a) `node --check` on the readable prefix, (b) the
   authoritative file-Read tool for the tail, and (c) Node unit tests of extracted pure logic.
   If you hit "function not found" in grep on a big file, it's probably beyond the cap — trust
   the Read tool.
8. **`localStorage` is the only persistence** and it's finite (~5–10 MB). Hi-res is big
   (~0.5 MB/session). The eviction system exists for a reason; don't bypass it.

---

## 8. Open work / roadmap (roughly prioritized)

### Strategic direction (agreed with the user, 2026-07-13)

**Priority order — do not reshuffle without him:**
1. **FIELD-TEST FREEZE.** No new features until `FIELD_TEST.md` has been run at a real
   outing. The built-vs-proven gap is the project's biggest risk.
2. **Build step / modularisation.** The single 5,300-line HTML has outgrown itself (even
   verification requires assembling the file in fragments). Split source into modules in
   the private repo; `esbuild` bundles + **minifies** to the deployed `index.html`. This
   is also the agreed answer to his code-protection concern at the client tier: readable
   source lives only in the private repo; the site serves minified output. (Agreed
   explicitly: an APK does NOT protect code — decompilable; don't sell it to him as such.)
3. **Unify the two lap tables.** Live-timed + recomputed laps confuse even the author.
   One list: line-timing provides the number, recomputation provides sectors/zones,
   paired by time window, orphans flagged. Design task, not caption task.
4. **Coach depth: corner-level cross-session intelligence** (all-time corner bests per
   venue — data already in `db.venues[].corners` + sessions, unwired). Build this layer
   **server-side from day one**: real IP protection = code that never ships. Split rule:
   offline-critical (live timing, basic zones) stays client; deep/chargeable intelligence
   goes in functions.
5. **In-app self-test**: canned old-format + new-format sessions pushed through
   import→open→analyze from a hidden menu entry, so runtime regressions (the const-crash
   class) surface on the phone in seconds instead of at the track.
6. **APK/Capacitor** only when triggered by: iOS users (Safari has no Web Bluetooth —
   needs native BLE), Play-Store distribution, or native camera needs. It is a
   distribution decision, not protection and not soon.
7. **Cloud accounts/profiles** (identity beyond `driverName`, sessions following the
   user) — natural once the share/leaderboard workflow proves itself at a real event.

### History of completed rounds

**DONE 2026-07-12 (this pass):**
- **Map-first session view** (§9 rebuild) — one tap on a History card = map hero + all
  analysis below; separate Replay/Analyze overlays and the ANALYZE tab removed.
- **Back-gesture navigation** — History-API layer stack (`navPush`/`navConsume`/popstate);
  back closes the top overlay (session view / bottom sheet / full-dash) instead of the app.
- **Vintage racing design system** — cream/tarmac palette, Monza/Racing-Green/Gulf-Blue/
  Marigold accents, Anton display + Space Mono data type, 2px carbon borders, hard offset
  shadows, mechanical button presses, grain overlay. Cream (light) is the default for new
  installs; **his phone may still have `theme:"dark"` saved** — MENU → LIGHT or AUTO.
- **System-theme auto-switch** (`theme:"auto"` follows `prefers-color-scheme` live).
- **First field data (ARP, 2026-07-12) fixes:** trail cap 4000→16000 pts (was collapsing a
  43-min outing to ~1.5 Hz → "sparse map" report), hires cap 9000→20000; honest `~X Hz`
  labels; out-lap threshold now median-of-fastest-cluster ×1.5 (plain median failed with
  alternating paddock laps); onStatus now closes a finished lap BEFORE pushing the tick's
  sample (each lap used to end with one stray next-lap sample).

**DONE 2026-07-13 — gap backfill ("never download manually"):**
- Firmware: `bf <fromMs>` command + `pumpBackfill()` — re-streams every record with
  `ms >= fromMs` out of the CURRENT `.BIN` (flushes first, reads via a second File32
  handle) as normal `#T` lines while recording/status/live-telemetry continue; paced
  ~4.8 KB/s raw; `#BF start/done` acks; refuses during a file transfer. Fixed a compile
  error too (`HEX` array collided with Arduino's `#define HEX 16` → `HEXDIG`).
- Phone: tracks `hiResLastMs`; sends `bf lastMs+1` automatically on BLE reconnect and on
  screen-wake during a session (`requestBackfill`); `buildHiRes` dedupes the seam;
  status line shows "recovering missed data / recovered". Unit-tested end-to-end
  (`skip/send pacing, batch bounds, resync, merge gap-free`). **Needs the reflash.**

**DONE 2026-07-13 — time-axis + live-latency fixes (ARP follow-ups):**
- The ARP trail's timestamps were 100% burst-compressed (Android delivered BLE
  notifications in ~1 s clumps; wall-clock stamping made minutes of driving look like
  milliseconds) → analysis produced nonsense lap/sector times. Fixes: status JSON now
  carries `ms` (device millis) and the phone stamps its session trail with it; the
  session view detects a burst-corrupted axis on OLD sessions and disables the
  lap/sector analysis with an explanation instead of printing garbage.
- Live position hopping ~1 Hz: firmware now requests a fast BLE connection interval
  (`Bluefruit.Periph.setConnInterval(9,24)`), and the live car marker is driven
  directly from the newest 25 Hz `#T` fix when hi-res streams. Needs the reflash +
  a real-world check that Android honours the interval request.

**DONE 2026-07-13 (bench debugging with live diagnostics):**
- **UART RX overrun was crippling the GPS** (`gps 0/s` with 14 sats): Serial1's ~64-byte
  RX buffer holds 5.5 ms of 115200-baud data, but BLE write-retry loops stalled loop()
  for tens of ms → most NAV-PVT frames corrupted → ~0–3 decoded solutions/s AND a
  degraded `.BIN` (records only written for decoded fixes). This was almost certainly
  the real cause of the earlier "1.3 fix/s", not config rejection. Fix: `pumpGps()` (poll+log+
  lap-update, recursion-guarded) is called inside every BLE wait loop (flushTel,
  pumpBackfill, pumpFileSend). Diagnostics now live in the status line: `link N/s ·
  gps N/s · ci Nms · ±Nm` (`gr`/`ci` fields in status JSON).
- **"Fetch full-rate always comes back empty"**: every reconnect/resume sends `start`,
  which rotates to a NEW .BIN, so the session's file pointer chased the newest (often
  seconds-old, dir-entry-still-0-bytes) file. Fixes: firmware `startFileSend` now
  auto-stops recording (dir entry finalised, no more phone-side stop-race) and reports
  `#ERR file is empty` honestly; the phone tracks ALL of a session's .BINs
  (`s.logFiles[]`),  (`s.logFiles[]`), fetches them sequentially, skips failed/empty ones, and analyses
  the concatenation.

**DONE 2026-07-13 (round 7 — the phase model, fixed twice):** field reports "mostly
coasting, makes no sense" then "now everything is corner" had three stacked causes:
(1) speed-only classification called constant-speed cornering "coast" → FOUR phases now:
power / brake / corner (|ay|>0.35 g, no longitudinal change) / coast (the rare dead-time
label), with legend chips in the map bar; (2) window-endpoint slopes amplified GPS noise
→ half-window means; (3) **the ±0.35 s window found no neighbours at coarse sample
spacing** (old ~1.5 Hz trails) so the slope silently computed 0 and nothing ever read
power/brake → the window now always includes ≥1 sample per side. Also
`trailAxisBroken()`/`repairTimeAxis()`: burst-corrupted old trails get their clock
REBUILT from distance ÷ speed (positions + device speeds are trustworthy) instead of
analysis being refused — banner marks lap times ~±1–2% approximate; head-to-head uses
the same repair. Validated on the REAL ARP trail: driven line = 39% power / 39% brake /
8% corner / 14% coast (plausible point-and-squirt rallycross); 25 Hz synthetic
regression still passes. NOTE: the user analyses OLD (pre-firmware-fix) files — always
ask which data vintage a complaint refers to before touching algorithms.

**DONE 2026-07-13 (round 8 — analysis UX batch):**
- History: imports live in a collapsed "Shared with me (n)" section with the import
  button inside (`sharedOpen`/`toggleShared`); your own sessions get the space.
- Session view playback: ▶ PLAY / 1×2×4× real-time replay (`rpTick`; scrub = seek;
  binary-search scrub lookup). Charts: labelled axes + tap-to-read values
  (`wireChartReadout`, `speedAtFrac`).
- **Deterministic Coach card** (`computeCoach`/`renderCoach`): consistency verdict, longest
  coast (dead-time) zones, braking profile, top speed, peak-g — each insight tappable
  (`coachJump` drives the hero map to that instant). Deliberately NOT an LLM: offline,
  free, testable; an agentic "ask about this lap" layer can ride the Netlify backend later.
- Live tab: 🎥 CAMERA + GOPRO buttons row (`w_video` widget). GoPro = Open GoPro BLE
  shutter remote (HERO9+, service fea6, cmd b5f90072-…; `gopro*` fns) — no preview, its
  point is TIMING: shutter-from-app stamps `s.videoOffset` so footage auto-syncs.
  UNTESTED on real hardware.
- Long-press any session-view card HEADER (450 ms) to fold it to its strip; persisted in
  `settings.cardFolds` (`toggleFold`/`applyFolds`).

**DONE 2026-07-13 (round 9 — the declutter, after a deserved telling-off):** the user
invoked principle §2.5 ("make the useful thing the default; hide the rest") against the
button sprawl. New rule going forward: NEW CAPABILITY LANDS BEHIND EXISTING SURFACES
(header icons, collapsed groups, long-press, widget corners) — never as new always-visible
chrome. Changes: camera/GoPro row removed from LIVE → header 🎥 icon opens a small sheet
(`openVideoMenu`); the phone camera is now a MODE of the minimap panel (📷 fab swaps
map↔camera preview, ● REC + ⛶ fullscreen in its corner; `camInline`, `camAttach` reparents
the video/canvas between minimap and camView so recording survives every transition);
OBD connect button moved to MENU (guards added — its old button no longer exists in DOM);
History's raw-.BIN tools live in a collapsed "▸ Raw logger files" group (`toggleRaw`);
long-press-to-fold now works on EVERY card app-wide (listener moved to document).
Plus: **gate transform handles** (`showGateHandles`) — in the gate editor, blue centre
handle drags to move; gold endpoint handles rotate+resize about the centre in one gesture
(width=2×dist, heading=bearing); buttons kept for fine adjustment; handles cleared in
`hideSheetNow`. All UNTESTED live (camera reparenting + Leaflet draggable markers are the
risk points).

**DONE 2026-07-13 (round 10 — THE LEARNING LOOP, the actual product):**
`db.venues[trackId]` = per-venue memory: `pb` + `pbHistory`, `corners` (learned from the
PB lap: |ay|>0.35 g held ≥0.6 s, numbered T1..Tn by driving order, stored as distance
fractions f0/f1), and `focus` (ONE carried-forward target). Flow: END SESSION →
`updateVenueMemory` (headless `analysisLapsFor`) → **debrief sheet** (best + PB context /
NEW PB, 🎯 focus verdict improved/worse/even vs baseline, PB trend, OPEN FULL SESSION).
Coach card now: venue PB header, insights annotated with corner names ("T3 — 1.8s
coasting…"), 🎯 SET Tn AS FOCUS button (baseline = time through that corner's fraction
range on this session's best lap); next session at the venue auto-checks it. Old own
sessions get folded into venue memory on first open (`!s.debrief`). Unit-tested: corner
detection (3 synthetic corners, ordered, located), baseline math, focus delta detection.
Imported sessions never touch venue memory. Next steps for the loop: corner-level
all-time bests table per venue, focus suggestions ranked by recoverable time, and the
debrief as the default post-session screen on the phone (currently a sheet).

**DONE 2026-07-13 (round 11 — track walk smarts + venue leaderboards):**
- Track walk: taps within 30 m of the walked outline SNAP onto it (start/finish placeable
  after the fact, exactly on the line); ✨ AUTO-PLACE SPLITS (`autoSplits`, in the tap
  sheet + offered after saving a walk) spaces N splits evenly by distance along the
  outline from the S/F (or between start↔finish in stage mode), perpendicular headings;
  OUTLINE map button toggles the dashed overlay per track (`t.outlineHidden`).
  Geometry unit-tested (square-track splits land on corners; snapping verified).
- Venue leaderboards: `netlify/functions/leaderboard.mjs` (Blobs store "leaderboard",
  entry-per-blob so no write races; POST /api/lb, GET /api/lb/:key returns top-20 best-
  per-driver). Venue key = start-line coords (3 dp) + mode + lap-length bucket (100 m) —
  same physical venue+layout from any phone, layout changes fork the board. Session-view
  card: REFRESH / SUBMIT MY BEST (uploads the session too; entries carry `sid` so VIEW
  opens the actual lap via import). Club-trust, unverified — stated in the UI. Blobs is
  ample at club scale (~150 B/entry, reads capped at 200 entries); a real DB only if this
  goes big.

**DONE 2026-07-13 (round 12 — the charts, rebuilt for humans + buddy comparison):**
The unreadable multi-line spaghetti (speed-vs-distance, delta-vs-distance) and the two
overlapping compare cards (same-session + head-to-head xc) are GONE, replaced by ONE
"Compare laps" module: lap A (this session) vs lap B from ANY source — a middle dropdown
lists every other session incl. imported friends' (laps computed on demand via
`analysisLapsFor`). Three synced views (map coloured by who's faster + cursor dot; speed
overlay, thick green = you; gap trace with green/red fill, "climbing = gaining") + a
SCRUBBER that walks all three with a live readout ("62% · T3 — you 74 vs 69 km/h · gap
+0.42s and gaining" + 📍 jumps the hero map). Charts show shaded corner bands (T1..Tn
from venue memory) instead of naked percentages. g-g kept with a plain-English caption.
Key fns: `cmp` state, `fillCmpSrc/fillCmpB/cmpSrcChange/renderCompare/drawCompare/
cmpScrubMove/cornerBands`. Dead code removed: xcCard, runXCompare, buildXcSelect,
anaspd/anadel charts. "Profiles" = driver name in shares (full accounts = future cloud).

**DONE 2026-07-13 (round 13 — lap sanity + coach selector + validation prep):**
- Recomputed lap detection now requires crossing start/finish AT SPEED
  (`gateCrossTimes(pts,g,minV)`, arm speed for S/F, permissive for splits) — paddock
  transits no longer become laps (fixed the 8-vs-6 live/recomputed mismatch; residual
  time differences are method (±0.1–0.2 s) or ≈CLOCK reconstruction (±1–2%)).
- Coach: "Analysing: Lx" selector (`coachLapN`/`coachPick`) — insights/corners/📍 anchor
  to any chosen lap, default best; focus baseline stays vs best lap.
- **Session vintage badges** (`sessionVintage`/`vintageBadge`, cached `_vint`): 25 Hz
  (green) / 10 Hz (neutral) / ≈ CLOCK (amber, rebuilt timestamps) on History cards and
  the session-view runs header — expectations set before numbers are read.
- **`FIELD_TEST.md`** written (repo root): the long-outstanding structured validation
  checklist — bench diag numbers, session mechanics incl. backfill + paddock-crossing
  check, analysis, gates/track tools, video/GoPro/share, endurance. NEXT TRACK OUTING
  SHOULD RUN IT before any further feature work; most of rounds 4–12 is field-unproven.
