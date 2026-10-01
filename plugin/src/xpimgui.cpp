// XP Flight Computer — Dear ImGui on an XPLM window. See xpimgui.h.
#include "xpimgui.h"
#include "XPLMDataAccess.h"
#include "XPLMGraphics.h"
#include "XPLMProcessing.h"
#include "XPLMUtilities.h"
#include "imgui_internal.h"
#include <cfloat>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <exception>
#include <set>
#include <string>

#if IBM
#include <windows.h>
#else
#include <dlfcn.h>
#endif
#include <GL/gl.h>

// ------------------------------------------------------------------ ImGui checks (see imconfig_xpfc.h)
void xpfcImGuiAssert(const char* expr, const char* file, int line) {
    static std::set<std::string> seen;
    std::string where = std::string(file ? file : "?") + ":" + std::to_string(line);
    if (seen.size() < 64 && seen.insert(where).second)
        XPLMDebugString(("XP Flight Computer: interface check failed (" + std::string(expr ? expr : "?") + ") at " + where + "\n").c_str());
#ifdef XPFC_ABORT_ON_ASSERT
    std::abort();
#endif
}

// ------------------------------------------------------------------ the few OpenGL calls past version 1.1
// Other plugins may leave a shader, a vertex array object or buffers bound; ImGui's client-side arrays need
// all of them cleared while it draws. Loaded at run time (Windows' opengl32.dll only exports OpenGL 1.1).
#ifndef APIENTRY
#define APIENTRY
#endif
#ifndef GL_ARRAY_BUFFER
#define GL_ARRAY_BUFFER 0x8892
#define GL_ELEMENT_ARRAY_BUFFER 0x8893
#endif
#ifndef GL_PIXEL_UNPACK_BUFFER
#define GL_PIXEL_UNPACK_BUFFER 0x88EC
#define GL_PIXEL_UNPACK_BUFFER_BINDING 0x88EF
#endif
#ifndef GL_CURRENT_PROGRAM
#define GL_CURRENT_PROGRAM 0x8B8D
#endif
#ifndef GL_VERTEX_ARRAY_BINDING
#define GL_VERTEX_ARRAY_BINDING 0x85B5
#endif
#ifndef GL_TEXTURE0
#define GL_TEXTURE0 0x84C0
#endif

