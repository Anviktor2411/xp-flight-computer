XP Flight Computer - X-Plane plugin 1.3.0
=========================================

The calculators and the airliner performance pages of XP Flight Computer, in a
window inside X-Plane. For X-Plane 11 (11.20 or newer) and X-Plane 12, on
Windows and Linux, 64-bit. The plugin needs no Python and no browser.


INSTALL
-------
1. Copy the whole "XPFlightComputer" folder into X-Plane's Resources/plugins
   folder, so that it looks like this:

     X-Plane 12/Resources/plugins/XPFlightComputer/64/win.xpl
                                                  /64/lin.xpl
                                                  /js/...
                                                  /fonts/...

   Keep the folders together: the plugin reads the js and fonts folders next
   to the 64 folder.
2. Start X-Plane. The plugin is under  Plugins > XP Flight Computer.


OPEN THE WINDOW
---------------
- Plugins > XP Flight Computer > Show / hide (or Calculators, Performance).
- Or bind a key or joystick button. In X-Plane: Settings > Keyboard (or
  Joystick), search for "xpfc":
      xpfc/window/toggle         show or hide the window
      xpfc/window/calculators    open it on the calculators
      xpfc/window/performance    open it on airliner performance
- Drag the window by its title bar, resize it from the edges. The plugin menu
  also has "Pop out into its own window" (for a second monitor), "Move into
  the VR headset" and "Reset window position".


WHAT IS INSIDE
--------------
Calculators   All 35 calculators from the app. "Follow sim" fills the green
              fields from X-Plane twice a second; "Fill from sim once" does it
              once. Type in any field (a comma works as the decimal mark too).
              "Show the working" lists every step. Search the list by typing
              a few words and press Enter.
Performance   Load sheet, fuel plan, take-off (V1/VR/V2, assumed temperature,
              field length), after take-off (NADP 1 / NADP 2 / engine failure,
              the FMS entries, clean-up speeds and the climb chart), landing
              (Vref, Vapp, autobrake) and climb, cruise & descent. The
              aircraft is detected automatically; pick another type from the
              list if you want. "Use X-Plane now" fills temperature, QNH and
              wind, plus elevation and runway heading when on the ground.
Settings      Units (kg/lb, hPa/inHg, m/ft), text size, window position.

Green values follow X-Plane live, cyan values are yours, magenta values are
calculated.


YOUR SETTINGS
-------------
Saved automatically in X-Plane's  Output/preferences/XPFlightComputer.json.


YOUR OWN AIRCRAFT PROFILES
--------------------------
Put a user_profiles.json next to the 64 folder. It uses the same format as
the app (see user_profiles.example.json in this folder).


THE APP
-------
The study library, the aircraft study pages, the diagrams and the phone view
are in the XP Flight Computer app (start.bat / xpfc.py). The app and the
plugin can run at the same time.


TROUBLESHOOTING
---------------
- Nothing under Plugins: check the folder layout above. X-Plane's Log.txt has
  a line starting with "XP Flight Computer:" that says what happened.
- The window says "could not start": the js or fonts folder is missing next
  to the 64 folder.
- Text too small or too large: Settings > Text size in the plugin. X-Plane's
  own interface size (Settings > Graphics) is followed too.
- Linux needs glibc 2.27 or newer (Ubuntu 18.04 or newer, any current Arch).
- macOS is not included in this build.


For flight simulation and study only. Not for real-world navigation or
aircraft operation. Airliner figures are typical public data and estimates.


LICENCES
--------
Dear ImGui (MIT), QuickJS-ng (MIT), nlohmann/json (MIT), X-Plane SDK (see the
licenses folder). Fonts: B612 (SIL Open Font License 1.1) and DejaVu Sans
(Bitstream Vera licence); their texts are in the fonts folder.
