# Race Telemetry Logger

DIY lap timing + GoPro overlay rig for autocross / rallycross / track days.
A tiny logger records GPS + g-force; your phone connects over Bluetooth to
start/stop and watch live lap times; Python scripts turn the logs into lap
analysis reports and video overlays.

Two hardware builds are included — **the XIAO build is the main one**
(matches hardware you already own). The ESP32 build (`firmware/`) is kept as
an alternative with a WiFi web UI instead of Bluetooth.

## Build A: XIAO nRF52840 Sense (recommended)

```
[u-blox M10Q GPS] --4 wires--> [XIAO nRF52840 Sense]
                                 ├─ on-board IMU (g-force)
                                 ├─ on-board 2 MB flash (~27 min logging)
                                 ├─ BLE ──> Android phone dashboard
                                 └─ USB ──> shows up as a USB drive with logs
```

No extra parts needed. Optional: 1S LiPo on the BAT pads (it charges over USB).

### Wiring

| GPS pin | XIAO pin |
|---|---|
| TX | 7 (RX) |
| RX | 6 (TX) |
| VCC | 3V3 |
| GND | GND |

Mount the XIAO rigidly and roughly flat, GPS antenna with a clear sky view.

### Arduino IDE setup (one-time)

1. Install [Arduino IDE](https://www.arduino.cc/en/software).
2. File → Preferences → Additional boards manager URLs, add:
   `https://files.seeedstudio.com/arduino/package_seeeduino_boards_index.json`
3. Boards Manager → install **"Seeed nRF52 Boards"** (NOT the mbed one —
   the plain "Seeed nRF52 Boards" package includes Bluefruit BLE + TinyUSB).
4. Library Manager → install **Seeed Arduino LSM6DS3**, **Adafruit SPIFlash**,
   and **SdFat - Adafruit Fork**.
5. **Format the log flash once**: File → Examples → Adafruit SPIFlash →
   `SdFat_format`, upload, wait for "done" in Serial Monitor.
6. Open `firmware-xiao/RaceLoggerXiao/RaceLoggerXiao.ino`, select board
   *Seeed XIAO nRF52840 Sense*, upload.

If a library API has drifted and it doesn't compile, note the error — the
usual suspects are the SdFat fork version (needs `File32`/`FatVolume`) and
the LSM6DS3 constructor.

### Phone dashboard (Chrome on Android)

`dashboard/index.html` talks to the logger over Web Bluetooth. Chrome
only allows that from an HTTPS page, so host the file somewhere free:

- **Current setup:** GitHub repo (`corgon67/racetelemetry`) linked to Netlify
  (`racetelemetry.netlify.app`) — push/upload to the repo and it auto-deploys,
  including the share-link backend in `netlify/functions/`.
  Chrome menu → "Add to Home screen" makes it feel like an app.

Tabs:

- **LIVE** — speed, lateral g, mini map with your position and trail,
  current/best lap, live splits, delta to your best lap (green/red), and the
  one big **START SESSION** button (recording itself is always on).
- **MAP** — full map with a **track library**: each saved track has its own
  start/finish and split marks. Tap the map to place marks; the start/finish
  syncs to the logger automatically. Arriving at a saved track auto-selects it.
- **ACCEL** — configurable speed brackets (0–100, 60–120, …) timed live and
  found automatically in every recorded run.
- **HISTORY** — every session as a card. **Tapping a session opens the
  map-first session view**: a scrubbable satellite map of the driven line
  (colour = accel/brake phase, g, or delta; brake/throttle points marked),
  with lap & sector times, sector verdicts + theoretical best, lap compare,
  speed/delta traces, acceleration bests and g-g below it. The same view
  opens raw `.BIN` logs — pull them from the logger over Bluetooth (REFRESH →
  OPEN, ~15–25 KB/s) or open a file copied off the USB drive. Share/export
  also lives here.

**DEMO MODE** simulates a car lapping so you can explore every feature with
no hardware — works even opening the file straight from disk.

No hosting yet? The logger speaks Nordic UART: the "Serial Bluetooth
Terminal" Android app can drive it — assign macro buttons to `start`,
`stop`, `gate`.

LED meaning: blinking = GPS fix, solid = recording, off = no fix yet.

### At the track

1. Power on with the car stationary (~1 s gyro calibration at boot).
2. Wait for the LED to blink (GPS fix — first fix outdoors can take a minute).
3. Park on the start/finish line, tap **SET START/FINISH HERE**.
4. **START RECORDING**, drive, watch laps appear. **STOP** when done.
5. Start the GoPro *after* recording starts — you sync in software later.

### Getting logs off

Plug the XIAO into your computer — it appears as a read-only USB drive
(**RACELOG**) containing `LOG0001.BIN`, ... Copy them off, then:

```
cd analysis
python bin2csv.py LOG0001.BIN          # -> LOG0001.csv
```

## Build B: ESP32 (WiFi web UI, SD card) — alternative

See `firmware/` (PlatformIO). Parts: ESP32 DevKit (~$8), MPU-6050 (~$3),
microSD module (~$3). Same features, phone connects to WiFi hotspot
"RaceLogger" → http://192.168.4.1, logs CSV straight to SD. Wiring table in
`firmware/src/config.h`.

## Analysis (both builds)

```
cd analysis
pip install -r requirements.txt

# try everything right now without hardware:
python generate_synthetic.py
python analyze.py synthetic_session.csv --gate=-33.964500,18.604721
```

`analyze.py` prints lap + sector times and writes a report folder with a
speed-coloured track map, speed traces, delta-to-best, a g-g diagram, and
**estimated driver inputs** (throttle/brake/cornering-g derived from IMU g —
there's no pedal sensor, so treat these as informed guesses; tune
`accel_ref_g`/`brake_ref_g` in `racetel.estimate_driver_inputs` to your car).
For real logs, `--gate=` is the start/finish lat,lon (right-click the spot in
Google Maps → copy coordinates). Use the `--gate=...` form with `=` — a space
breaks on negative latitudes.

## Video overlay

```
python overlay.py GOPRO0001.MP4 LOG0001.csv --gate=lat,lon --offset 12.5 -o out.mp4
```

Add `--inputs` to also overlay the estimated throttle/brake bars and
cornering g.

`--offset` = telemetry seconds at the first video frame. Find it by matching
an unmistakable moment (launch, first hard braking) between video and log.
Overlay shows speed, lap number + running time, best lap, g-force ball, and a
mini track map with live position. Rendering takes ~2–4x video duration.

## File map

```
firmware-xiao/RaceLoggerXiao/   XIAO nRF52840 Sense sketch (Arduino IDE)
firmware/                       ESP32 alternative (PlatformIO)
dashboard/index.html       Android phone dashboard (Web Bluetooth)
analysis/racetel.py             core library: parsing, laps, metrics
analysis/analyze.py             lap report + plots
analysis/overlay.py             GoPro overlay renderer
analysis/bin2csv.py             XIAO binary log -> CSV
analysis/generate_synthetic.py  fake 5-lap session for testing
docs/log_format.md              CSV column reference
```

## Roadmap ideas

- OBD-II/CAN (rpm, throttle, brake) — log columns already reserved
- Auto video sync from the GoPro's own GP