namespace {
namespace glx {
typedef void(APIENTRY* BindBufferFn)(GLenum, GLuint);
typedef void(APIENTRY* UseProgramFn)(GLuint);
typedef void(APIENTRY* BindVertexArrayFn)(GLuint);
typedef void(APIENTRY* ClientActiveTextureFn)(GLenum);
BindBufferFn bindBuffer = nullptr;
UseProgramFn useProgram = nullptr;
BindVertexArrayFn bindVertexArray = nullptr;
ClientActiveTextureFn clientActiveTexture = nullptr;
bool loaded = false;

#if IBM
void* proc(const char* name) {
    void* p = (void*)wglGetProcAddress(name);
    if (p == nullptr || p == (void*)1 || p == (void*)2 || p == (void*)3 || p == (void*)-1) return nullptr;
    return p;
}
#else
extern "C" typedef void* (*GetProcFn)(const unsigned char*);
void* proc(const char* name) {
    static GetProcFn getProc = (GetProcFn)dlsym(RTLD_DEFAULT, "glXGetProcAddressARB");
    void* p = getProc ? getProc((const unsigned char*)name) : nullptr;
    return p ? p : dlsym(RTLD_DEFAULT, name);
}
#endif

void load() {
    if (loaded) return;
    loaded = true;
    int major = 1, minor = 1;
    if (const char* v = (const char*)glGetString(GL_VERSION)) {
        major = std::atoi(v);
        if (const char* dot = std::strchr(v, '.')) minor = std::atoi(dot + 1);
    }
    const int ver = major * 10 + minor;
    if (ver >= 13) clientActiveTexture = (ClientActiveTextureFn)proc("glClientActiveTexture");
    if (ver >= 15) bindBuffer = (BindBufferFn)proc("glBindBuffer");
    if (ver >= 20) useProgram = (UseProgramFn)proc("glUseProgram");
    if (ver >= 30) bindVertexArray = (BindVertexArrayFn)proc("glBindVertexArray");
}
}  // namespace glx

XPLMDataRef findRef(const char* name) { return XPLMFindDataRef(name); }
XPLMDataRef refUiScale() { static XPLMDataRef r = findRef("sim/graphics/misc/user_interface_scale"); return r; }
XPLMDataRef refVrEnabled() { static XPLMDataRef r = findRef("sim/graphics/VR/enabled"); return r; }
XPLMDataRef refModelview() { static XPLMDataRef r = findRef("sim/graphics/view/modelview_matrix"); return r; }
XPLMDataRef refProjection() { static XPLMDataRef r = findRef("sim/graphics/view/projection_matrix"); return r; }
XPLMDataRef refViewport() { static XPLMDataRef r = findRef("sim/graphics/view/viewport"); return r; }

ImGuiKey mapKey(unsigned char vk) {
    switch (vk) {
        case XPLM_VK_BACK: return ImGuiKey_Backspace;
        case XPLM_VK_TAB: return ImGuiKey_Tab;
        case XPLM_VK_RETURN: return ImGuiKey_Enter;
        case XPLM_VK_ENTER: return ImGuiKey_KeypadEnter;
        case XPLM_VK_NUMPAD_ENT: return ImGuiKey_KeypadEnter;
        case XPLM_VK_ESCAPE: return ImGuiKey_Escape;
        case XPLM_VK_SPACE: return ImGuiKey_Space;
        case XPLM_VK_PRIOR: return ImGuiKey_PageUp;
        case XPLM_VK_NEXT: return ImGuiKey_PageDown;
        case XPLM_VK_END: return ImGuiKey_End;
        case XPLM_VK_HOME: return ImGuiKey_Home;
        case XPLM_VK_LEFT: return ImGuiKey_LeftArrow;
        case XPLM_VK_UP: return ImGuiKey_UpArrow;
        case XPLM_VK_RIGHT: return ImGuiKey_RightArrow;
        case XPLM_VK_DOWN: return ImGuiKey_DownArrow;
        case XPLM_VK_INSERT: return ImGuiKey_Insert;
        case XPLM_VK_DELETE: return ImGuiKey_Delete;
        default: break;
    }
    if (vk >= XPLM_VK_A && vk <= XPLM_VK_Z) return (ImGuiKey)(ImGuiKey_A + (vk - XPLM_VK_A));
    if (vk >= XPLM_VK_0 && vk <= XPLM_VK_9) return (ImGuiKey)(ImGuiKey_0 + (vk - XPLM_VK_0));
    return ImGuiKey_None;
}

/** Boxel coordinates → window pixels, using the matrices X-Plane set up for this window. */
void boxelToPixel(float x, float y, const float mv[16], const float pj[16], const int vp[4], float& ox, float& oy) {
    float ex = mv[0] * x + mv[4] * y + mv[12], ey = mv[1] * x + mv[5] * y + mv[13];
    float ez = mv[2] * x + mv[6] * y + mv[14], ew = mv[3] * x + mv[7] * y + mv[15];
    float cx = pj[0] * ex + pj[4] * ey + pj[8] * ez + pj[12] * ew;
    float cy = pj[1] * ex + pj[5] * ey + pj[9] * ez + pj[13] * ew;
    float cw = pj[3] * ex + pj[7] * ey + pj[11] * ez + pj[15] * ew;
    if (cw == 0.0f) cw = 1.0f;
    ox = vp[0] + (cx / cw + 1.0f) * 0.5f * vp[2];
    oy = vp[1] + (cy / cw + 1.0f) * 0.5f * vp[3];
}

/** Current modelview, projection and viewport: X-Plane's datarefs (valid while drawing), else OpenGL's own. */
void currentMatrices(float mv[16], float pj[16], int vp[4]) {
    if (refModelview() && refProjection() && refViewport() && XPLMGetDatavf(refModelview(), mv, 0, 16) == 16 &&
        XPLMGetDatavf(refProjection(), pj, 0, 16) == 16 && XPLMGetDatavi(refViewport(), vp, 0, 4) == 4 && vp[2] > 0 && vp[3] > 0)
        return;
    glGetFloatv(GL_MODELVIEW_MATRIX, mv);
    glGetFloatv(GL_PROJECTION_MATRIX, pj);
    GLint v[4];
    glGetIntegerv(GL_VIEWPORT, v);
    for (int i = 0; i < 4; i++) vp[i] = v[i];
}
}  // namespace

