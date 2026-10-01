// XP Flight Computer — Dear ImGui build settings (included by imgui.h through IMGUI_USER_CONFIG).
#pragma once

// A failed ImGui check must never abort X-Plane. In the release build it is written to Log.txt once and the
// frame carries on; the test build (XPFC_ABORT_ON_ASSERT) stops so the problem is found before release.
void xpfcImGuiAssert(const char* expr, const char* file, int line);
#define IM_ASSERT(_EXPR) do { if (!(_EXPR)) xpfcImGuiAssert(#_EXPR, __FILE__, __LINE__); } while (0)

// No need for ImGui's own Windows IME and shell helpers inside X-Plane.
#define IMGUI_DISABLE_WIN32_DEFAULT_IME_FUNCTIONS
#define IMGUI_DISABLE_DEFAULT_SHELL_FUNCTIONS
