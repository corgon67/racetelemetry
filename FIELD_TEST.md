# RaceLogger — Field Test Checklist

*One structured session validates everything built since the last track day.
Run top to bottom — later items depend on earlier ones. Note PASS/FAIL and,
for any failure, save the session and note the exact status-line numbers.
Time needed: ~30 min before driving + normal driving.*

**Before leaving home:** latest `index.html` deployed (check MENU footer works,
hard-refresh), latest firmware flashed, one protected 18650 charged (if using
battery box), phone charged, GoPro paired once if testing it.

---

## 1. Bench, engine off (5 min)

| # | Check | Pass looks like |
|---|---|---|
| 1.1 | Power on logger, open app | Auto-connect within ~10 s, CONNECT row disappears |
| 1.2 | Status line | `link ~10/s` steady |
| 1.3 | GPS rate (open sky!) | `gps 20–25/s` within 2 min of fix. Parked at `10/s` = 25 Hz was NAKed (report it). `0–3/s` = regression, capture `ci` value |
| 1.4 | Connection interval | `ci` ≤ 50 ms. If ~100+ ms, note phone model — Android refused the fast interval |
| 1.5 | Accuracy | `±3 m` or better with clear sky |

## 2. Session mechanics (10 min, can be a slow lap of the paddock)

| # | Check | Pass looks like |
|---|---|---|
| 2.1 | START SESSION → banner | ARMED → TIMING on first start-line crossing at speed |
| 2.2 | Live map marker | Smooth ~25 Hz movement, no 1 s hops |
| 2.3 | Screen off 60 s mid-session, wake | "recovering missed data… ✓" appears; map trail has no gap afterwards |
| 2.4 | Walk/drive past S/F slowly (paddock speed) | NO lap counted (live or recomputed later) |
| 2.5 | END SESSION | Debrief sheet appears: best time, PB context, focus check if set |

## 3. After real runs (at the car, 10 min)

| # | Check | Pass looks like |
|---|---|---|
| 3.1 | Session view | Rate label says `hi-res · ~75 Hz`-ish, NOT "phone trail" or "rebuilt clock" |
| 3.2 | Lap counts | Runs table count == recomputed count; times agree within ~0.2 s |
| 3.3 | Phase zones | Map reads as sane power/brake/corner/coast zones, not confetti (try ZONES/RAW and CORNERS toggles) |
| 3.4 | Playback | ▶ plays in real time; 2×/4× work; scrub during play relocates cleanly |
| 3.5 | Coach | Corners named (T1…); lap selector switches subject; 📍 jumps the map correctly |
| 3.6 | Compare | Scrubber walks all three views; readout matches what the map shows |
| 3.7 | FETCH FULL-RATE (logger connected) | Pulls all session .BINs, charts refresh, no "empty" errors |

## 4. Gates & track tools (once per venue)

| # | Check | Pass looks like |
|---|---|---|
| 4.1 | Gate drag handles | Blue centre moves; gold ends rotate+stretch smoothly; result saved after closing sheet |
| 4.2 | Track walk → auto-splits | Splits land ON the walked line, numbered in driving order, perpendicular |
| 4.3 | Snap placement | Tap near outline → line lands exactly on it |
| 4.4 | OUTLINE toggle | Hides/shows, remembered per track |

## 5. Video & extras (optional, once)

| # | Check | Pass looks like |
|---|---|---|
| 5.1 | 📷 on minimap | Camera preview in the panel, HUD overlaid; ⛶ fullscreen and back without killing REC |
| 5.2 | Record a 1-min clip | Saved .webm plays with HUD burned in, audio present |
| 5.3 | GoPro (HERO9+) | 🎥 menu → GOPRO connects; ● starts/stops camera; session gets videoOffset |
| 5.4 | Video overlay | Open the GoPro/phone clip in the session → sync offset lands close automatically (in-app recordings) |
| 5.5 | SHARE LINK | Uploads; link opens on another phone/incognito and imports |
| 5.6 | Leaderboard | SUBMIT appears on the board; VIEW opens the lap |

## 6. Endurance (passive, during the day)

- Battery: note runtime if on 18650.
- Storage: after a full day, History still loads; note any "storage trimmed" banner.
- Reconnects: count how many times auto-reconnect saved you vs manual taps.

---

**Reporting a failure:** the session file (SHARE AS FILE), the status-line
readout at the time (`link / gps / ci / ±m`), and one sentence of what you
expected. That combination has fixed every bug so far.