XPImGuiWindow::XPImGuiWindow(int left, int top, int right, int bottom, const char* title)
    : homeL_(left), homeT_(top), homeR_(right), homeB_(bottom) {
    ImGuiContext* prev = ImGui::GetCurrentContext();
    ctx_ = ImGui::CreateContext();
    ImGui::SetCurrentContext(ctx_);
    ImGuiIO& io = ImGui::GetIO();
    io.IniFilename = nullptr;
    io.LogFilename = nullptr;
    io.ConfigFlags |= ImGuiConfigFlags_NavEnableKeyboard;
    io.BackendPlatformName = "xplm";
    io.BackendRendererName = "xplm-gl-fixed";
    io.ConfigErrorRecovery = true;
    io.ConfigErrorRecoveryEnableTooltip = false;
#ifdef XPFC_ABORT_ON_ASSERT
    io.ConfigErrorRecoveryEnableAssert = true;
#else
    io.ConfigErrorRecoveryEnableAssert = false;
#endif
    if (prev) ImGui::SetCurrentContext(prev);

    XPLMCreateWindow_t p;
    std::memset(&p, 0, sizeof p);
    p.structSize = sizeof(p);
    p.left = left; p.top = top; p.right = right; p.bottom = bottom;
    p.visible = 0;
    p.drawWindowFunc = drawCB;
    p.handleMouseClickFunc = clickCB;
    p.handleRightClickFunc = rightClickCB;
    p.handleMouseWheelFunc = wheelCB;
    p.handleKeyFunc = keyCB;
    p.handleCursorFunc = cursorCB;
    p.refcon = this;
    p.decorateAsFloatingWindow = xplm_WindowDecorationRoundRectangle;
    p.layer = xplm_WindowLayerFloatingWindows;
    win_ = XPLMCreateWindowEx(&p);
    XPLMSetWindowPositioningMode(win_, xplm_WindowPositionFree, -1);
    XPLMSetWindowResizingLimits(win_, 520, 360, 3000, 2000);
    XPLMSetWindowTitle(win_, title);
}

XPImGuiWindow::~XPImGuiWindow() {
    if (win_) {
        releaseKeyboard();
        XPLMDestroyWindow(win_);
    }
    if (fontTex_) { GLuint t = (GLuint)fontTex_; glDeleteTextures(1, &t); }
    if (ctx_) ImGui::DestroyContext(ctx_);
}

void XPImGuiWindow::setVisible(bool v) {
    if (!v) { releaseKeyboard(); dropFocus_ = true; }
    XPLMSetWindowIsVisible(win_, v ? 1 : 0);
}
void XPImGuiWindow::releaseKeyboard() {
    if (!win_ || !XPLMHasKeyboardFocus(win_)) return;
    selfRelease_ = true;
    XPLMTakeKeyboardFocus(0);
    selfRelease_ = false;
}
bool XPImGuiWindow::isVisible() const { return XPLMGetWindowIsVisible(win_) != 0; }
bool XPImGuiWindow::isPoppedOut() const { return XPLMWindowIsPoppedOut(win_) != 0; }
bool XPImGuiWindow::isInVR() const { return XPLMWindowIsInVR(win_) != 0; }
bool XPImGuiWindow::vrAvailable() const { XPLMDataRef vr = refVrEnabled(); return vr && XPLMGetDatai(vr) != 0; }
void XPImGuiWindow::getGeometry(int& l, int& t, int& r, int& b) const { XPLMGetWindowGeometry(win_, &l, &t, &r, &b); }

