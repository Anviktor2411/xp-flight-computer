// XP Flight Computer — run this library's C++ static destructors when X-Plane unloads it.
//
// GCC normally links crtbeginS.o, whose fini code calls __cxa_finalize(__dso_handle). The Linux build uses
// Zig (for an old glibc baseline), which does not, so without this the destructors would stay registered
// after X-Plane unloads the plugin ("Reload plugins", quitting) and glibc would call into freed code at exit.
// Calling it twice is harmless: each destructor runs once.
#if LIN
extern "C" {
extern void* __dso_handle;
int __cxa_finalize(void* dso) __attribute__((weak));
}

__attribute__((destructor)) static void xpfcFinalize() {
    if (__cxa_finalize) __cxa_finalize(&__dso_handle);
}
#endif
