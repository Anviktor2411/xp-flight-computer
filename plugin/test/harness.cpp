// XP Flight Computer — a stand-in X-Plane for testing the plugin without the simulator.
//
// It implements the XPLM functions the plugin uses (windows, menus, commands, datarefs, flight loops,
// keyboard focus, graphics state), loads the plugin like X-Plane does, draws the plugin's window with a real
// OpenGL context and follows a script of clicks, key presses and screenshots.
//
// Linux: one program, run under Xvfb.
//   harness --xpl build/test/lin.xpl --plugin-path dist/XPFlightComputer/64/lin.xpl
//           --data scenario.json --prefs /tmp/prefs --script steps.txt --out shots/
// Windows (or Wine): built as a stand-in XPLM_64.dll that win.xpl links against, started by launcher.exe
// (test/launcher.cpp); screenshots are written as .ppm.
//
// Script commands (coordinates are pixels from the top-left of the plugin window's content):
//   frames N | click X Y | rclick X Y | move X Y | drag X1 Y1 X2 Y2 | wheel X Y CLICKS | type TEXT
//   key RETURN|TAB|BACK|ESCAPE|LEFT|RIGHT|DELETE|HOME|END | cmd NAME | menu PARENT/ITEM
//   set DATAREF VALUE | scale S | resize W H | shot FILE.png | disable | enable | reload | outside
//   expect_log TEXT | expect_focus 0|1 | expect_visible 0|1 | say TEXT | timing
#ifdef _WIN32
#include <windows.h>
#include <GL/gl.h>
#else
#include <GL/gl.h>
#include <GL/glx.h>
#include <X11/Xlib.h>
#include <dlfcn.h>
#endif

#include "XPLMDataAccess.h"
#include "XPLMDisplay.h"
#include "XPLMGraphics.h"
#include "XPLMMenus.h"
#include "XPLMPlugin.h"
#include "XPLMProcessing.h"
#include "XPLMUtilities.h"
#include "nlohmann/json.hpp"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdarg>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <functional>
#include <map>
#include <memory>
#include <sstream>
#include <string>
#include <vector>

using nlohmann::json;

// =================================================================== platform: OpenGL context and libraries
namespace {
#ifdef _WIN32
HWND gHwnd = nullptr;
HDC gHdc = nullptr;
HGLRC gGlrc = nullptr;
typedef HMODULE LibHandle;
void* glProc(const char* n) { return (void*)wglGetProcAddress(n); }
void swapBuffers() { SwapBuffers(gHdc); }
LibHandle libOpen(const std::string& p) { return LoadLibraryA(p.c_str()); }
void* libSym(LibHandle h, const char* n) { return (void*)GetProcAddress(h, n); }
void libClose(LibHandle h) { FreeLibrary(h); }
std::string libError() { return "LoadLibrary error " + std::to_string((unsigned long)GetLastError()); }
#else
Display* gDpy = nullptr;
::Window gXWin = 0;
GLXContext gCtx = nullptr;
typedef void* LibHandle;
void* glProc(const char* n) { return (void*)glXGetProcAddressARB((const GLubyte*)n); }
void swapBuffers() { glXSwapBuffers(gDpy, gXWin); }
LibHandle libOpen(const std::string& p) { return dlopen(p.c_str(), RTLD_NOW | RTLD_LOCAL); }
void* libSym(LibHandle h, const char* n) { return dlsym(h, n); }
void libClose(LibHandle h) { dlclose(h); }
std::string libError() { const char* e = dlerror(); return e ? e : "?"; }
#endif
}  // namespace

// =================================================================== state of the fake simulator
namespace {
int gW = 1600, gH = 1000;               // screen pixels
float gScale = 1.0f;                    // pixels per boxel (X-Plane's UI scale)
float gElapsed = 0.0f;
int gMouseX = -1000, gMouseY = -1000;   // global boxels
std::string gPluginPath, gPrefsPath, gLog, gLogSince;
int gFailures = 0;
bool gVerbose = false;

void fail(const char* fmt, ...) {
    va_list ap;
    va_start(ap, fmt);
    std::fprintf(stderr, "FAIL: ");
    std::vfprintf(stderr, fmt, ap);
    std::fprintf(stderr, "\n");
    va_end(ap);
    gFailures++;
}

struct DataRef {
    std::string name;
    XPLMDataTypeID type = 0;
    double num = 0;
    std::vector<float> fv;
    std::vector<int> iv;
    std::string bytes;
    std::function<void(DataRef&)> refresh;
};
std::map<std::string, std::unique_ptr<DataRef>> gRefs;

struct Win {
    XPLMCreateWindow_t p;
    int l, t, r, b;
    bool visible = false, popped = false, vr = false, alive = true, dummy = false;
    std::string title;
    int minW = 0, minH = 0, maxW = 0, maxH = 0;
};
std::vector<std::unique_ptr<Win>> gWins;
Win* gFocus = nullptr;

struct Loop { XPLMCreateFlightLoop_t p; bool scheduled = false; float due = 0; int dueFrame = -1; float last = 0; int count = 0; bool alive = true; };
std::vector<std::unique_ptr<Loop>> gLoops;
int gFrame = 0;

struct Handler { XPLMCommandCallback_f cb; int before; void* ref; };
struct Cmd { std::string name, desc; std::vector<Handler> handlers; };
std::vector<std::unique_ptr<Cmd>> gCmds;

struct MenuItem { std::string name; void* ref = nullptr; Cmd* cmd = nullptr; bool separator = false; };
struct Menu { std::string name; Menu* parent = nullptr; int parentItem = -1; XPLMMenuHandler_f handler = nullptr; void* ref = nullptr; std::vector<MenuItem> items; bool alive = true; };
Menu gPluginsMenu;
std::vector<std::unique_ptr<Menu>> gMenus;

Win* W(XPLMWindowID id) {
    for (auto& w : gWins) if (w.get() == id) { if (!w->alive) fail("window used after XPLMDestroyWindow"); return w.get(); }
    fail("unknown window id %p", id);
    return nullptr;
}
}  // namespace