void XPImGuiWindow::popOut() {
    int l, t, r, b;
    XPLMGetWindowGeometry(win_, &l, &t, &r, &b);
    XPLMSetWindowPositioningMode(win_, xplm_WindowPopOut, -1);
    XPLMSetWindowGeometryOS(win_, 80, 80 + (t - b), 80 + (r - l), 80);
}
void XPImGuiWindow::popIn() {
    XPLMSetWindowPositioningMode(win_, xplm_WindowPositionFree, -1);
    resetPosition();
}
void XPImGuiWindow::moveToVR() {
    if (vrAvailable()) XPLMSetWindowPositioningMode(win_, xplm_WindowVR, -1);
}
void XPImGuiWindow::resetPosition() {
    int sl, st, sr, sb;
    XPLMGetScreenBoundsGlobal(&sl, &st, &sr, &sb);
    int w = homeR_ - homeL_, h = homeT_ - homeB_;
    if (w > sr - sl - 40) w = sr - sl - 40;
    if (h > st - sb - 80) h = st - sb - 80;
    int l = sl + (sr - sl - w) / 2, t = st - 60;
    XPLMSetWindowPositioningMode(win_, xplm_WindowPositionFree, -1);
    XPLMSetWindowGeometry(win_, l, t, l + w, t - h);
}

float XPImGuiWindow::uiScale() const {
    float s = 1.0f;
    if (XPLMDataRef r = refUiScale()) s = XPLMGetDataf(r);
    if (!(s >= 1.0f)) s = 1.0f;
    if (s > 4.0f) s = 4.0f;
    return s;
}

void XPImGuiWindow::rebuildFonts() {
    ImGuiIO& io = ImGui::GetIO();
    fontScale_ = uiScale();
    io.Fonts->Clear();
    buildFonts(io.Fonts, fontScale_);
    unsigned char* px = nullptr;
    int w = 0, h = 0;
    io.Fonts->GetTexDataAsRGBA32(&px, &w, &h);
    if (!fontTex_) XPLMGenerateTextureNumbers(&fontTex_, 1);
    XPLMBindTexture2d(fontTex_, 0);
    glx::load();
    glPushClientAttrib(GL_CLIENT_PIXEL_STORE_BIT);
    GLint unpackBuf = 0;
    if (glx::bindBuffer) { glGetIntegerv(GL_PIXEL_UNPACK_BUFFER_BINDING, &unpackBuf); if (unpackBuf) glx::bindBuffer(GL_PIXEL_UNPACK_BUFFER, 0); }
    glPixelStorei(GL_UNPACK_ALIGNMENT, 4);
    glPixelStorei(GL_UNPACK_ROW_LENGTH, 0);
    glPixelStorei(GL_UNPACK_SKIP_ROWS, 0);
    glPixelStorei(GL_UNPACK_SKIP_PIXELS, 0);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, w, h, 0, GL_RGBA, GL_UNSIGNED_BYTE, px);
    if (unpackBuf) glx::bindBuffer(GL_PIXEL_UNPACK_BUFFER, (GLuint)unpackBuf);
    glPopClientAttrib();
    io.Fonts->SetTexID((ImTextureID)(intptr_t)fontTex_);
    io.Fonts->ClearTexData();
    io.FontGlobalScale = 1.0f / fontScale_;
    fontsDirty_ = false;
}

void XPImGuiWindow::mouseAt(int x, int y) {
    int l, t, r, b;
    XPLMGetWindowGeometry(win_, &l, &t, &r, &b);
    ImGui::GetIO().AddMousePosEvent((float)(x - l), (float)(t - y));
}

