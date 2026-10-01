// XP Flight Computer — the in-sim window: Calculators, Performance and Settings tabs.
#pragma once
#include "jshost.h"
#include "xpimgui.h"
#include "nlohmann/json.hpp"
#include <functional>
#include <map>
#include <string>

class FlightComputerWindow : public XPImGuiWindow {
public:
    enum Tab { TabCalc = 0, TabPerf = 1, TabSettings = 2 };
    FlightComputerWindow(JsHost& js, const std::string& fontDir, int l, int t, int r, int b);
    /** Show the window on a tab (from the menu or a command). */
    void showTab(Tab tab);
    /** New data from X-Plane arrived. */
    void liveChanged() { liveTick_++; }
    /** Error to show instead of the interface (e.g. the scripts did not load). */
    void setFatal(const std::string& msg) { fatal_ = msg; }

protected:
    void buildInterface() override;
    void buildFonts(ImFontAtlas* atlas, float scale) override;

private:
    using json = nlohmann::json;
    using Setter = std::function<void(const std::string& k, const std::string& v)>;

    json callJson(const char* fn, std::initializer_list<std::string> args = {});
    void refresh(double now);
    void drawTopBar();
    void drawCalculators();
    void drawPerformance();
    void drawSettings();
    void drawPanelHead(const json& v);
    void drawFields(const json& fields, const std::string& scope, const Setter& set);
    void drawField(const json& f, const std::string& scope, const Setter& set, float width);
    void drawOutputs(const json& v);
    void drawResults(const json& results);
    void drawBars(const json& bars);
    void drawTables(const json& tables);
    void drawChart(const json& chart);
    void drawSteps(const json& steps);
    void drawNotes(const json& notes);
    void wrappedMuted(const std::string& s);

    struct EditBuf { char buf[1024] = {0}; bool editing = false; std::string model; };

    JsHost& js_;
    std::string fontDir_;
    std::string fatal_;
    ImFont* fRegular_ = nullptr;
    ImFont* fBold_ = nullptr;
    ImFont* fBig_ = nullptr;
    ImFont* fSmall_ = nullptr;
    float fontSize_ = 16.0f;

    int tab_ = TabCalc;
    int wantTab_ = -1;
    std::string calcId_ = "wind-triangle";
    std::string perfTab_ = "load";
    bool perfTabShown_ = false;
    json list_, calcView_, perfView_, status_, settings_;
    bool calcDirty_ = true, perfDirty_ = true, listDirty_ = true;
    double calcAt_ = -10, perfAt_ = -10, statusAt_ = -10;
    unsigned liveTick_ = 0, calcTick_ = 0, perfTick_ = 0;
    char search_[64] = {0};
    std::map<std::string, EditBuf> edits_;
    int pendingFont_ = 0;
};
