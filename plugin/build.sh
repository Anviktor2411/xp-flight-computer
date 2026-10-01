#!/usr/bin/env sh
# XP Flight Computer — build the X-Plane plugin.
#   sh build.sh            Linux (lin.xpl, native g++) and Windows (win.xpl, MinGW-w64 cross compiler)
#   sh build.sh linux      only Linux
#   sh build.sh windows    only Windows
#   sh build.sh test       Linux test build with AddressSanitizer + the stand-in X-Plane (test/harness.cpp)
#   sh build.sh wintest    the stand-in X-Plane for Windows / Wine (loads the real win.xpl)
#   sh build.sh resources  only copy the scripts, fonts and texts into dist/
# Needs: g++ with the OpenGL headers (libgl-dev) for Linux, x86_64-w64-mingw32-g++ for Windows.
# Output: dist/XPFlightComputer — copy that folder into X-Plane/Resources/plugins/.
set -e
cd "$(dirname "$0")"
ROOT=$(pwd)
WHAT=${1:-all}
DIST="$ROOT/dist/XPFlightComputer"
JOBS=${JOBS:-$(nproc 2>/dev/null || echo 2)}

INC="-I$ROOT/src -I$ROOT/third_party -I$ROOT/third_party/imgui -I$ROOT/third_party/quickjs -I$ROOT/third_party/xplm/CHeaders/XPLM"
XPDEF="-DXPLM200=1 -DXPLM210=1 -DXPLM300=1 -DXPLM301=1 -DIMGUI_USER_CONFIG=<imconfig_xpfc.h>"
CXXSRC="src/plugin.cpp src/ui.cpp src/xpimgui.cpp src/jshost.cpp src/files.cpp src/fini.cpp third_party/imgui/imgui.cpp third_party/imgui/imgui_draw.cpp third_party/imgui/imgui_tables.cpp third_party/imgui/imgui_widgets.cpp"
CSRC="third_party/quickjs/quickjs.c third_party/quickjs/libregexp.c third_party/quickjs/libunicode.c third_party/quickjs/dtoa.c"

# compile <compiler> <out dir> <flags...> <file>  (skips files that are up to date)
compile_all() {
  CC_=$1; CXX_=$2; OUT=$3; CFLAGS_=$4; CXXFLAGS_=$5
  mkdir -p "$OUT"
  pids=""
  n=0
  for f in $CSRC $CXXSRC; do
    o="$OUT/$(basename "$f").o"
    if [ -f "$o" ] && [ "$o" -nt "$f" ] && [ -z "$FORCE" ] && [ "$(dirname "$f")" != "src" ]; then continue; fi
    case "$f" in
      *.c) $CC_ $CFLAGS_ -c "$f" -o "$o" & ;;
      *) $CXX_ $CXXFLAGS_ -c "$f" -o "$o" & ;;
    esac
    pids="$pids $!"
    n=$((n + 1))
    if [ $((n % JOBS)) -eq 0 ]; then for p in $pids; do wait "$p"; done; pids=""; fi
  done
  for p in $pids; do wait "$p"; done
}

copy_resources() {
  mkdir -p "$DIST/64" "$DIST/js" "$DIST/fonts"
  for f in calc.js aircraft.js perf.js derive.js calculators.js; do cp "$ROOT/../web/js/$f" "$DIST/js/"; done
  cp "$ROOT/js/polyfill.js" "$ROOT/js/xphost.js" "$DIST/js/"
  cp "$ROOT/fonts/"*.ttf "$ROOT/fonts/"LICENSE-* "$DIST/fonts/"
  cp "$ROOT/README-plugin.txt" "$DIST/README.txt"
  cp "$ROOT/../user_profiles.example.json" "$DIST/user_profiles.example.json" 2>/dev/null || true
  mkdir -p "$DIST/licenses"
  cp "$ROOT/third_party/imgui/LICENSE.txt" "$DIST/licenses/imgui-LICENSE.txt"
  cp "$ROOT/third_party/quickjs/LICENSE" "$DIST/licenses/quickjs-LICENSE.txt"
  cp "$ROOT/third_party/nlohmann/LICENSE.MIT" "$DIST/licenses/nlohmann-json-LICENSE.txt"
  cp "$ROOT/third_party/xplm/license.txt" "$DIST/licenses/xplane-sdk-LICENSE.txt"
}