void XPImGuiWindow::draw() {
    ImGuiContext* prev = ImGui::GetCurrentContext();
    ImGui::SetCurrentContext(ctx_);
    ImGuiIO& io = ImGui::GetIO();
    if (fontsDirty_ || uiScale() != fontScale_) rebuildFonts();

    int l, t, r, b;
    XPLMGetWindowGeometry(win_, &l, &t, &r, &b);
    io.DisplaySize = ImVec2((float)(r > l ? r - l : 0), (float)(t > b ? t - b : 0));
    io.DisplayFramebufferScale = ImVec2(1.0f, 1.0f);
    float now = XPLMGetElapsedTime();
    io.DeltaTime = (lastTime_ > 0.0f && now > lastTime_) ? (now - lastTime_) : (1.0f / 60.0f);
    if (io.DeltaTime > 1.0f) io.DeltaTime = 1.0f / 60.0f;
    lastTime_ = now;

    // mouse left the (in-sim) window: stop hover effects
    if (!isPoppedOut() && !isInVR()) {
        int mx, my;
        XPLMGetMouseLocationGlobal(&mx, &my);
        if (mx < l || mx > r || my < b || my > t) io.AddMousePosEvent(-FLT_MAX, -FLT_MAX);
    }

    ImGui::NewFrame();
    const bool dropped = dropFocus_;
    if (dropFocus_) { ImGui::ClearActiveID(); dropFocus_ = false; }
    ImGuiErrorRecoveryState recover;
    ImGui::ErrorRecoveryStoreState(&recover);
    try {
        ImGui::SetNextWindowPos(ImVec2(0, 0));
        ImGui::SetNextWindowSize(io.DisplaySize);
        ImGui::Begin("##xpfc-root", nullptr, ImGuiWindowFlags_NoTitleBar | ImGuiWindowFlags_NoResize | ImGuiWindowFlags_NoMove |
                     ImGuiWindowFlags_NoCollapse | ImGuiWindowFlags_NoSavedSettings | ImGuiWindowFlags_NoBringToFrontOnFocus |
                     ImGuiWindowFlags_NoScrollbar | ImGuiWindowFlags_NoScrollWithMouse);
        buildInterface();
        ImGui::End();
    } catch (const std::exception& e) {
        ImGui::ErrorRecoveryTryToRecoverState(&recover);
        xpfcImGuiAssert(e.what(), "interface", 0);
    } catch (...) {
        ImGui::ErrorRecoveryTryToRecoverState(&recover);
        xpfcImGuiAssert("unknown exception", "interface", 0);
    }
    ImGui::Render();
    renderDrawData(ImGui::GetDrawData(), l, t);

    // keyboard: only while a text field is being edited, so X-Plane keeps its key bindings otherwise
    bool want = io.WantTextInput && !dropped, has = XPLMHasKeyboardFocus(win_) != 0;
    if (want && !has) XPLMTakeKeyboardFocus(win_);
    else if (!want && has) releaseKeyboard();
    if (prev && prev != ctx_) ImGui::SetCurrentContext(prev);
}

