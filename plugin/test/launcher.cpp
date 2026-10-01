// XP Flight Computer — starts the Windows stand-in X-Plane. The stand-in itself is XPLM_64.dll (built from
// harness.cpp), so win.xpl links against it exactly as it links against X-Plane's own XPLM_64.dll.
#include <windows.h>
#include <cstdio>

typedef int (*HarnessMain)(int, char**);

int main(int argc, char** argv) {
    HMODULE xplm = LoadLibraryA("XPLM_64.dll");
    if (!xplm) { std::fprintf(stderr, "cannot load XPLM_64.dll (error %lu)\n", (unsigned long)GetLastError()); return 2; }
    HarnessMain run = (HarnessMain)GetProcAddress(xplm, "harness_main");
    if (!run) { std::fprintf(stderr, "XPLM_64.dll has no harness_main\n"); return 2; }
    return run(argc, argv);
}