if [ "$WHAT" = all ] || [ "$WHAT" = linux ]; then
  echo "== Linux (lin.xpl)"
  COMMON="-O2 -fPIC -fvisibility=hidden -DLIN=1 $XPDEF $INC -I$ROOT/third_party/gl"
  mkdir -p "$DIST/64"
  LIBGL=$(ls /usr/lib/x86_64-linux-gnu/libGL.so.1 /usr/lib64/libGL.so.1 /usr/lib/libGL.so.1 2>/dev/null | head -1)
  if python3 -m ziglang version >/dev/null 2>&1; then
    # Zig links against an old glibc (2.27), so the plugin loads on older distributions too.
    ZCC="python3 -m ziglang cc -target x86_64-linux-gnu.2.27"
    ZCXX="python3 -m ziglang c++ -target x86_64-linux-gnu.2.27"
    compile_all "$ZCC" "$ZCXX" build/lin "-std=gnu11 -D_GNU_SOURCE -w $COMMON" "-std=c++17 -Wall -Wno-unused-parameter $COMMON"
    $ZCXX -shared -o "$DIST/64/lin.xpl" build/lin/*.o $LIBGL -lm -Wl,--as-needed -Wl,--version-script="$ROOT/exports.map" -s
  else
    compile_all gcc g++ build/lin "-std=gnu11 -D_GNU_SOURCE -w $COMMON" "-std=c++17 -Wall -Wno-unused-parameter $COMMON"
    g++ -shared -o "$DIST/64/lin.xpl" build/lin/*.o -static-libstdc++ -static-libgcc -lGL -lm -Wl,--as-needed -Wl,--version-script="$ROOT/exports.map"
    strip --strip-unneeded "$DIST/64/lin.xpl"
  fi
fi

if [ "$WHAT" = resources ]; then
  copy_resources
  echo "== copied scripts, fonts and texts to $DIST"
  exit 0
fi

if [ "$WHAT" = test ]; then
  echo "== Linux test build (build/test: lin.xpl with AddressSanitizer, harness)"
  TCOMMON="-O1 -g -fPIC -fno-omit-frame-pointer -DLIN=1 -DXPFC_ABORT_ON_ASSERT $XPDEF $INC"
  compile_all gcc g++ build/test "-std=gnu11 -D_GNU_SOURCE -w -fsanitize=address $TCOMMON" "-std=c++17 -Wall -Wno-unused-parameter -fsanitize=address,undefined $TCOMMON"
  g++ -shared -fsanitize=address,undefined -o build/test/lin.xpl build/test/*.o -lGL -lm -ldl -Wl,--version-script="$ROOT/exports.map"
  g++ -std=c++17 -g -O1 -Wall -fsanitize=address,undefined -DLIN=1 $XPDEF $INC test/harness.cpp -o build/test/harness -rdynamic -lGL -lX11 -ldl
  copy_resources
  echo "== done: build/test"
  exit 0
fi

if [ "$WHAT" = wintest ]; then
  echo "== Windows test harness (build/wintest: XPLM_64.dll stand-in + launcher.exe, run with Wine)"
  mkdir -p build/wintest
  x86_64-w64-mingw32-g++ -std=c++17 -O1 -g -DIBM=1 -DXPLM=1 -DNOMINMAX -DWIN32_LEAN_AND_MEAN $XPDEF $INC -shared -o build/wintest/XPLM_64.dll test/harness.cpp \
    -static -static-libgcc -static-libstdc++ -lopengl32 -lgdi32 -luser32
  x86_64-w64-mingw32-g++ -O1 -o build/wintest/launcher.exe test/launcher.cpp -static
  echo "== done: build/wintest"
  exit 0
fi

if [ "$WHAT" = all ] || [ "$WHAT" = windows ]; then
  echo "== Windows (win.xpl)"
  COMMON="-O2 -DIBM=1 -DNOMINMAX -DWIN32_LEAN_AND_MEAN -D_WIN32_WINNT=0x0601 $XPDEF $INC"
  compile_all x86_64-w64-mingw32-gcc x86_64-w64-mingw32-g++ build/win "-std=gnu11 -D_GNU_SOURCE -w $COMMON" "-std=c++17 -Wall -Wno-unused-parameter $COMMON"
  mkdir -p "$DIST/64"
  x86_64-w64-mingw32-g++ -shared -o "$DIST/64/win.xpl" build/win/*.o third_party/xplm/Libraries/Win/XPLM_64.lib \
    -static -static-libgcc -static-libstdc++ -lopengl32 -luser32 -limm32 -Wl,--no-insert-timestamp
  x86_64-w64-mingw32-strip --strip-unneeded "$DIST/64/win.xpl"
fi

copy_resources
echo "== done: $DIST"
ls -la "$DIST/64"