void XPImGuiWindow::renderDrawData(ImDrawData* dd, int left, int top) {
    if (!dd || dd->CmdListsCount == 0) return;
    glx::load();
    float mv[16], pj[16];
    int vp[4];
    currentMatrices(mv, pj, vp);

    XPLMSetGraphicsState(0, 1, 0, 0, 1, 0, 0);
    GLint program = 0, vao = 0;
    if (glx::useProgram) { glGetIntegerv(GL_CURRENT_PROGRAM, &program); if (program) glx::useProgram(0); }
    if (glx::bindVertexArray) { glGetIntegerv(GL_VERTEX_ARRAY_BINDING, &vao); if (vao) glx::bindVertexArray(0); }
    glPushClientAttrib(GL_CLIENT_ALL_ATTRIB_BITS);
    glPushAttrib(GL_ENABLE_BIT | GL_COLOR_BUFFER_BIT | GL_TRANSFORM_BIT | GL_SCISSOR_BIT | GL_TEXTURE_BIT | GL_CURRENT_BIT | GL_POLYGON_BIT);
    if (glx::bindBuffer) { glx::bindBuffer(GL_ARRAY_BUFFER, 0); glx::bindBuffer(GL_ELEMENT_ARRAY_BUFFER, 0); }
    if (glx::clientActiveTexture) glx::clientActiveTexture(GL_TEXTURE0);
    glEnable(GL_BLEND);
    glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
    glDisable(GL_CULL_FACE);
    glDisable(GL_DEPTH_TEST);
    glDisable(GL_LIGHTING);
    glDisable(GL_ALPHA_TEST);
    glPolygonMode(GL_FRONT_AND_BACK, GL_FILL);
    glEnable(GL_SCISSOR_TEST);
    glEnable(GL_TEXTURE_2D);
    glTexEnvi(GL_TEXTURE_ENV, GL_TEXTURE_ENV_MODE, GL_MODULATE);
    glDisableClientState(GL_NORMAL_ARRAY);
    glEnableClientState(GL_VERTEX_ARRAY);
    glEnableClientState(GL_TEXTURE_COORD_ARRAY);
    glEnableClientState(GL_COLOR_ARRAY);

    glMatrixMode(GL_MODELVIEW);
    glPushMatrix();
    glTranslatef((GLfloat)left, (GLfloat)top, 0.0f);
    glScalef(1.0f, -1.0f, 1.0f);

    for (int n = 0; n < dd->CmdListsCount; n++) {
        const ImDrawList* cl = dd->CmdLists[n];
        const ImDrawVert* vtx = cl->VtxBuffer.Data;
        const ImDrawIdx* idx = cl->IdxBuffer.Data;
        glVertexPointer(2, GL_FLOAT, sizeof(ImDrawVert), (const GLvoid*)((const char*)vtx + offsetof(ImDrawVert, pos)));
        glTexCoordPointer(2, GL_FLOAT, sizeof(ImDrawVert), (const GLvoid*)((const char*)vtx + offsetof(ImDrawVert, uv)));
        glColorPointer(4, GL_UNSIGNED_BYTE, sizeof(ImDrawVert), (const GLvoid*)((const char*)vtx + offsetof(ImDrawVert, col)));
        for (int c = 0; c < cl->CmdBuffer.Size; c++) {
            const ImDrawCmd* cmd = &cl->CmdBuffer[c];
            if (cmd->UserCallback) {
                if (cmd->UserCallback != ImDrawCallback_ResetRenderState) cmd->UserCallback(cl, cmd);
                continue;
            }
            if (cmd->ElemCount == 0) continue;
            // clip rectangle: ImGui (top-left origin) → boxels → window pixels
            float x1, y1, x2, y2;
            boxelToPixel(left + cmd->ClipRect.x, top - cmd->ClipRect.w, mv, pj, vp, x1, y1);
            boxelToPixel(left + cmd->ClipRect.z, top - cmd->ClipRect.y, mv, pj, vp, x2, y2);
            if (x2 <= x1 || y2 <= y1) continue;
            glScissor((GLint)(x1 + 0.5f), (GLint)(y1 + 0.5f), (GLsizei)(x2 - x1 + 0.5f), (GLsizei)(y2 - y1 + 0.5f));
            XPLMBindTexture2d((int)(intptr_t)cmd->GetTexID(), 0);
            glDrawElements(GL_TRIANGLES, (GLsizei)cmd->ElemCount, sizeof(ImDrawIdx) == 2 ? GL_UNSIGNED_SHORT : GL_UNSIGNED_INT, idx + cmd->IdxOffset);
        }
    }
    glPopMatrix();
    glPopAttrib();
    glPopClientAttrib();
    if (vao) glx::bindVertexArray((GLuint)vao);
    if (program) glx::useProgram((GLuint)program);
}

// ------------------------------------------------------------------ XPLM callbacks
void XPImGuiWindow::drawCB(XPLMWindowID, void* ref) { static_cast<XPImGuiWindow*>(ref)->draw(); }

int XPImGuiWindow::clickCB(XPLMWindowID, int x, int y, XPLMMouseStatus status, void* ref) {
    auto* w = static_cast<XPImGuiWindow*>(ref);
    ImGuiContext* prev = ImGui::GetCurrentContext();
    ImGui::SetCurrentContext(w->ctx_);
    w->mouseAt(x, y);
    if (status == xplm_MouseDown) ImGui::GetIO().AddMouseButtonEvent(0, true);
    else if (status == xplm_MouseUp) ImGui::GetIO().AddMouseButtonEvent(0, false);
    if (prev && prev != w->ctx_) ImGui::SetCurrentContext(prev);
    return 1;
}