// =================================================================== XPLM (what the plugin links against)
extern "C" {
// ---- utilities
XPLM_API void XPLMDebugString(const char* s) {
    gLog += s;
    gLogSince += s;
    if (gVerbose) std::fprintf(stderr, "[Log.txt] %s", s);
}
XPLM_API void XPLMEnableFeature(const char* f, int on) { if (gVerbose) std::fprintf(stderr, "[feature] %s=%d\n", f, on); }
XPLM_API void XPLMGetPrefsPath(char* out) { std::snprintf(out, 512, "%s", (gPrefsPath + "/Set X-Plane.prf").c_str()); }
XPLM_API XPLMPluginID XPLMGetMyID(void) { return 7; }
XPLM_API void XPLMGetPluginInfo(XPLMPluginID id, char* name, char* path, char* sig, char* desc) {
    if (name) std::snprintf(name, 256, "XP Flight Computer");
    if (path) std::snprintf(path, 512, "%s", gPluginPath.c_str());
    if (sig) std::snprintf(sig, 256, "doesvic.xpflightcomputer");
    if (desc) std::snprintf(desc, 256, "test");
}
XPLM_API float XPLMGetElapsedTime(void) { return gElapsed; }

// ---- commands
XPLM_API XPLMCommandRef XPLMCreateCommand(const char* name, const char* desc) {
    for (auto& c : gCmds) if (c->name == name) return c.get();
    gCmds.emplace_back(new Cmd{name, desc ? desc : "", {}});
    return gCmds.back().get();
}
XPLM_API void XPLMRegisterCommandHandler(XPLMCommandRef c, XPLMCommandCallback_f cb, int before, void* ref) {
    if (!c) { fail("XPLMRegisterCommandHandler(null)"); return; }
    static_cast<Cmd*>(c)->handlers.push_back({cb, before, ref});
}
XPLM_API void XPLMUnregisterCommandHandler(XPLMCommandRef c, XPLMCommandCallback_f cb, int before, void* ref) {
    if (!c) return;
    auto& h = static_cast<Cmd*>(c)->handlers;
    auto it = std::find_if(h.begin(), h.end(), [&](const Handler& x) { return x.cb == cb && x.before == before && x.ref == ref; });
    if (it == h.end()) fail("XPLMUnregisterCommandHandler: handler was not registered");
    else h.erase(it);
}

// ---- menus
XPLM_API XPLMMenuID XPLMFindPluginsMenu(void) { return &gPluginsMenu; }
XPLM_API XPLMMenuID XPLMCreateMenu(const char* name, XPLMMenuID parent, int parentItem, XPLMMenuHandler_f h, void* ref) {
    auto* m = new Menu;
    m->name = name ? name : "";
    m->parent = static_cast<Menu*>(parent);
    m->parentItem = parentItem;
    m->handler = h;
    m->ref = ref;
    gMenus.emplace_back(m);
    return m;
}
XPLM_API void XPLMDestroyMenu(XPLMMenuID id) {
    for (auto& m : gMenus) if (m.get() == id) { m->alive = false; return; }
    fail("XPLMDestroyMenu: unknown menu");
}
XPLM_API int XPLMAppendMenuItem(XPLMMenuID id, const char* name, void* ref, int) {
    auto* m = static_cast<Menu*>(id);
    m->items.push_back({name ? name : "", ref, nullptr, false});
    return (int)m->items.size() - 1;
}
XPLM_API int XPLMAppendMenuItemWithCommand(XPLMMenuID id, const char* name, XPLMCommandRef cmd) {
    auto* m = static_cast<Menu*>(id);
    m->items.push_back({name ? name : "", nullptr, static_cast<Cmd*>(cmd), false});
    return (int)m->items.size() - 1;
}
XPLM_API void XPLMAppendMenuSeparator(XPLMMenuID id) { static_cast<Menu*>(id)->items.push_back({"", nullptr, nullptr, true}); }

// ---- flight loops
XPLM_API XPLMFlightLoopID XPLMCreateFlightLoop(XPLMCreateFlightLoop_t* p) {
    if (!p || p->structSize < (int)sizeof(XPLMCreateFlightLoop_t)) fail("XPLMCreateFlightLoop: bad structSize");
    auto* l = new Loop;
    l->p = *p;
    l->last = gElapsed;
    gLoops.emplace_back(l);
    return l;
}
XPLM_API void XPLMDestroyFlightLoop(XPLMFlightLoopID id) {
    for (auto& l : gLoops) if (l.get() == id) { l->alive = false; return; }
    fail("XPLMDestroyFlightLoop: unknown loop");
}
XPLM_API void XPLMScheduleFlightLoop(XPLMFlightLoopID id, float interval, int) {
    auto* l = static_cast<Loop*>(id);
    l->scheduled = interval != 0;
    if (interval > 0) { l->due = gElapsed + interval; l->dueFrame = -1; }
    else if (interval < 0) { l->dueFrame = gFrame + (int)(-interval); }
}

// ---- datarefs
XPLM_API XPLMDataRef XPLMFindDataRef(const char* name) {
    auto it = gRefs.find(name ? name : "");
    return it == gRefs.end() ? nullptr : it->second.get();
}
XPLM_API XPLMDataTypeID XPLMGetDataRefTypes(XPLMDataRef r) { return r ? static_cast<DataRef*>(r)->type : 0; }
static DataRef* refOf(XPLMDataRef r) {
    auto* d = static_cast<DataRef*>(r);
    if (d && d->refresh) d->refresh(*d);
    return d;
}
XPLM_API int XPLMGetDatai(XPLMDataRef r) { auto* d = refOf(r); return d && (d->type & xplmType_Int) ? (int)d->num : 0; }
XPLM_API float XPLMGetDataf(XPLMDataRef r) { auto* d = refOf(r); return d && (d->type & xplmType_Float) ? (float)d->num : 0.0f; }
XPLM_API double XPLMGetDatad(XPLMDataRef r) { auto* d = refOf(r); return d && (d->type & xplmType_Double) ? d->num : 0.0; }
XPLM_API int XPLMGetDatavf(XPLMDataRef r, float* out, int offset, int max) {
    auto* d = refOf(r);
    if (!d || !(d->type & xplmType_FloatArray)) return 0;
    if (!out) return (int)d->fv.size();
    int n = 0;
    for (int i = offset; i < (int)d->fv.size() && n < max; i++) out[n++] = d->fv[i];
    return n;
}
XPLM_API int XPLMGetDatavi(XPLMDataRef r, int* out, int offset, int max) {
    auto* d = refOf(r);
    if (!d || !(d->type & xplmType_IntArray)) return 0;
    if (!out) return (int)d->iv.size();
    int n = 0;
    for (int i = offset; i < (int)d->iv.size() && n < max; i++) out[n++] = d->iv[i];
    return n;
}
XPLM_API int XPLMGetDatab(XPLMDataRef r, void* out, int offset, int max) {
    auto* d = refOf(r);
    if (!d || !(d->type & xplmType_Data)) return 0;
    if (!out) return (int)d->bytes.size();
    int n = 0;
    for (int i = offset; i < (int)d->bytes.size() && n < max; i++) static_cast<char*>(out)[n++] = d->bytes[i];
    return n;
}

// ---- graphics
XPLM_API void XPLMSetGraphicsState(int fog, int tex, int light, int alphaTest, int blend, int depthTest, int depthWrite) {
    fog ? glEnable(GL_FOG) : glDisable(GL_FOG);
    tex > 0 ? glEnable(GL_TEXTURE_2D) : glDisable(GL_TEXTURE_2D);
    light ? glEnable(GL_LIGHTING) : glDisable(GL_LIGHTING);
    alphaTest ? glEnable(GL_ALPHA_TEST) : glDisable(GL_ALPHA_TEST);
    if (blend) { glEnable(GL_BLEND); glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA); } else glDisable(GL_BLEND);
    depthTest ? glEnable(GL_DEPTH_TEST) : glDisable(GL_DEPTH_TEST);
    glDepthMask(depthWrite ? GL_TRUE : GL_FALSE);
}
XPLM_API void XPLMBindTexture2d(int num, int unit) {
    if (unit != 0) fail("XPLMBindTexture2d: unit %d", unit);
    glBindTexture(GL_TEXTURE_2D, (GLuint)num);
}
XPLM_API void XPLMGenerateTextureNumbers(int* out, int n) { glGenTextures(n, reinterpret_cast<GLuint*>(out)); }

