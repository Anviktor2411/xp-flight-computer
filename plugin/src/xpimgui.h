// XP Flight Computer — a Dear ImGui window inside X-Plane (XPLM 3.01 modern windows, X-Plane 11.20 and later).
// Handles mouse, wheel and keyboard input, draws ImGui's triangles with fixed-function OpenGL in X-Plane's
// window coordinates (boxels), and supports popping out into an OS window and moving into VR.
#pragma once
#include "XPLMDisplay.h"
#include "imgui.h"
#include <string>

class XPImGuiWindow {
public:
    XPImGuiWindow(int left, int top, int right, int bottom, const char* title);
    virtual ~XPImGuiWindow();
    XPImGuiWindow(const XPImGuiWindow&) = delete;
    XPImGuiWindow& operator=(const XPImGuiWindow&) = delete;

    void setVisible(bool v);
    bool isVisible() const;
    void popOut();
    void popIn();
    void moveToVR();
    bool isPoppedOut() const;
    bool isInVR() const;
    bool vrAvailable() const;
    void resetPosition();
    void getGeometry(int& l, int& t, int& r, int& b) const;
    XPLMWindowID id() const { return win_; }

    /** Fonts are rebuilt on the next frame (e.g. after the size setting changed). */
    void requestFontRebuild() { fontsDirty_ = true; }

protected:
    /** Build the whole interface; called inside a full-window ImGui::Begin/End. */
    virtual void buildInterface() = 0;
    /** Add fonts to the atlas; called whenever the atlas is rebuilt. scale = pixels per boxel. */
    virtual void buildFonts(ImFontAtlas* atlas, float scale) = 0;
    ImGuiContext* ctx_ = nullptr;

private:
    static void drawCB(XPLMWindowID, void* ref);
    static int clickCB(XPLMWindowID, int x, int y, XPLMMouseStatus status, void* ref);
    static int rightClickCB(XPLMWindowID, int x, int y, XPLMMouseStatus status, void* ref);
    static int wheelCB(XPLMWindowID, int x, int y, int wheel, int clicks, void* ref);
    static XPLMCursorStatus cursorCB(XPLMWindowID, int x, int y, void* ref);
    static void keyCB(XPLMWindowID, char key, XPLMKeyFlags flags, char vkey, void* ref, int losingFocus);

    void draw();
    void releaseKeyboard();
    void mouseAt(int x, int y);
    void rebuildFonts();
    void renderDrawData(ImDrawData* dd, int left, int top);
    float uiScale() const;

    XPLMWindowID win_ = nullptr;
    int fontTex_ = 0;
    bool fontsDirty_ = true;
    bool dropFocus_ = false;
    bool selfRelease_ = false;
    float fontScale_ = 1.0f;
    float lastTime_ = 0.0f;
    int homeL_, homeT_, homeR_, homeB_;
};