int XPImGuiWindow::rightClickCB(XPLMWindowID, int x, int y, XPLMMouseStatus status, void* ref) {
    auto* w = static_cast<XPImGuiWindow*>(ref);
    ImGuiContext* prev = ImGui::GetCurrentContext();
    ImGui::SetCurrentContext(w->ctx_);
    w->mouseAt(x, y);
    if (status == xplm_MouseDown) ImGui::GetIO().AddMouseButtonEvent(1, true);
    else if (status == xplm_MouseUp) ImGui::GetIO().AddMouseButtonEvent(1, false);
    if (prev && prev != w->ctx_) ImGui::SetCurrentContext(prev);
    return 1;
}

int XPImGuiWindow::wheelCB(XPLMWindowID, int x, int y, int wheel, int clicks, void* ref) {
    auto* w = static_cast<XPImGuiWindow*>(ref);
    ImGuiContext* prev = ImGui::GetCurrentContext();
    ImGui::SetCurrentContext(w->ctx_);
    w->mouseAt(x, y);
    if (wheel == 0) ImGui::GetIO().AddMouseWheelEvent(0.0f, (float)clicks);
    else ImGui::GetIO().AddMouseWheelEvent(-(float)clicks, 0.0f);    // X-Plane: positive = right; ImGui: positive = left
    if (prev && prev != w->ctx_) ImGui::SetCurrentContext(prev);
    return 1;
}

XPLMCursorStatus XPImGuiWindow::cursorCB(XPLMWindowID, int x, int y, void* ref) {
    auto* w = static_cast<XPImGuiWindow*>(ref);
    ImGuiContext* prev = ImGui::GetCurrentContext();
    ImGui::SetCurrentContext(w->ctx_);
    w->mouseAt(x, y);
    if (prev && prev != w->ctx_) ImGui::SetCurrentContext(prev);
    return xplm_CursorDefault;
}

void XPImGuiWindow::keyCB(XPLMWindowID, char key, XPLMKeyFlags flags, char vkey, void* ref, int losingFocus) {
    auto* w = static_cast<XPImGuiWindow*>(ref);
    if (losingFocus) {
        // someone else took the keyboard while a field was being edited: stop editing, don't grab it back
        if (!w->selfRelease_ && w->ctx_ && w->ctx_->IO.WantTextInput) w->dropFocus_ = true;
        return;
    }
    ImGuiContext* prev = ImGui::GetCurrentContext();
    ImGui::SetCurrentContext(w->ctx_);
    ImGuiIO& io = ImGui::GetIO();
    const bool down = (flags & xplm_DownFlag) != 0, up = (flags & xplm_UpFlag) != 0;
    const bool ctrl = (flags & xplm_ControlFlag) != 0;
    io.AddKeyEvent(ImGuiMod_Shift, (flags & xplm_ShiftFlag) != 0);
    io.AddKeyEvent(ImGuiMod_Ctrl, ctrl);
    io.AddKeyEvent(ImGuiMod_Alt, (flags & xplm_OptionAltFlag) != 0);
    ImGuiKey k = mapKey((unsigned char)vkey);
    if (k != ImGuiKey_None) {
        if (down) io.AddKeyEvent(k, true);
        if (up) io.AddKeyEvent(k, false);
        if (down && !up && (k == ImGuiKey_Backspace || k == ImGuiKey_Delete || k == ImGuiKey_Enter || k == ImGuiKey_KeypadEnter || k == ImGuiKey_Tab ||
                            k == ImGuiKey_LeftArrow || k == ImGuiKey_RightArrow || k == ImGuiKey_Home || k == ImGuiKey_End || k == ImGuiKey_Escape))
            io.AddKeyEvent(k, false);   // X-Plane sends no key-up for repeats; release so repeats register
    }
    unsigned char ch = (unsigned char)key;
    if (down && !ctrl && ch >= 32 && ch != 127) io.AddInputCharacter(ch);
    if (prev && prev != w->ctx_) ImGui::SetCurrentContext(prev);
}