// ---- windows
XPLM_API XPLMWindowID XPLMCreateWindowEx(XPLMCreateWindow_t* p) {
    if (!p || p->structSize < (int)sizeof(XPLMCreateWindow_t)) fail("XPLMCreateWindowEx: bad structSize");
    auto* w = new Win;
    w->p = *p;
    w->l = p->left; w->t = p->top; w->r = p->right; w->b = p->bottom;
    w->visible = p->visible != 0;
    gWins.emplace_back(w);
    return w;
}
XPLM_API void XPLMDestroyWindow(XPLMWindowID id) {
    Win* w = W(id);
    if (!w) return;
    if (gFocus == w) gFocus = nullptr;
    w->alive = false;
}
XPLM_API void XPLMGetWindowGeometry(XPLMWindowID id, int* l, int* t, int* r, int* b) {
    Win* w = W(id);
    if (!w) return;
    if (l) *l = w->l;
    if (t) *t = w->t;
    if (r) *r = w->r;
    if (b) *b = w->b;
}
XPLM_API void XPLMSetWindowGeometry(XPLMWindowID id, int l, int t, int r, int b) {
    Win* w = W(id);
    if (!w) return;
    if (r - l < w->minW || t - b < w->minH) { r = std::max(r, l + w->minW); b = std::min(b, t - w->minH); }
    w->l = l; w->t = t; w->r = r; w->b = b;
}
XPLM_API void XPLMSetWindowGeometryOS(XPLMWindowID id, int l, int t, int r, int b) {
    Win* w = W(id);
    if (!w) return;
    if (!w->popped) fail("XPLMSetWindowGeometryOS on a window that is not popped out");
    // an OS window: keep it on our one screen for the screenshots, same size
    int wd = r - l, ht = t - b;
    w->l = 40; w->r = 40 + wd; w->t = (int)(gH / gScale) - 40; w->b = w->t - ht;
}
XPLM_API int XPLMGetWindowIsVisible(XPLMWindowID id) { Win* w = W(id); return w && w->visible; }
XPLM_API void XPLMSetWindowIsVisible(XPLMWindowID id, int v) { if (Win* w = W(id)) w->visible = v != 0; }
XPLM_API int XPLMWindowIsPoppedOut(XPLMWindowID id) { Win* w = W(id); return w && w->popped; }
XPLM_API int XPLMWindowIsInVR(XPLMWindowID id) { Win* w = W(id); return w && w->vr; }
XPLM_API void XPLMSetWindowPositioningMode(XPLMWindowID id, XPLMWindowPositioningMode mode, int) {
    Win* w = W(id);
    if (!w) return;
    w->popped = mode == xplm_WindowPopOut;
    w->vr = mode == xplm_WindowVR;
}
XPLM_API void XPLMSetWindowResizingLimits(XPLMWindowID id, int minW, int minH, int maxW, int maxH) {
    if (Win* w = W(id)) { w->minW = minW; w->minH = minH; w->maxW = maxW; w->maxH = maxH; }
}
XPLM_API void XPLMSetWindowTitle(XPLMWindowID id, const char* t) { if (Win* w = W(id)) w->title = t ? t : ""; }
XPLM_API void XPLMGetScreenBoundsGlobal(int* l, int* t, int* r, int* b) {
    if (l) *l = 0;
    if (t) *t = (int)(gH / gScale);
    if (r) *r = (int)(gW / gScale);
    if (b) *b = 0;
}
XPLM_API void XPLMGetMouseLocationGlobal(int* x, int* y) { if (x) *x = gMouseX; if (y) *y = gMouseY; }
XPLM_API void XPLMTakeKeyboardFocus(XPLMWindowID id) {
    Win* w = id ? W(id) : nullptr;
    if (gFocus && gFocus != w && gFocus->alive && gFocus->p.handleKeyFunc)
        gFocus->p.handleKeyFunc(gFocus, 0, 0, 0, gFocus->p.refcon, 1);     // tell the old owner it lost the keyboard
    gFocus = w;
}
XPLM_API int XPLMHasKeyboardFocus(XPLMWindowID id) { return id != nullptr && gFocus == id; }
}  // extern "C"

