# XP Flight Computer

A study-level flight computer for **X-Plane 12**. It reads the sim live, detects the aircraft you are flying, and gives you:

- **Live flight deck** — airspeeds (IAS, CAS, TAS, GS, Mach), altitudes (indicated, pressure, density, temperature-corrected), wind components, fuel endurance and range, stall margin at your current weight and bank. Every value is marked as either read from X-Plane or calculated by the app.
- **25 calculators** — E6B-style tools: wind triangle, find the wind, runway crosswind, airspeed converter, crossover altitude, ISA, pressure and density altitude, cold-temperature correction, top of descent, vertical path to a fix, climb gradient, glide, turns, great circle, holding entries, fuel, mass & balance, GA runway corrections, units. Each one shows its working step by step, and “Follow sim” fills the inputs from X-Plane live.
- **Airliner performance**, which opens automatically when an airliner is detected: load sheet, fuel plan, take-off (V1/VR/V2, assumed temperature/FLEX, field length), landing (Vref/VLS, Vapp additives, landing distance, autobrake suggestion), crossover, top of descent, manoeuvre speeds. Runway data comes from X-Plane’s own airport database.
- **Study library** — 21 topics in 5 chapters with diagrams, numbered equations, worked examples computed live, and the X-Plane datarefs behind each value.

> For flight simulation and study only. Not for real-world navigation or aircraft operation. Airliner figures are typical public data and estimates.

## Quick start (Windows)

1. Install **Python 3.8 or newer** from python.org (tick *Add python.exe to PATH*). Nothing else is needed — the app uses only the standard library.
2. Double-click **`start.bat`**. Your browser opens **http://127.0.0.1:8765**.
3. Start X-Plane 12 and load an aircraft. It appears on the Live page within a few seconds.

No X-Plane running? Press **Run the demo flight** to try everything with simulated data.

## Quick start (Linux)

1. Python 3 is usually installed already (`python3 --version`). If not: `sudo pacman -S python` (Arch) or `sudo apt install python3` (Debian/Ubuntu).
2. In the project folder run **`sh start.sh`** (or `python3 xpfc.py`). Open **http://127.0.0.1:8765** if the browser does not open by itself.
3. Start X-Plane 12 and load an aircraft. Native Linux X-Plane and Steam installs (including Flatpak Steam) are found automatically for runway data.

macOS works the same way with `sh start.sh`.

## How it connects to X-Plane

The app picks the best link on its own:

| X-Plane | Link | What to do |
|---|---|---|
| 12.1.1 or newer, same PC | Web API, port 8086 | Nothing — it is on by default. |
| Older 12.x, or the Web API is off | UDP, port 49000 | In X-Plane: **Settings → Network → Accept incoming connections**. |
| X-Plane on another PC | UDP | Run `python xpfc.py --xp-host 192.168.1.50` (the sim PC’s IP), or `--discover` to find it automatically. Enable *Accept incoming connections* on the sim PC. |

**Settings** in the app shows the live status of both links.

## Phone or tablet as a second screen

Run **`start_lan.bat`** (Linux: `sh start.sh --lan`). The console prints an address like `http://192.168.1.20:8765` — open it on a device on the same Wi-Fi. On Windows, allow Python through the firewall for *private* networks when asked.

## Runway data

The app finds X-Plane 12 in your Steam libraries automatically and reads `Global Scenery/Global Airports/Earth nav data/apt.dat`. The first lookup indexes it (10–20 s). If your install is not found, set the folder in **Settings → Runway data**, or start with:

```
python xpfc.py --xp-root "D:\SteamLibrary\steamapps\common\X-Plane 12"
```

## Build a single .exe

Run **`build_exe.bat`** (installs PyInstaller, then builds `dist\XP-FlightComputer.exe`). The exe contains the web app; keep `user_profiles.json` next to it if you use one.

## Your own aircraft profiles

Copy `user_profiles.example.json` to **`user_profiles.json`** next to `xpfc.py` (or the exe) and edit it:

- Same `id` as a built-in profile (for example `B738`) → changes only the fields you list.
- New `id` → adds an aircraft. It is detected by its ICAO code (`icao`) or by words in its name (`match`).

Speeds come from the lift equation, so the key numbers are the wing area and the effective CLmax per flap setting. If the app’s V-speeds for your aircraft come out a few knots fast, raise the CLmax values slightly; if slow, lower them.

Built-in types: 737-600/700/800/900ER, 737 MAX 8, 737-300, A319, A320, A320neo, A321, A321neo, A330, A340-600, A350-900, A380, A300-600R, 757-200, 767-300ER, 777-200ER, 777-300ER, 787-9, 747-400, 747-8, 727-200, MD-82, MD-11, E175, E195, CRJ900, CRJ200, Dash 8 Q400, ATR 72-600. Unknown airliners get a generic profile built from X-Plane’s own weights.

## Command-line options

```
python xpfc.py [--port 8765] [--lan] [--xp-host IP] [--discover] [--xp-root PATH]
               [--no-webapi] [--no-udp] [--no-browser] [--debug]
```

## Troubleshooting

- **“No sim” / waiting for X-Plane** — check the X-Plane version (12.1.1+ for the Web API) or enable *Accept incoming connections*. Settings shows what each link reports.
- **Port 8765 in use** — another copy is running, or use `--port 8766`.
- **Aircraft not recognised as an airliner** — open Performance and pick the type manually, or add it to `user_profiles.json`.

## For developers

- `tools/fake_xplane.py` is a stand-in for X-Plane that speaks both the Web API and UDP RREF, with a scripted flight. `python tools/fake_xplane.py --aircraft B738 --cycle 30` switches aircraft every 30 s.
- `node tests/test_calc.js` and `node tests/test_perf.js` check the maths against published ISA tables and reference values.
- The web app is plain HTML/CSS/JS (no build step); `web/js/calc.js` holds all the aviation formulas.

## Credits

Equations rendered with [KaTeX](https://katex.org) (MIT). Typefaces: **B612** and **B612 Mono** (SIL Open Font License), designed for Airbus cockpit displays, and **Source Serif 4** (SIL Open Font License). License texts are in `web/vendor`.