// =================================================================== the fake simulator's frame
namespace {
LibHandle gLib = nullptr;
std::string gXpl;
typedef int (*StartFn)(char*, char*, char*);
typedef void (*VoidFn)(void);
typedef int (*EnableFn)(void);
typedef void (*MsgFn)(XPLMPluginID, int, void*);
StartFn pStart = nullptr;
VoidFn pStop = nullptr, pDisable = nullptr;
EnableFn pEnable = nullptr;
MsgFn pMsg = nullptr;
bool gEnabled = false, gStarted = false;
std::vector<double> gDrawMs, gLoopMs;

Win* pluginWindow() {
    for (auto& w : gWins) if (w->alive && !w->dummy) return w.get();
    return nullptr;
}

// another plugin's window, used to take the keyboard away from ours
void dummyKey(XPLMWindowID, char, XPLMKeyFlags, char, void*, int) {}
Win* gDummy = nullptr;
Win* dummyWindow() {
    if (gDummy) return gDummy;
    auto* w = new Win;
    std::memset(&w->p, 0, sizeof w->p);
    w->p.structSize = sizeof w->p;
    w->p.handleKeyFunc = dummyKey;
    w->l = 0; w->t = 100; w->r = 100; w->b = 0;
    w->dummy = true;
    gWins.emplace_back(w);
    return gDummy = w;
}

void addRef(const std::string& name, XPLMDataTypeID type, std::function<void(DataRef&)> refresh = nullptr) {
    auto d = std::make_unique<DataRef>();
    d->name = name;
    d->type = type;
    d->refresh = std::move(refresh);
    gRefs[name] = std::move(d);
}

void loadScenario(const std::string& path) {
    std::ifstream in(path);
    if (!in) { fail("cannot read %s", path.c_str()); return; }
    json j = json::parse(in);
    for (auto& [name, v] : j.items()) {
        const std::string t = v.at("t");
        const json& val = v.at("v");
        auto d = std::make_unique<DataRef>();
        d->name = name;
        if (t == "i") { d->type = xplmType_Int; d->num = val.get<double>(); }
        else if (t == "f") { d->type = xplmType_Float; d->num = val.get<double>(); }
        else if (t == "d") { d->type = xplmType_Double | xplmType_Float; d->num = val.get<double>(); }
        else if (t == "vf") { d->type = xplmType_FloatArray; for (auto& x : val) d->fv.push_back(x.get<float>()); }
        else if (t == "vi") { d->type = xplmType_IntArray; for (auto& x : val) d->iv.push_back(x.get<int>()); }
        else if (t == "b") { d->type = xplmType_Data; d->bytes = val.get<std::string>(); d->bytes.resize(std::max<size_t>(d->bytes.size() + 1, 40), '\0'); }
        else if (t == "bx") {   // raw bytes as hex, e.g. text that is not valid UTF-8
            d->type = xplmType_Data;
            const std::string hex = val.get<std::string>();
            for (size_t i = 0; i + 1 < hex.size(); i += 2) d->bytes.push_back((char)std::strtol(hex.substr(i, 2).c_str(), nullptr, 16));
            d->bytes.resize(std::max<size_t>(d->bytes.size() + 1, 40), '\0');
        }
        gRefs[name] = std::move(d);
    }
}

void setRef(const std::string& name, const std::string& value) {
    auto it = gRefs.find(name);
    if (it == gRefs.end()) { fail("set: unknown dataref %s", name.c_str()); return; }
    DataRef& d = *it->second;
    if (d.type & xplmType_Data) { d.bytes = value; d.bytes.resize(std::max<size_t>(value.size() + 1, 40), '\0'); }
    else if (d.type & xplmType_FloatArray) { for (auto& x : d.fv) x = (float)std::atof(value.c_str()); }
    else if (d.type & xplmType_IntArray) { for (auto& x : d.iv) x = std::atoi(value.c_str()); }
    else d.num = std::atof(value.c_str());
}

void builtinRefs() {
    addRef("sim/graphics/misc/user_interface_scale", xplmType_Float, [](DataRef& d) { d.num = gScale; });
    addRef("sim/graphics/VR/enabled", xplmType_Int);
    addRef("sim/graphics/view/modelview_matrix", xplmType_FloatArray, [](DataRef& d) { d.fv.resize(16); glGetFloatv(GL_MODELVIEW_MATRIX, d.fv.data()); });
    addRef("sim/graphics/view/projection_matrix", xplmType_FloatArray, [](DataRef& d) { d.fv.resize(16); glGetFloatv(GL_PROJECTION_MATRIX, d.fv.data()); });
    addRef("sim/graphics/view/viewport", xplmType_IntArray, [](DataRef& d) { d.iv.resize(4); glGetIntegerv(GL_VIEWPORT, d.iv.data()); });
}

bool openGL() {
#ifdef _WIN32
    WNDCLASSA wc{};
    wc.style = CS_OWNDC;
    wc.lpfnWndProc = DefWindowProcA;
    wc.hInstance = GetModuleHandleA(nullptr);
    wc.lpszClassName = "XPFCHarness";
    RegisterClassA(&wc);
    RECT rc{0, 0, gW, gH};
    AdjustWindowRect(&rc, WS_OVERLAPPEDWINDOW, FALSE);
    gHwnd = CreateWindowA("XPFCHarness", "X-Plane stand-in", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 0, 0, rc.right - rc.left, rc.bottom - rc.top,
                          nullptr, nullptr, wc.hInstance, nullptr);
    if (!gHwnd) { std::fprintf(stderr, "CreateWindow failed\n"); return false; }
    gHdc = GetDC(gHwnd);
    PIXELFORMATDESCRIPTOR pfd{};
    pfd.nSize = sizeof pfd;
    pfd.nVersion = 1;
    pfd.dwFlags = PFD_DRAW_TO_WINDOW | PFD_SUPPORT_OPENGL | PFD_DOUBLEBUFFER;
    pfd.iPixelType = PFD_TYPE_RGBA;
    pfd.cColorBits = 24;
    pfd.cAlphaBits = 8;
    pfd.cDepthBits = 24;
    pfd.cStencilBits = 8;
    int pf = ChoosePixelFormat(gHdc, &pfd);
    if (!pf || !SetPixelFormat(gHdc, pf, &pfd)) { std::fprintf(stderr, "no pixel format\n"); return false; }
    gGlrc = wglCreateContext(gHdc);
    if (!gGlrc || !wglMakeCurrent(gHdc, gGlrc)) { std::fprintf(stderr, "no OpenGL context\n"); return false; }
#else
    gDpy = XOpenDisplay(nullptr);
    if (!gDpy) { std::fprintf(stderr, "no X display (run under Xvfb)\n"); return false; }
    int attrs[] = {GLX_RGBA, GLX_DOUBLEBUFFER, GLX_RED_SIZE, 8, GLX_GREEN_SIZE, 8, GLX_BLUE_SIZE, 8, GLX_DEPTH_SIZE, 24, GLX_STENCIL_SIZE, 8, None};
    XVisualInfo* vi = glXChooseVisual(gDpy, DefaultScreen(gDpy), attrs);
    if (!vi) { std::fprintf(stderr, "no GLX visual\n"); return false; }
    XSetWindowAttributes swa{};
    swa.colormap = XCreateColormap(gDpy, RootWindow(gDpy, vi->screen), vi->visual, AllocNone);
    swa.event_mask = ExposureMask;
    gXWin = XCreateWindow(gDpy, RootWindow(gDpy, vi->screen), 0, 0, gW, gH, 0, vi->depth, InputOutput, vi->visual, CWColormap | CWEventMask, &swa);
    XMapWindow(gDpy, gXWin);
    gCtx = glXCreateContext(gDpy, vi, nullptr, True);
    glXMakeCurrent(gDpy, gXWin, gCtx);
    XFree(vi);
#endif
    std::fprintf(stderr, "OpenGL: %s / %s\n", (const char*)glGetString(GL_RENDERER), (const char*)glGetString(GL_VERSION));
    return true;
}

// Leave some mess behind, as other plugins may: a bound buffer, shader and vertex array object, odd pixel
// store. The plugin must draw correctly anyway and put it all back.
typedef void (*PFNBindBuffer)(GLenum, GLuint);
typedef void (*PFNGenBuffers)(GLsizei, GLuint*);
typedef void (*PFNBufferData)(GLenum, ptrdiff_t, const void*, GLenum);
typedef void (*PFNBindVAO)(GLuint);
typedef void (*PFNGenVAO)(GLsizei, GLuint*);
GLuint gMessBuf = 0, gMessVao = 0;
bool gMess = false;
void makeMess() {
    static PFNBindBuffer bindBuffer = (PFNBindBuffer)glProc("glBindBuffer");
    static PFNGenBuffers genBuffers = (PFNGenBuffers)glProc("glGenBuffers");
    static PFNBufferData bufferData = (PFNBufferData)glProc("glBufferData");
    static PFNBindVAO bindVao = (PFNBindVAO)glProc("glBindVertexArray");
    static PFNGenVAO genVao = (PFNGenVAO)glProc("glGenVertexArrays");
    if (!gMessBuf) {
        genBuffers(1, &gMessBuf);
        bindBuffer(0x8892 /*GL_ARRAY_BUFFER*/, gMessBuf);
        static float junk[64] = {0};
        bufferData(0x8892, sizeof junk, junk, 0x88E4 /*GL_STATIC_DRAW*/);
        genVao(1, &gMessVao);
    }
    bindVao(gMessVao);
    bindBuffer(0x8892, gMessBuf);
    bindBuffer(0x8893 /*GL_ELEMENT_ARRAY_BUFFER*/, gMessBuf);
    glPixelStorei(GL_UNPACK_ROW_LENGTH, 7);
    glPixelStorei(GL_UNPACK_ALIGNMENT, 1);
}
void checkMess() {
    GLint vao = 0, ab = 0, eab = 0, rowLen = 0;
    glGetIntegerv(0x85B5 /*GL_VERTEX_ARRAY_BINDING*/, &vao);
    glGetIntegerv(0x8894 /*GL_ARRAY_BUFFER_BINDING*/, &ab);
    glGetIntegerv(0x8895 /*GL_ELEMENT_ARRAY_BUFFER_BINDING*/, &eab);
    glGetIntegerv(GL_UNPACK_ROW_LENGTH, &rowLen);
    if ((GLuint)vao != gMessVao || (GLuint)ab != gMessBuf || (GLuint)eab != gMessBuf || rowLen != 7)
        fail("OpenGL state not restored after drawing (vao %d, array %d, element %d, row length %d)", vao, ab, eab, rowLen);
    static PFNBindVAO bindVao = (PFNBindVAO)glProc("glBindVertexArray");
    static PFNBindBuffer bindBuffer = (PFNBindBuffer)glProc("glBindBuffer");
    bindVao(0);
    bindBuffer(0x8892, 0);
    glPixelStorei(GL_UNPACK_ROW_LENGTH, 0);
    glPixelStorei(GL_UNPACK_ALIGNMENT, 4);
}

void runLoops() {
    for (size_t i = 0; i < gLoops.size(); i++) {
        Loop* l = gLoops[i].get();
        if (!l->alive || !l->scheduled) continue;
        bool due = (l->dueFrame >= 0) ? gFrame >= l->dueFrame : gElapsed >= l->due;
        if (!due) continue;
        auto t0 = std::chrono::steady_clock::now();
        float next = l->p.callbackFunc(gElapsed - l->last, gElapsed - l->last, ++l->count, l->p.refcon);
        gLoopMs.push_back(std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count());
        l->last = gElapsed;
        if (!l->alive) continue;
        if (next > 0) { l->due = gElapsed + next; l->dueFrame = -1; }
        else if (next < 0) l->dueFrame = gFrame + (int)(-next);
        else l->scheduled = false;
    }
}

void drawDecoration(const Win& w) {
    // X-Plane's floating-window frame: a dark border and a drag bar on top
    glDisable(GL_TEXTURE_2D);
    glEnable(GL_BLEND);
    glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
    glColor4f(0.08f, 0.09f, 0.10f, 0.96f);
    glBegin(GL_QUADS);
    glVertex2i(w.l - 5, w.b - 5); glVertex2i(w.r + 5, w.b - 5); glVertex2i(w.r + 5, w.t + 22); glVertex2i(w.l - 5, w.t + 22);
    glEnd();
    glColor4f(0.30f, 0.32f, 0.35f, 1.0f);
    glBegin(GL_QUADS);
    int cx = (w.l + w.r) / 2;
    glVertex2i(cx - 30, w.t + 9); glVertex2i(cx + 30, w.t + 9); glVertex2i(cx + 30, w.t + 12); glVertex2i(cx - 30, w.t + 12);
    glEnd();
}

void frame(bool swap = true) {
    gFrame++;
    gElapsed += 1.0f / 30.0f;
    runLoops();
    glViewport(0, 0, gW, gH);
    glDisable(GL_SCISSOR_TEST);
    glClearColor(0.33f, 0.47f, 0.62f, 1.0f);
    glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);
    glMatrixMode(GL_PROJECTION);
    glLoadIdentity();
    glOrtho(0, gW / gScale, 0, gH / gScale, -1, 1);
    glMatrixMode(GL_MODELVIEW);
    glLoadIdentity();
    // ground and horizon, so screenshots look like the sim is behind the window
    glDisable(GL_TEXTURE_2D);
    glBegin(GL_QUADS);
    glColor3f(0.36f, 0.33f, 0.27f);
    glVertex2f(0, 0); glVertex2f(gW / gScale, 0);
    glColor3f(0.50f, 0.47f, 0.38f);
    glVertex2f(gW / gScale, gH / gScale * 0.35f); glVertex2f(0, gH / gScale * 0.35f);
    glEnd();
    for (size_t i = 0; i < gWins.size(); i++) {
        Win* w = gWins[i].get();
        if (!w->alive || !w->visible) continue;
        drawDecoration(*w);
        if (gMess) makeMess();
        auto t0 = std::chrono::steady_clock::now();
        w->p.drawWindowFunc(w, w->p.refcon);
        gDrawMs.push_back(std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count());
        if (gMess) checkMess();
        GLenum e;
        while ((e = glGetError()) != GL_NO_ERROR) fail("OpenGL error 0x%04x after the plugin drew", e);
    }
    if (swap) swapBuffers();
}

void toGlobal(Win* w, int px, int py, int& gx, int& gy) {
    gx = w->l + (int)std::lround(px / gScale);
    gy = w->t - (int)std::lround(py / gScale);
}

Win* windowAt(int gx, int gy) {
    for (int i = (int)gWins.size() - 1; i >= 0; i--) {
        Win* w = gWins[i].get();
        if (w->alive && w->visible && gx >= w->l && gx <= w->r && gy >= w->b && gy <= w->t) return w;
    }
    return nullptr;
}

void mouseMove(int gx, int gy) {
    gMouseX = gx; gMouseY = gy;
    if (Win* w = windowAt(gx, gy)) if (w->p.handleCursorFunc) w->p.handleCursorFunc(w, gx, gy, w->p.refcon);
}

void click(int px, int py, bool right) {
    Win* w = pluginWindow();
    if (!w || !w->visible) { fail("click: the window is not visible"); return; }
    int gx, gy;
    toGlobal(w, px, py, gx, gy);
    mouseMove(gx, gy);
    frame();
    auto fn = right ? w->p.handleRightClickFunc : w->p.handleMouseClickFunc;
    fn(w, gx, gy, xplm_MouseDown, w->p.refcon);
    frame();
    fn(w, gx, gy, xplm_MouseUp, w->p.refcon);
    frame();
    frame();
}

void sendKey(char ch, char vk, int extraFlags = 0) {
    if (!gFocus) { fail("key '%c' (vk %d): no window has the keyboard", ch ? ch : '?', vk); return; }
    Win* w = gFocus;
    w->p.handleKeyFunc(w, ch, xplm_DownFlag | extraFlags, vk, w->p.refcon, 0);
    frame();
    if (gFocus == w) w->p.handleKeyFunc(w, ch, xplm_UpFlag | extraFlags, vk, w->p.refcon, 0);
    frame();
}

char vkFor(char c) {
    if (c >= 'a' && c <= 'z') return (char)(XPLM_VK_A + (c - 'a'));
    if (c >= 'A' && c <= 'Z') return (char)(XPLM_VK_A + (c - 'A'));
    if (c >= '0' && c <= '9') return (char)(XPLM_VK_0 + (c - '0'));
    switch (c) {
        case '.': return XPLM_VK_PERIOD;
        case ',': return XPLM_VK_COMMA;
        case '-': return XPLM_VK_MINUS;
        case ' ': return XPLM_VK_SPACE;
        case '/': return XPLM_VK_SLASH;
        default: return 0;
    }
}

void shot(const std::string& file) {
    Win* w = pluginWindow();
    int x0, y0, x1, y1;
    if (w && w->visible) {
        x0 = (int)((w->l - 16) * gScale); x1 = (int)((w->r + 16) * gScale);
        y0 = (int)((w->b - 16) * gScale); y1 = (int)((w->t + 34) * gScale);
    } else { x0 = 0; y0 = 0; x1 = gW; y1 = gH; }
    x0 = std::max(0, x0); y0 = std::max(0, y0); x1 = std::min(gW, x1); y1 = std::min(gH, y1);
    int wd = x1 - x0, ht = y1 - y0;
    std::vector<unsigned char> px((size_t)wd * ht * 3);
    frame(false);                 // draw once more and read it before the buffers swap
    glReadBuffer(GL_BACK);
    glPixelStorei(GL_PACK_ALIGNMENT, 1);
    glReadPixels(x0, y0, wd, ht, GL_RGB, GL_UNSIGNED_BYTE, px.data());
    swapBuffers();
    std::string ppm = file + ".ppm";
    FILE* f = std::fopen(ppm.c_str(), "wb");
    if (!f) { fail("cannot write %s", ppm.c_str()); return; }
    std::fprintf(f, "P6\n%d %d\n255\n", wd, ht);
    for (int y = ht - 1; y >= 0; y--) std::fwrite(&px[(size_t)y * wd * 3], 1, (size_t)wd * 3, f);
    std::fclose(f);
#ifdef _WIN32
    std::fprintf(stderr, "shot %s (%dx%d)\n", ppm.c_str(), wd, ht);    // converted to .png afterwards
#else
    std::string cmd = "convert '" + ppm + "' '" + file + "' && rm -f '" + ppm + "'";
    if (std::system(cmd.c_str()) != 0) fail("convert failed for %s", file.c_str());
    else std::fprintf(stderr, "shot %s (%dx%d)\n", file.c_str(), wd, ht);
#endif
}

bool loadPlugin() {
    gLib = libOpen(gXpl);
    if (!gLib) { std::fprintf(stderr, "loading %s failed: %s\n", gXpl.c_str(), libError().c_str()); return false; }
    pStart = (StartFn)libSym(gLib, "XPluginStart");
    pStop = (VoidFn)libSym(gLib, "XPluginStop");
    pEnable = (EnableFn)libSym(gLib, "XPluginEnable");
    pDisable = (VoidFn)libSym(gLib, "XPluginDisable");
    pMsg = (MsgFn)libSym(gLib, "XPluginReceiveMessage");
    if (!pStart || !pStop || !pEnable || !pDisable || !pMsg) { std::fprintf(stderr, "missing XPlugin* entry points\n"); return false; }
    return true;
}

void startPlugin() {
    char name[256] = {0}, sig[256] = {0}, desc[256] = {0};
    if (!pStart(name, sig, desc)) fail("XPluginStart returned 0");
    std::fprintf(stderr, "started: %s | %s | %s\n", name, sig, desc);
    gStarted = true;
    if (!pEnable()) fail("XPluginEnable returned 0");
    gEnabled = true;
    pMsg(0, XPLM_MSG_PLANE_LOADED, nullptr);
}

void disablePlugin() {
    if (!gEnabled) return;
    pDisable();
    gEnabled = false;
    for (auto& l : gLoops) if (l->alive) fail("flight loop still alive after XPluginDisable");
    for (auto& w : gWins) if (w->alive && !w->dummy) fail("window still alive after XPluginDisable");
    if (gFocus && !gFocus->dummy) fail("keyboard focus still held after XPluginDisable");
}

void stopPlugin() {
    disablePlugin();
    if (!gStarted) return;
    pStop();
    gStarted = false;
    for (auto& c : gCmds) if (!c->handlers.empty()) fail("command %s still has handlers after XPluginStop", c->name.c_str());
    for (auto& m : gMenus) if (m->alive) fail("menu %s still exists after XPluginStop", m->name.c_str());
}

Menu* findMenu(const std::string& name) {
    for (auto& m : gMenus) if (m->alive && m->name == name) return m.get();
    return nullptr;
}

void runCommand(const std::string& name) {
    Cmd* c = nullptr;
    for (auto& x : gCmds) if (x->name == name) c = x.get();
    if (!c) { fail("no command %s", name.c_str()); return; }
    for (auto phase : {xplm_CommandBegin, xplm_CommandEnd})
        for (auto h : std::vector<Handler>(c->handlers)) h.cb(c, phase, h.ref);
}

std::vector<std::string> words(const std::string& line) {
    std::vector<std::string> out;
    std::istringstream ss(line);
    std::string w;
    while (ss >> w) out.push_back(w);
    return out;
}

void printTiming() {
    auto stats = [](const char* what, std::vector<double> v) {
        if (v.empty()) return;
        std::sort(v.begin(), v.end());
        double sum = 0;
        for (double x : v) sum += x;
        std::fprintf(stderr, "timing %s: %zu calls, mean %.2f ms, median %.2f ms, p95 %.2f ms, max %.2f ms\n", what, v.size(), sum / v.size(),
                     v[v.size() / 2], v[(size_t)(v.size() * 0.95)], v.back());
    };
    stats("draw", gDrawMs);
    stats("flight loop", gLoopMs);
}

void runScript(std::istream& in, const std::string& outDir) {
    std::string line;
    int ln = 0;
    while (std::getline(in, line)) {
        ln++;
        if (line.empty() || line[0] == '#') continue;
        auto w = words(line);
        if (w.empty()) continue;
        const std::string& c = w[0];
        auto rest = [&](size_t from) { size_t p = 0; for (size_t i = 0; i < from; i++) { p = line.find_first_not_of(' ', p); p = line.find(' ', p); } return p == std::string::npos ? std::string() : line.substr(line.find_first_not_of(' ', p)); };
        if (c == "frames") { int n = std::atoi(w.at(1).c_str()); for (int i = 0; i < n; i++) frame(); }
        else if (c == "click" || c == "rclick") click(std::atoi(w.at(1).c_str()), std::atoi(w.at(2).c_str()), c == "rclick");
        else if (c == "move") {
            Win* win = pluginWindow();
            int gx, gy;
            toGlobal(win, std::atoi(w.at(1).c_str()), std::atoi(w.at(2).c_str()), gx, gy);
            mouseMove(gx, gy);
            frame(); frame();
        } else if (c == "outside") { mouseMove(5, 5); frame(); frame(); }
        else if (c == "drag") {
            Win* win = pluginWindow();
            int x1, y1, x2, y2;
            toGlobal(win, std::atoi(w.at(1).c_str()), std::atoi(w.at(2).c_str()), x1, y1);
            toGlobal(win, std::atoi(w.at(3).c_str()), std::atoi(w.at(4).c_str()), x2, y2);
            mouseMove(x1, y1); frame();
            win->p.handleMouseClickFunc(win, x1, y1, xplm_MouseDown, win->p.refcon); frame();
            for (int i = 1; i <= 8; i++) {
                int x = x1 + (x2 - x1) * i / 8, y = y1 + (y2 - y1) * i / 8;
                gMouseX = x; gMouseY = y;
                win->p.handleMouseClickFunc(win, x, y, xplm_MouseDrag, win->p.refcon); frame();
            }
            win->p.handleMouseClickFunc(win, x2, y2, xplm_MouseUp, win->p.refcon); frame(); frame();
        } else if (c == "wheel") {
            Win* win = pluginWindow();
            int gx, gy;
            toGlobal(win, std::atoi(w.at(1).c_str()), std::atoi(w.at(2).c_str()), gx, gy);
            mouseMove(gx, gy);
            win->p.handleMouseWheelFunc(win, gx, gy, 0, std::atoi(w.at(3).c_str()), win->p.refcon);
            frame(); frame();
        } else if (c == "type") {
            std::string text = rest(1);
            for (char ch : text) sendKey(ch, vkFor(ch));
        } else if (c == "key") {
            static const std::map<std::string, std::pair<char, char>> keys = {
                {"RETURN", {'\r', XPLM_VK_RETURN}}, {"TAB", {'\t', XPLM_VK_TAB}}, {"BACK", {8, XPLM_VK_BACK}}, {"ESCAPE", {27, XPLM_VK_ESCAPE}},
                {"LEFT", {0, XPLM_VK_LEFT}}, {"RIGHT", {0, XPLM_VK_RIGHT}}, {"DELETE", {127, XPLM_VK_DELETE}}, {"HOME", {0, XPLM_VK_HOME}},
                {"END", {0, XPLM_VK_END}}, {"CTRL_A", {'a', XPLM_VK_A}}};
            auto it = keys.find(w.at(1));
            if (it == keys.end()) fail("line %d: unknown key %s", ln, w.at(1).c_str());
            else sendKey(it->second.first, it->second.second, w.at(1) == "CTRL_A" ? xplm_ControlFlag : 0);
        } else if (c == "cmd") { runCommand(w.at(1)); frame(); frame(); }
        else if (c == "menu") {
            std::string path = rest(1);
            size_t slash = path.find('/');
            Menu* m = findMenu(path.substr(0, slash));
            if (!m) { fail("line %d: no menu %s", ln, path.substr(0, slash).c_str()); continue; }
            std::string item = path.substr(slash + 1);
            bool found = false;
            for (auto& it : m->items) {
                if (it.name != item) continue;
                found = true;
                if (it.cmd) runCommand(it.cmd->name);
                else if (m->handler) m->handler(m->ref, it.ref);
            }
            if (!found) fail("line %d: no menu item %s", ln, item.c_str());
            frame(); frame();
        } else if (c == "set") setRef(w.at(1), rest(2));
        else if (c == "scale") { gScale = (float)std::atof(w.at(1).c_str()); frame(); frame(); }
        else if (c == "resize") {
            Win* win = pluginWindow();
            XPLMSetWindowGeometry(win, win->l, win->t, win->l + std::atoi(w.at(1).c_str()), win->t - std::atoi(w.at(2).c_str()));
            frame(); frame();
        } else if (c == "shot") shot(outDir + "/" + w.at(1));
        else if (c == "disable") { disablePlugin(); frame(); }
        else if (c == "enable") { if (!pEnable()) fail("XPluginEnable returned 0"); gEnabled = true; frame(); }
        else if (c == "reload") {
            stopPlugin();
            libClose(gLib);
            gLib = nullptr;
            if (!loadPlugin()) { fail("reload failed"); return; }
            startPlugin();
            frame();
        } else if (c == "mess") gMess = w.at(1) == "1";
        else if (c == "steal_focus") { XPLMTakeKeyboardFocus(dummyWindow()); frame(); frame(); frame(); }
        else if (c == "expect_log") {
            std::string t = rest(1);
            if (gLog.find(t) == std::string::npos) fail("line %d: log does not contain \"%s\"", ln, t.c_str());
        } else if (c == "expect_focus") {
            bool want = w.at(1) == "1";
            if ((gFocus != nullptr) != want) fail("line %d: keyboard focus is %s", ln, gFocus ? "held" : "free");
        } else if (c == "expect_ours") {
            Win* win = pluginWindow();
            bool ours = win && gFocus == win;
            if (ours != (w.at(1) == "1")) fail("line %d: the plugin window %s the keyboard", ln, ours ? "has" : "does not have");
        } else if (c == "expect_visible") {
            Win* win = pluginWindow();
            bool vis = win && win->visible;
            if (vis != (w.at(1) == "1")) fail("line %d: window visible = %d", ln, vis);
        } else if (c == "say") std::fprintf(stderr, "-- %s\n", rest(1).c_str());
        else if (c == "log") { std::fprintf(stderr, "%s", gLogSince.c_str()); gLogSince.clear(); }
        else if (c == "timing") printTiming();
        else if (c == "geometry") { Win* win = pluginWindow(); if (win) std::fprintf(stderr, "window %d,%d %dx%d boxels (scale %.2f)\n", win->l, win->t, win->r - win->l, win->t - win->b, gScale); }
        else fail("line %d: unknown command %s", ln, c.c_str());
    }
}
}  // namespace

#ifdef _WIN32
extern "C" __declspec(dllexport) int harness_main(int argc, char** argv) {
#else
int main(int argc, char** argv) {
#endif
    std::string data, script, outDir = ".";
    for (int i = 1; i < argc; i++) {
        std::string a = argv[i];
        auto next = [&]() { return i + 1 < argc ? std::string(argv[++i]) : std::string(); };
        if (a == "--xpl") gXpl = next();
        else if (a == "--plugin-path") gPluginPath = next();
        else if (a == "--data") data = next();
        else if (a == "--prefs") gPrefsPath = next();
        else if (a == "--script") script = next();
        else if (a == "--out") outDir = next();
        else if (a == "--size") { gW = std::atoi(next().c_str()); gH = std::atoi(next().c_str()); }
        else if (a == "-v") gVerbose = true;
    }
    if (gPluginPath.empty()) gPluginPath = gXpl;
    if (gPrefsPath.empty()) gPrefsPath = ".";
    if (!openGL()) return 2;
    builtinRefs();
    if (!data.empty()) loadScenario(data);
    if (!loadPlugin()) return 2;
    startPlugin();
    frame();
    if (!script.empty()) {
        std::ifstream in(script);
        if (!in) { std::fprintf(stderr, "cannot read %s\n", script.c_str()); return 2; }
        runScript(in, outDir);
    }
    stopPlugin();
    printTiming();
    std::fprintf(stderr, "---- Log.txt ----\n%s-----------------\n", gLog.c_str());
    libClose(gLib);
    std::fprintf(stderr, gFailures ? "HARNESS: %d failure(s)\n" : "HARNESS: all checks passed\n", gFailures);
    return gFailures ? 1 : 0;
}
