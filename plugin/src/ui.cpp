// XP Flight Computer — the in-sim window. Every number comes from the JavaScript host (xphost.js), which
// runs the same calculation code as the web app; this file only lays the view models out with Dear ImGui.
#include "ui.h"
#include "XPLMProcessing.h"
#include "imgui_internal.h"
#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <vector>
#include "files.h"

namespace {
// Colours follow the app's dark theme: magenta = computed, cyan = typed / selected, green = live from X-Plane.
ImVec4 hex(unsigned rgb, float a = 1.0f) { return ImVec4(((rgb >> 16) & 255) / 255.0f, ((rgb >> 8) & 255) / 255.0f, (rgb & 255) / 255.0f, a); }
const ImVec4 C_BG = hex(0x111820), C_SURF2 = hex(0x17212B), C_LINE = hex(0x22303B), C_LINE2 = hex(0x34444F);
const ImVec4 C_TEXT = hex(0xE3EBF0), C_MUTED = hex(0x8FA1AD), C_FAINT = hex(0x5E707B);
const ImVec4 C_ACC = hex(0xE46BD2), C_SEL = hex(0x4FC6EA), C_LIVE = hex(0x58D489), C_WARN = hex(0xF0B340), C_BAD = hex(0xF26A5F), C_FIG = hex(0xC7D4DC);

ImVec4 toneColor(const std::string& t) {
    if (t == "ok" || t == "live") return C_LIVE;
    if (t == "warn") return C_WARN;
    if (t == "bad") return C_BAD;
    if (t == "sel") return C_SEL;
    if (t == "line") return C_FIG;
    return C_ACC;
}
ImVec4 toneBg(const std::string& t) {
    ImVec4 c = t.empty() ? C_ACC : toneColor(t);
    return ImVec4(c.x, c.y, c.z, t.empty() ? 0.10f : 0.13f);
}
// The view models come from JavaScript. Read them without ever throwing: a NaN arrives as null, and an
// exception here would unwind into X-Plane.
std::string S(const nlohmann::json& j) {
    if (j.is_string()) return j.get_ref<const std::string&>();
    if (j.is_null()) return std::string();
    if (j.is_number_integer()) return std::to_string(j.get<long long>());
    if (j.is_number()) { char b[40]; std::snprintf(b, sizeof b, "%g", j.get<double>()); return b; }
    if (j.is_boolean()) return j.get<bool>() ? "true" : "false";
    return j.dump(-1, ' ', false, nlohmann::json::error_handler_t::replace);
}
double D(const nlohmann::json& j, double def) { return j.is_number() ? j.get<double>() : def; }
double D(const nlohmann::json& j, const char* k, double def) {
    if (!j.is_object()) return def;
    auto it = j.find(k);
    return (it != j.end() && it->is_number()) ? it->get<double>() : def;
}
std::string str(const nlohmann::json& j, const char* k, const char* def = "") {
    if (!j.is_object()) return def;
    auto it = j.find(k);
    if (it == j.end() || it->is_null()) return def;
    return S(*it);
}
bool isPoint(const nlohmann::json& p) { return p.is_array() && p.size() >= 3 && p[0].is_number() && p[1].is_number() && p[2].is_number(); }
// numbers: digits, sign and either decimal mark (the calculators read 1013,2 as 1013.2)
int numberFilter(ImGuiInputTextCallbackData* d) {
    const ImWchar c = d->EventChar;
    return ((c >= '0' && c <= '9') || c == '.' || c == ',' || c == '-' || c == '+') ? 0 : 1;
}
bool flag(const nlohmann::json& j, const char* k) {
    if (!j.is_object()) return false;
    auto it = j.find(k);
    return it != j.end() && it->is_boolean() && it->get<bool>();
}
const nlohmann::json& arr(const nlohmann::json& j, const char* k) {
    static const nlohmann::json empty = nlohmann::json::array();
    if (!j.is_object()) return empty;
    auto it = j.find(k);
    return (it != j.end() && it->is_array()) ? *it : empty;
}

// glyphs: Latin, Greek, punctuation, super/subscripts, and the few arrows, maths signs and ticks the texts use
// (fewer glyphs = the font atlas builds quickly when the window opens or the text size changes)
const ImWchar kRanges[] = {
    0x0020, 0x017F, 0x0370, 0x03FF, 0x1D62, 0x1D65, 0x2000, 0x209F, 0x2150, 0x215F,
    0x2190, 0x2199, 0x21C4, 0x21C4, 0x21D2, 0x21D2,
    0x2202, 0x2202, 0x2206, 0x2206, 0x2211, 0x2212, 0x2218, 0x221A, 0x221D, 0x221E, 0x2248, 0x2248, 0x2260, 0x2260,
    0x2264, 0x2265, 0x22C5, 0x22C5, 0x22EF, 0x22EF, 0x2713, 0x2713, 0x2717, 0x2717, 0,
};
}  // namespace

FlightComputerWindow::FlightComputerWindow(JsHost& js, const std::string& fontDir, int l, int t, int r, int b)
    : XPImGuiWindow(l, t, r, b, "XP Flight Computer"), js_(js), fontDir_(fontDir) {
    ImGuiContext* prev = ImGui::GetCurrentContext();
    ImGui::SetCurrentContext(ctx_);
    ImGuiStyle& s = ImGui::GetStyle();
    ImGui::StyleColorsDark(&s);
    s.WindowPadding = ImVec2(12, 10);
    s.FramePadding = ImVec2(8, 5);
    s.ItemSpacing = ImVec2(8, 7);
    s.CellPadding = ImVec2(8, 6);
    s.FrameRounding = 6; s.ChildRounding = 8; s.PopupRounding = 6; s.TabRounding = 6; s.GrabRounding = 6; s.ScrollbarRounding = 8;
    s.WindowRounding = 0; s.WindowBorderSize = 0; s.ChildBorderSize = 1; s.FrameBorderSize = 1; s.TabBorderSize = 0;
    s.ScrollbarSize = 12;
    ImVec4* c = s.Colors;
    c[ImGuiCol_WindowBg] = C_BG;
    c[ImGuiCol_ChildBg] = ImVec4(0, 0, 0, 0);
    c[ImGuiCol_PopupBg] = C_SURF2;
    c[ImGuiCol_Border] = C_LINE;
    c[ImGuiCol_Text] = C_TEXT;
    c[ImGuiCol_TextDisabled] = C_MUTED;
    c[ImGuiCol_FrameBg] = C_SURF2;
    c[ImGuiCol_FrameBgHovered] = hex(0x1D2A36);
    c[ImGuiCol_FrameBgActive] = hex(0x22313F);
    c[ImGuiCol_TitleBg] = C_BG; c[ImGuiCol_TitleBgActive] = C_BG;
    c[ImGuiCol_Button] = C_SURF2;
    c[ImGuiCol_ButtonHovered] = hex(0x223140);
    c[ImGuiCol_ButtonActive] = hex(0x2A3B4C);
    c[ImGuiCol_Header] = hex(0x4FC6EA, 0.16f);
    c[ImGuiCol_HeaderHovered] = hex(0x4FC6EA, 0.24f);
    c[ImGuiCol_HeaderActive] = hex(0x4FC6EA, 0.32f);
    c[ImGuiCol_Tab] = C_BG;
    c[ImGuiCol_TabHovered] = hex(0x223140);
    c[ImGuiCol_TabSelected] = C_SURF2;
    c[ImGuiCol_TabSelectedOverline] = C_ACC;
    c[ImGuiCol_TabDimmed] = C_BG;
    c[ImGuiCol_TabDimmedSelected] = C_SURF2;
    c[ImGuiCol_Separator] = C_LINE;
    c[ImGuiCol_CheckMark] = C_SEL;
    c[ImGuiCol_SliderGrab] = C_SEL;
    c[ImGuiCol_SliderGrabActive] = C_SEL;
    c[ImGuiCol_PlotHistogram] = C_LIVE;
    c[ImGuiCol_TableHeaderBg] = C_SURF2;
    c[ImGuiCol_TableBorderLight] = C_LINE;
    c[ImGuiCol_TableBorderStrong] = C_LINE2;
    c[ImGuiCol_TableRowBgAlt] = ImVec4(1, 1, 1, 0.02f);
    c[ImGuiCol_ScrollbarBg] = ImVec4(0, 0, 0, 0);
    c[ImGuiCol_ScrollbarGrab] = C_LINE2;
    c[ImGuiCol_NavCursor] = C_SEL;
    c[ImGuiCol_TextSelectedBg] = hex(0x4FC6EA, 0.35f);
    if (prev) ImGui::SetCurrentContext(prev);
}

void FlightComputerWindow::buildFonts(ImFontAtlas* atlas, float scale) {
    settings_ = callJson("settings");
    if (settings_.is_object() && settings_.contains("fontSize") && settings_["fontSize"].is_number()) fontSize_ = settings_["fontSize"].get<float>();
    const std::string reg = fontDir_ + "B612-Regular.ttf", bold = fontDir_ + "B612-Bold.ttf";
    const std::string dv = fontDir_ + "DejaVuSans.ttf", dvb = fontDir_ + "DejaVuSans-Bold.ttf";
    auto add = [&](const std::string& main, const std::string& fallback, float px) -> ImFont* {
        ImFontConfig cfg;
        cfg.OversampleH = 2; cfg.OversampleV = 1;
        ImFont* f = nullptr;
        if (xpfc::fileExists(main)) f = atlas->AddFontFromFileTTF(main.c_str(), px * scale, &cfg, kRanges);
        if (xpfc::fileExists(fallback)) {
            ImFontConfig m = cfg;
            m.MergeMode = f != nullptr;
            ImFont* g = atlas->AddFontFromFileTTF(fallback.c_str(), px * scale, &m, kRanges);
            if (!f) f = g;
        }
        if (!f) { ImFontConfig d; d.SizePixels = px * scale; f = atlas->AddFontDefault(&d); }
        return f;
    };
    fRegular_ = add(reg, dv, fontSize_);
    fBold_ = add(bold, dvb, fontSize_);
    fBig_ = add(bold, dvb, std::round(fontSize_ * 1.5f));
    fSmall_ = add(reg, dv, std::round(fontSize_ * 0.84f));
}

FlightComputerWindow::json FlightComputerWindow::callJson(const char* fn, std::initializer_list<std::string> args) {
    std::string s = js_.call(fn, args);
    if (s.empty()) return json();
    json j = json::parse(s, nullptr, false);
    return j.is_discarded() ? json() : j;
}

void FlightComputerWindow::showTab(Tab tab) {
    wantTab_ = tab;
    setVisible(true);
}

void FlightComputerWindow::refresh(double now) {
    if (now - statusAt_ > 0.5) { status_ = callJson("status"); statusAt_ = now; }
    if (listDirty_) { list_ = callJson("calcList"); listDirty_ = false; }
    if (tab_ == TabCalc) {
        bool follow = flag(calcView_, "follow");
        if (calcDirty_ || (follow && calcTick_ != liveTick_ && now - calcAt_ > 0.4)) {
            calcView_ = callJson("calcView", {calcId_});
            calcDirty_ = false; calcAt_ = now; calcTick_ = liveTick_;
        }
    } else if (tab_ == TabPerf) {
        if (perfDirty_ || (perfTick_ != liveTick_ && now - perfAt_ > 1.0)) {
            perfView_ = callJson("perfView", {perfTab_});
            perfDirty_ = false; perfAt_ = now; perfTick_ = liveTick_;
        }
    }
}

// =================================================================== the window
void FlightComputerWindow::buildInterface() {
    ImGui::PushFont(fRegular_);
    if (!fatal_.empty() || !js_.ok()) {
        ImGui::TextColored(C_BAD, "XP Flight Computer could not start.");
        ImGui::PushTextWrapPos(0);
        ImGui::TextUnformatted(fatal_.empty() ? js_.error().c_str() : fatal_.c_str());
        ImGui::PopTextWrapPos();
        ImGui::TextColored(C_MUTED, "Check that the js and fonts folders are next to the 64 folder in Resources/plugins/XPFlightComputer.");
        ImGui::PopFont();
        return;
    }
    refresh(XPLMGetElapsedTime());
    drawTopBar();
    if (ImGui::BeginTabBar("##main", ImGuiTabBarFlags_NoTooltip)) {
        const char* names[] = {"Calculators", "Performance", "Settings"};
        for (int i = 0; i < 3; i++) {
            ImGuiTabItemFlags fl = (wantTab_ == i) ? ImGuiTabItemFlags_SetSelected : 0;
            if (ImGui::BeginTabItem(names[i], nullptr, fl)) {
                if (tab_ != i) { tab_ = i; calcDirty_ = perfDirty_ = true; refresh(XPLMGetElapsedTime()); }
                if (i == TabCalc) drawCalculators();
                else if (i == TabPerf) drawPerformance();
                else {
                    ImGui::BeginChild("##settings", ImVec2(0, 0), ImGuiChildFlags_None, ImGuiWindowFlags_None);
                    drawSettings();
                    ImGui::EndChild();
                }
                ImGui::EndTabItem();
            }
        }
        wantTab_ = -1;
        ImGui::EndTabBar();
    }
    ImGui::PopFont();
    if (pendingFont_ && !ImGui::IsMouseDown(0)) { pendingFont_ = 0; requestFontRebuild(); }
}

void FlightComputerWindow::drawTopBar() {
    const bool live = flag(status_, "live");
    ImDrawList* dl = ImGui::GetWindowDrawList();
    ImVec2 p = ImGui::GetCursorScreenPos();
    const float h = ImGui::GetTextLineHeight();
    dl->AddCircleFilled(ImVec2(p.x + 5, p.y + h * 0.5f), 4.5f, ImGui::GetColorU32(live ? C_LIVE : C_FAINT));
    ImGui::Dummy(ImVec2(14, h));
    ImGui::SameLine();
    std::string ac = str(status_, "aircraft");
    if (live && !ac.empty()) {
        ImGui::PushFont(fBold_);
        ImGui::TextUnformatted(ac.c_str());
        ImGui::PopFont();
        std::string extra;
        if (!str(status_, "icao").empty()) extra += str(status_, "icao") + " · ";
        extra += str(status_, "label");
        if (!str(status_, "phase").empty()) extra += " · " + str(status_, "phase");
        ImGui::SameLine();
        ImGui::TextColored(C_MUTED, "%s", extra.c_str());
    } else {
        ImGui::TextColored(C_MUTED, "Waiting for X-Plane data — the calculators work without it.");
    }
    const auto& items = arr(status_, "items");
    std::vector<std::pair<std::string, std::string>> its;
    const float gapW = 16.0f, inner = 5.0f;
    float total = 0;
    for (const auto& it : items) {
        if (!it.is_array() || it.size() < 2) continue;
        its.emplace_back(S(it[0]), S(it[1]));
        total += ImGui::CalcTextSize(its.back().first.c_str()).x + inner + ImGui::CalcTextSize(its.back().second.c_str()).x;
    }
    if (its.empty()) return;
    total += gapW * (float)(its.size() - 1);
    ImGui::SameLine();
    const float avail = ImGui::GetContentRegionAvail().x, right = ImGui::GetCursorPosX() + avail;
    if (total + 24.0f <= avail) ImGui::SetCursorPosX(right - total);
    else ImGui::NewLine();
    bool first = true;
    for (const auto& [label, value] : its) {
        const float w = ImGui::CalcTextSize(label.c_str()).x + inner + ImGui::CalcTextSize(value.c_str()).x;
        if (!first) {
            ImGui::SameLine(0, gapW);
            if (ImGui::GetCursorPosX() + w > right) ImGui::NewLine();
        }
        ImGui::TextColored(C_MUTED, "%s", label.c_str());
        ImGui::SameLine(0, inner);
        ImGui::TextColored(C_LIVE, "%s", value.c_str());
        first = false;
    }
}

// =================================================================== calculators
void FlightComputerWindow::drawCalculators() {
    const float avail = ImGui::GetContentRegionAvail().x;
    const bool narrow = avail < 760.0f;
    auto select = [&](const std::string& id) { if (id != calcId_) { calcId_ = id; calcDirty_ = true; } };
    if (!narrow) {
        const float listW = std::min(300.0f, std::max(220.0f, avail * 0.27f));
        ImGui::BeginChild("##calclist", ImVec2(listW, 0), ImGuiChildFlags_Borders);
        ImGui::SetNextItemWidth(-FLT_MIN);
        const bool enter = ImGui::InputTextWithHint("##search", "Search calculators…", search_, sizeof search_, ImGuiInputTextFlags_EnterReturnsTrue);
        std::string q = search_;
        std::transform(q.begin(), q.end(), q.begin(), [](unsigned char ch) { return (char)std::tolower(ch); });
        // every typed word must appear somewhere, in any order ("cas mach" finds the airspeed converter)
        std::vector<std::string> words;
        for (size_t i = 0; i < q.size();) {
            size_t j = q.find(' ', i);
            if (j == std::string::npos) j = q.size();
            if (j > i) words.push_back(q.substr(i, j - i));
            i = j + 1;
        }
        auto matches = [&](const json& it) {
            const std::string hay = str(it, "search");
            for (const auto& w : words) if (hay.find(w) == std::string::npos) return false;
            return true;
        };
        if (enter && !words.empty() && list_.is_array()) {          // Enter opens the best match: by title first
            std::string best, any;
            for (const auto& g : list_)
                for (const auto& it : arr(g, "items")) {
                    if (!matches(it)) continue;
                    std::string t = str(it, "title");
                    std::transform(t.begin(), t.end(), t.begin(), [](unsigned char ch) { return (char)std::tolower(ch); });
                    bool inTitle = true;
                    for (const auto& w : words) if (t.find(w) == std::string::npos) { inTitle = false; break; }
                    if (inTitle && best.empty()) best = str(it, "id");
                    if (any.empty()) any = str(it, "id");
                }
            if (!best.empty() || !any.empty()) select(best.empty() ? any : best);
        }
        if (list_.is_array()) for (const auto& g : list_) {
            bool header = false;
            for (const auto& it : arr(g, "items")) {
                if (!words.empty() && !matches(it)) continue;
                if (!header) {
                    ImGui::Dummy(ImVec2(0, 2));
                    ImGui::PushFont(fSmall_);
                    ImGui::TextColored(C_MUTED, "%s", str(g, "group").c_str());
                    ImGui::PopFont();
                    header = true;
                }
                const std::string id = str(it, "id"), title = str(it, "title");
                if (ImGui::Selectable((title + "##" + id).c_str(), id == calcId_)) select(id);
                if (ImGui::IsItemHovered() && ImGui::CalcTextSize(title.c_str()).x > ImGui::GetItemRectSize().x - 4) ImGui::SetTooltip("%s", title.c_str());
            }
        }
        ImGui::EndChild();
        ImGui::SameLine();
    } else {
        std::string cur = str(calcView_, "title");
        ImGui::SetNextItemWidth(-FLT_MIN);
        if (ImGui::BeginCombo("##calccombo", cur.c_str(), ImGuiComboFlags_HeightLarge)) {
            if (list_.is_array()) for (const auto& g : list_) {
                ImGui::TextColored(C_MUTED, "%s", str(g, "group").c_str());
                for (const auto& it : arr(g, "items")) {
                    std::string id = str(it, "id");
                    if (ImGui::Selectable(("   " + str(it, "title") + "##" + id).c_str(), id == calcId_)) select(id);
                }
            }
            ImGui::EndCombo();
        }
    }
    ImGui::BeginChild("##calcpanel", ImVec2(0, 0));
    const json& v = calcView_;
    if (!v.is_object()) { ImGui::TextColored(C_BAD, "%s", js_.lastCallError().c_str()); ImGui::EndChild(); return; }
    drawPanelHead(v);
    const std::string id = str(v, "id");
    if (flag(v, "hasLive")) {
        bool follow = flag(v, "follow");
        if (follow) { ImGui::PushStyleColor(ImGuiCol_Button, hex(0x58D489, 0.22f)); ImGui::PushStyleColor(ImGuiCol_Text, C_LIVE); }
        if (ImGui::Button(follow ? "Following X-Plane" : "Follow sim")) { js_.call("calcFollow", {id, follow ? "0" : "1"}); calcDirty_ = true; }
        if (follow) ImGui::PopStyleColor(2);
        if (ImGui::IsItemHovered()) ImGui::SetTooltip("Green fields fill themselves from X-Plane twice a second.");
        ImGui::SameLine();
        ImGui::BeginDisabled(!flag(v, "liveOk"));
        if (ImGui::Button("Fill from sim once")) { js_.call("calcFill", {id}); calcDirty_ = true; }
        ImGui::EndDisabled();
        ImGui::SameLine();
    }
    if (ImGui::Button("Reset")) { js_.call("calcReset", {id}); calcDirty_ = true; edits_.clear(); }
    ImGui::Dummy(ImVec2(0, 2));
    for (const auto& sec : arr(v, "sections"))
        drawFields(arr(sec, "fields"), "calc:" + id, [&](const std::string& k, const std::string& val) { js_.call("calcSet", {id, k, val}); calcDirty_ = true; });
    drawOutputs(v);
    ImGui::EndChild();
}

void FlightComputerWindow::drawPanelHead(const json& v) {
    std::string eyebrow = str(v, "group");
    if (!eyebrow.empty()) {
        std::transform(eyebrow.begin(), eyebrow.end(), eyebrow.begin(), [](unsigned char ch) { return (char)std::toupper(ch); });
        ImGui::PushFont(fSmall_);
        ImGui::TextColored(C_MUTED, "%s", eyebrow.c_str());
        ImGui::PopFont();
    }
    ImGui::PushFont(fBig_);
    ImGui::PushTextWrapPos(0);
    ImGui::TextUnformatted(str(v, "title").c_str());
    ImGui::PopTextWrapPos();
    ImGui::PopFont();
    std::string desc = str(v, "desc");
    if (!desc.empty()) wrappedMuted(desc);
}

// =================================================================== fields
void FlightComputerWindow::drawFields(const json& fields, const std::string& scope, const Setter& set) {
    if (!fields.is_array() || fields.empty()) return;
    // long text inputs (METAR) get the full width
    for (const auto& f : fields)
        if (str(f, "kind") == "text") drawField(f, scope, set, ImGui::GetContentRegionAvail().x);
    const float avail = ImGui::GetContentRegionAvail().x;
    int cols = std::max(1, std::min(4, (int)(avail / 205.0f)));
    int n = 0;
    for (const auto& f : fields) if (str(f, "kind") != "text") n++;
    if (n == 0) return;
    cols = std::min(cols, n);
    if (ImGui::BeginTable(("##fields" + scope).c_str(), cols, ImGuiTableFlags_SizingStretchSame | ImGuiTableFlags_NoPadOuterX)) {
        for (const auto& f : fields) {
            if (str(f, "kind") == "text") continue;
            ImGui::TableNextColumn();
            drawField(f, scope, set, ImGui::GetContentRegionAvail().x);
        }
        ImGui::EndTable();
    }
}

void FlightComputerWindow::drawField(const json& f, const std::string& scope, const Setter& set, float width) {
    const std::string k = str(f, "k"), kind = str(f, "kind"), key = scope + ":" + k;
    const bool following = flag(f, "following");
    ImGui::GetCurrentWindow()->DC.CurrLineTextBaseOffset = 0.0f;
    ImGui::PushID(key.c_str());
    ImGui::PushFont(fSmall_);
    ImGui::PushTextWrapPos(ImGui::GetCursorPosX() + width);
    ImGui::TextColored(following ? C_LIVE : C_MUTED, "%s", str(f, "label").c_str());
    ImGui::PopTextWrapPos();
    ImGui::PopFont();
    if (kind == "select") {
        std::string value = str(f, "value"), shown = value;
        for (const auto& o : arr(f, "options")) if (o.is_array() && o.size() >= 2 && S(o[0]) == value) shown = S(o[1]);
        ImGui::SetNextItemWidth(width);
        ImGui::PushStyleColor(ImGuiCol_Text, C_SEL);
        if (ImGui::BeginCombo("##sel", shown.c_str())) {
            ImGui::PushStyleColor(ImGuiCol_Text, C_TEXT);
            for (const auto& o : arr(f, "options")) {
                if (!o.is_array() || o.size() < 2) continue;
                const std::string ov = S(o[0]), label = S(o[1]);
                if (ImGui::Selectable(label.c_str(), ov == value)) set(k, ov);
            }
            ImGui::PopStyleColor();
            ImGui::EndCombo();
        }
        ImGui::PopStyleColor();
    } else {
        EditBuf& e = edits_[key];
        const std::string model = str(f, "value");
        if (!e.editing && e.model != model) {
            std::snprintf(e.buf, sizeof e.buf, "%s", model.c_str());
            e.model = model;
        }
        const std::string unit = str(f, "unit");
        float unitW = unit.empty() ? 0.0f : ImGui::CalcTextSize(unit.c_str()).x + ImGui::GetStyle().ItemInnerSpacing.x + 2;
        ImGui::SetNextItemWidth(std::max(60.0f, width - unitW));
        ImGui::PushStyleColor(ImGuiCol_Text, following ? C_LIVE : C_SEL);
        if (following) ImGui::PushStyleColor(ImGuiCol_Border, hex(0x58D489, 0.6f));
        bool changed;
        if (kind == "text")
            changed = ImGui::InputText("##txt", e.buf, sizeof e.buf, ImGuiInputTextFlags_AutoSelectAll);
        else
            changed = ImGui::InputText("##num", e.buf, 48, ImGuiInputTextFlags_CallbackCharFilter | ImGuiInputTextFlags_AutoSelectAll, numberFilter);
        const bool active = ImGui::IsItemActive();
        if (e.editing && !active) e.model = "\x01";      // done typing: show the value as the calculator read it
        e.editing = active;
        if (following) ImGui::PopStyleColor();
        ImGui::PopStyleColor();
        if (changed) set(k, e.buf);
        if (!unit.empty()) {
            ImGui::SameLine(0, ImGui::GetStyle().ItemInnerSpacing.x);
            ImGui::TextColored(C_MUTED, "%s", unit.c_str());
        }
    }
    const std::string hint = str(f, "hint");
    if (!hint.empty()) {
        ImGui::PushFont(fSmall_);
        ImGui::PushTextWrapPos(ImGui::GetCursorPosX() + width);
        ImGui::TextColored(C_FAINT, "%s", hint.c_str());
        ImGui::PopTextWrapPos();
        ImGui::PopFont();
    }
    ImGui::PopID();
}

// =================================================================== outputs
void FlightComputerWindow::drawOutputs(const json& v) {
    const std::string err = str(v, "error");
    if (!err.empty()) { ImGui::Dummy(ImVec2(0, 4)); ImGui::PushTextWrapPos(0); ImGui::TextColored(C_BAD, "%s", err.c_str()); ImGui::PopTextWrapPos(); return; }
    ImGui::Dummy(ImVec2(0, 4));
    drawResults(arr(v, "results"));
    drawBars(arr(v, "bars"));
    drawTables(arr(v, "tables"));
    if (v.contains("chart") && v["chart"].is_object()) drawChart(v["chart"]);
    drawNotes(arr(v, "notes"));
    drawSteps(arr(v, "steps"));
}

// Result cards: rounded tiles with a gap between them, equal height across a row.
void FlightComputerWindow::drawResults(const json& results) {
    if (!results.is_array() || results.empty()) return;
    ImGuiWindow* win = ImGui::GetCurrentWindow();
    const float avail = ImGui::GetContentRegionAvail().x;
    const float gap = 8.0f, padX = 11.0f, padY = 8.0f;
    const int n = (int)results.size();
    const int cols = std::max(1, std::min({n, 4, (int)((avail + gap) / (180.0f + gap))}));
    const float cardW = std::floor((avail - gap * (float)(cols - 1)) / (float)cols);
    const float gs = ImGui::GetIO().FontGlobalScale;
    const ImVec2 origin = ImGui::GetCursorScreenPos();
    ImDrawList* dl = ImGui::GetWindowDrawList();
    float rowY = origin.y;
    for (int first = 0; first < n; first += cols) {
        const int last = std::min(n, first + cols);
        ImDrawListSplitter split;           // text first (channel 1), then the card backgrounds behind it (channel 0)
        split.Split(dl, 2);
        split.SetCurrentChannel(dl, 1);
        float rowBottom = rowY;
        for (int i = first; i < last; i++) {
            const json& r = results[i];
            const std::string tone = str(r, "tone");
            const float x = origin.x + (float)(i - first) * (cardW + gap);
            const float right = x + cardW - padX;
            ImGui::PushID(i);
            ImGui::SetCursorScreenPos(ImVec2(x + padX, rowY + padY));
            ImGui::BeginGroup();
            ImGui::PushTextWrapPos(right - win->Pos.x + win->Scroll.x);
            ImGui::PushFont(fSmall_);
            ImGui::TextColored(C_MUTED, "%s", str(r, "label").c_str());
            ImGui::PopFont();
            const std::string value = str(r, "value"), unit = str(r, "unit");
            const bool big = flag(r, "main") && value.size() <= 14;
            ImFont* vf = big ? fBig_ : fBold_;
            ImGui::PushFont(vf);
            ImGui::TextColored(toneColor(tone), "%s", value.c_str());
            ImGui::PopFont();
            if (!unit.empty()) {
                const ImVec2 vmax = ImGui::GetItemRectMax(), vmin = ImGui::GetItemRectMin();
                if (vmax.x + 5 + ImGui::CalcTextSize(unit.c_str()).x <= right) {
                    ImGui::SetCursorScreenPos(ImVec2(vmax.x + 5, vmin.y + (vf->Ascent - fRegular_->Ascent) * gs));
                }
                ImGui::TextColored(C_MUTED, "%s", unit.c_str());
            }
            const std::string note = str(r, "note");
            if (!note.empty()) { ImGui::PushFont(fSmall_); ImGui::TextColored(C_MUTED, "%s", note.c_str()); ImGui::PopFont(); }
            ImGui::PopTextWrapPos();
            ImGui::EndGroup();
            ImGui::PopID();
            rowBottom = std::max(rowBottom, ImGui::GetItemRectMax().y + padY);
        }
        split.SetCurrentChannel(dl, 0);
        for (int i = first; i < last; i++) {
            const float x = origin.x + (float)(i - first) * (cardW + gap);
            dl->AddRectFilled(ImVec2(x, rowY), ImVec2(x + cardW, rowBottom), ImGui::GetColorU32(toneBg(str(results[i], "tone"))), 8.0f);
        }
        split.Merge(dl);
        rowY = rowBottom + gap;
    }
    ImGui::SetCursorScreenPos(ImVec2(origin.x, rowY - gap));
    ImGui::Dummy(ImVec2(avail, 0.0f));
}

void FlightComputerWindow::drawBars(const json& bars) {
    for (const auto& b : bars) {
        ImGui::Dummy(ImVec2(0, 2));
        const double used = D(b, "used", 0.0), avail = D(b, "avail", 1.0);
        const float frac = (float)std::max(0.0, std::min(1.0, used / std::max(1.0, avail)));
        const std::string label = str(b, "label"), text = str(b, "text"), tone = str(b, "tone");
        ImGui::PushFont(fBold_);
        ImGui::TextUnformatted(label.c_str());
        ImGui::PopFont();
        ImGui::SameLine();
        float tw = ImGui::CalcTextSize(text.c_str()).x, rest = ImGui::GetContentRegionAvail().x;
        if (tw < rest) ImGui::SetCursorPosX(ImGui::GetCursorPosX() + rest - tw);
        ImGui::TextColored(C_MUTED, "%s", text.c_str());
        ImGui::PushStyleColor(ImGuiCol_PlotHistogram, toneColor(tone));
        ImGui::ProgressBar(frac, ImVec2(-FLT_MIN, 8), "");
        ImGui::PopStyleColor();
    }
}

void FlightComputerWindow::drawTables(const json& tables) {
    int ti = 0;
    for (const auto& t : tables) {
        const auto& cols = arr(t, "cols");
        const auto& align = arr(t, "align");
        if (cols.empty()) continue;
        ImGui::Dummy(ImVec2(0, 4));
        std::string title = str(t, "title");
        if (!title.empty()) { ImGui::PushFont(fBold_); ImGui::TextUnformatted(title.c_str()); ImGui::PopFont(); }
        ImGui::PushID(ti++);
        if (ImGui::BeginTable("##tbl", (int)cols.size(), ImGuiTableFlags_BordersInnerH | ImGuiTableFlags_RowBg | ImGuiTableFlags_SizingStretchProp | ImGuiTableFlags_PadOuterX)) {
            for (size_t i = 0; i < cols.size(); i++)
                ImGui::TableSetupColumn(S(cols[i]).c_str(), i == 0 ? ImGuiTableColumnFlags_WidthStretch : ImGuiTableColumnFlags_WidthFixed, i == 0 ? 2.0f : 0.0f);
            ImGui::PushFont(fSmall_);
            ImGui::TableHeadersRow();
            ImGui::PopFont();
            for (const auto& row : arr(t, "rows")) {
                ImGui::TableNextRow();
                const bool strong = flag(row, "strong"), pick = flag(row, "pick");
                if (pick) ImGui::TableSetBgColor(ImGuiTableBgTarget_RowBg0, ImGui::GetColorU32(hex(0x58D489, 0.14f)));
                const auto& cells = arr(row, "cells");
                for (size_t i = 0; i < cells.size() && i < cols.size(); i++) {
                    ImGui::TableSetColumnIndex((int)i);
                    const std::string cell = S(cells[i]);
                    const std::string al = i < align.size() ? S(align[i]) : "l";
                    if (al == "r" || al == "c") {
                        float cw = ImGui::GetContentRegionAvail().x, tw = ImGui::CalcTextSize(cell.c_str()).x;
                        if (tw < cw) ImGui::SetCursorPosX(ImGui::GetCursorPosX() + (al == "r" ? cw - tw : (cw - tw) * 0.5f));
                    }
                    if (strong) ImGui::PushFont(fBold_);
                    ImGui::TextUnformatted(cell.c_str());
                    if (strong) ImGui::PopFont();
                }
            }
            ImGui::EndTable();
        }
        ImGui::PopID();
    }
}

void FlightComputerWindow::drawNotes(const json& notes) {
    for (const auto& n : notes) {
        if (!n.is_string()) continue;
        ImGui::Dummy(ImVec2(0, 1));
        ImGui::TextColored(C_FAINT, "•");
        ImGui::SameLine();
        wrappedMuted(n.get<std::string>());
    }
}

void FlightComputerWindow::drawSteps(const json& steps) {
    if (!steps.is_array() || steps.empty()) return;
    ImGui::Dummy(ImVec2(0, 4));
    if (!ImGui::CollapsingHeader("Show the working")) return;
    int i = 1;
    for (const auto& s : steps) {
        ImGui::PushID(i);
        ImGui::TextColored(C_FAINT, "%d", i);
        ImGui::SameLine(0, 10);
        ImGui::BeginGroup();
        wrappedMuted(str(s, "t"));
        ImGui::PushTextWrapPos(0);
        ImGui::PushStyleColor(ImGuiCol_Text, C_SEL);
        ImGui::TextUnformatted(str(s, "text").c_str());
        ImGui::PopStyleColor();
        ImGui::PopTextWrapPos();
        ImGui::EndGroup();
        ImGui::Dummy(ImVec2(0, 2));
        ImGui::PopID();
        i++;
    }
}

void FlightComputerWindow::wrappedMuted(const std::string& s) {
    ImGui::PushTextWrapPos(0);
    ImGui::PushStyleColor(ImGuiCol_Text, C_MUTED);
    ImGui::TextUnformatted(s.c_str());
    ImGui::PopStyleColor();
    ImGui::PopTextWrapPos();
}

// =================================================================== departure chart
void FlightComputerWindow::drawChart(const json& ch) {
    const auto& runs = arr(ch, "runs");
    if (runs.empty()) return;
    double xMax = 1, hTop = 500, vMin = 1e9, vMax = 0;
    for (const auto& r : runs)
        for (const auto& p : arr(r, "pts")) {
            if (!isPoint(p)) continue;
            xMax = std::max(xMax, D(p[0], 0));
            hTop = std::max(hTop, D(p[1], 0));
            vMin = std::min(vMin, D(p[2], 0));
            vMax = std::max(vMax, D(p[2], 0));
        }
    if (vMin > vMax) { vMin = 100; vMax = 200; }
    xMax = std::ceil(xMax + 0.3);
    auto nice = [](double span, int want) { double raw = span / want, p = std::pow(10.0, std::floor(std::log10(raw))), m = raw / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p; };
    const double hStep = nice(hTop, 5), hMax = std::ceil(hTop * 1.08 / hStep) * hStep;
    vMin = std::floor((vMin - 10) / 20) * 20; vMax = std::ceil((vMax + 10) / 20) * 20;
    const double xStep = xMax > 12 ? 2 : 1, vStep = vMax - vMin > 100 ? 40 : 20;
    const bool eo = ch.contains("segments") && ch["segments"].is_array();

    ImGui::Dummy(ImVec2(0, 6));
    const float W = std::min(ImGui::GetContentRegionAvail().x, 900.0f);
    const float padL = 58, padR = 14, H1 = 230, H2 = 96, gap = 26, top = 8;
    const ImVec2 o = ImGui::GetCursorScreenPos();
    ImDrawList* dl = ImGui::GetWindowDrawList();
    const float x0 = o.x + padL, x1 = o.x + W - padR;
    const float y0 = o.y + top, y1 = y0 + H1, v0 = y1 + gap, v1 = v0 + H2;
    auto X = [&](double x) { return (float)(x0 + (x1 - x0) * x / xMax); };
    auto Y = [&](double h) { return (float)(y1 - (y1 - y0) * h / hMax); };
    auto V = [&](double v) { return (float)(v1 - (v1 - v0) * (v - vMin) / std::max(1.0, vMax - vMin)); };
    const ImU32 grid = ImGui::GetColorU32(C_LINE), axis = ImGui::GetColorU32(C_LINE2), muted = ImGui::GetColorU32(C_MUTED);
    ImFont* sf = fSmall_;
    const float fs = sf->FontSize * ImGui::GetIO().FontGlobalScale;
    auto textW = [&](const std::string& t) { return sf->CalcTextSizeA(fs, FLT_MAX, 0, t.c_str()).x; };
    auto ft = [](double h) {             // 1,435 ft
        char b[32];
        long long v = std::llround(h);
        std::string digits = std::to_string(v < 0 ? -v : v), out;
        for (size_t i = 0; i < digits.size(); i++) { if (i && (digits.size() - i) % 3 == 0) out += ','; out += digits[i]; }
        std::snprintf(b, sizeof b, "%s%s ft", v < 0 ? "-" : "", out.c_str());
        return std::string(b);
    };
    char buf[64];
    dl->AddRectFilled(ImVec2(o.x, o.y), ImVec2(o.x + W, v1 + 30 + fs), ImGui::GetColorU32(hex(0x0D141B)), 8.0f);
    // engine failure: the four take-off segments as bands
    if (eo) {
        const ImVec4 segc[] = {hex(0xF0B340, 0.10f), hex(0x4FC6EA, 0.10f), hex(0x58D489, 0.10f), hex(0xE46BD2, 0.10f)};
        int i = 0;
        for (const auto& sgm : ch["segments"]) {
            if (!sgm.is_array() || sgm.size() < 3 || !sgm[0].is_number() || !sgm[1].is_number()) continue;
            float a = X(D(sgm[0], 0)), b = X(std::min(D(sgm[1], 0), xMax));
            if (b > a) {
                dl->AddRectFilled(ImVec2(a, y0), ImVec2(b, y1), ImGui::GetColorU32(segc[i % 4]));
                const std::string name = S(sgm[2]);
                float tw = textW(name);
                if (b - a > tw + 4) dl->AddText(sf, fs, ImVec2((a + b - tw) * 0.5f, y1 - fs - 4), muted, name.c_str());
            }
            i++;
        }
    }
    // grids and axes
    for (double h = 0; h <= hMax + 1e-6; h += hStep) {
        dl->AddLine(ImVec2(x0, Y(h)), ImVec2(x1, Y(h)), grid);
        std::snprintf(buf, sizeof buf, "%.0f", h);
        dl->AddText(sf, fs, ImVec2(x0 - 6 - textW(buf), Y(h) - fs * 0.5f), muted, buf);
    }
    for (double v = vMin; v <= vMax + 1e-6; v += vStep) {
        dl->AddLine(ImVec2(x0, V(v)), ImVec2(x1, V(v)), grid);
        std::snprintf(buf, sizeof buf, "%.0f", v);
        dl->AddText(sf, fs, ImVec2(x0 - 6 - textW(buf), V(v) - fs * 0.5f), muted, buf);
    }
    for (double x = 0; x <= xMax + 1e-6; x += xStep) {
        dl->AddLine(ImVec2(X(x), y0), ImVec2(X(x), y1), grid);
        dl->AddLine(ImVec2(X(x), v0), ImVec2(X(x), v1), grid);
        std::snprintf(buf, sizeof buf, "%.0f", x);
        dl->AddText(sf, fs, ImVec2(X(x) - textW(buf) * 0.5f, v1 + 3), muted, buf);
    }
    dl->AddRect(ImVec2(x0, y0), ImVec2(x1, y1), axis);
    dl->AddRect(ImVec2(x0, v0), ImVec2(x1, v1), axis);
    dl->AddText(sf, fs, ImVec2(o.x + 6, y0 - 2), muted, "ft");
    dl->AddText(sf, fs, ImVec2(o.x + 6, v0 - 2), muted, "kt");
    const char* xl = "Distance from brake release (NM)";
    dl->AddText(sf, fs, ImVec2((x0 + x1 - textW(xl)) * 0.5f, v1 + 3 + fs), muted, xl);
    auto dashedV = [&](float x, float ya, float yb, ImU32 col) { for (float y = ya; y < yb; y += 9) dl->AddLine(ImVec2(x, y), ImVec2(x, std::min(y + 5, yb)), col); };
    if (hMax >= 3000) {
        for (float x = x0; x < x1; x += 9) dl->AddLine(ImVec2(x, Y(3000)), ImVec2(std::min(x + 5, x1), Y(3000)), muted);
        const char* t3 = "3000 ft";
        dl->AddText(sf, fs, ImVec2(x1 - 4 - textW(t3), Y(3000) - fs - 1), muted, t3);
    }
    const double refNm = D(ch, "refNm", 0.0);
    if (refNm > 0 && refNm < xMax) {
        dashedV(X(refNm), y0, y1, muted);
        dl->AddText(sf, fs, ImVec2(X(refNm) + 4, y0 + 2), muted, str(ch, "refLabel").c_str());
    }

    // the highest line gets its labels above-left, the others below-right, so labels never sit between two lines
    int highest = 0;
    double best = -1;
    for (size_t i = 0; i < runs.size(); i++) {
        double sum = 0;
        int n = 0;
        for (const auto& p : arr(runs[i], "pts")) if (isPoint(p)) { sum += D(p[1], 0); n++; }
        if (n && sum / n > best) { best = sum / n; highest = (int)i; }
    }
    struct Box { float a, b, y; };
    std::vector<Box> placed;
    auto put = [&](float a, float b, float y, float dir) {
        for (int k = 0; k < 8; k++) {
            bool hit = false;
            for (const auto& q : placed) if (a < q.b + 4 && b > q.a - 4 && std::fabs(y - q.y) < fs + 2) { hit = true; break; }
            if (!hit) break;
            y += dir * (fs + 2);
        }
        placed.push_back({a, b, y});
        return y;
    };
    struct Label { float x, y; ImU32 col; std::string text; };
    std::vector<Label> labels;
    float legendW = 0;
    for (const auto& r : runs) legendW = std::max(legendW, textW(str(r, "label")));
    // legend first, so labels keep clear of it
    const float lx = x0 + 10, ly = y0 + 8, lh = fs + 5;
    dl->AddRectFilled(ImVec2(lx - 6, ly - 4), ImVec2(lx + 36 + legendW + 8, ly + lh * runs.size()), ImGui::GetColorU32(hex(0x17212B, 0.92f)), 6.0f);
    placed.push_back({lx - 6, lx + 36 + legendW + 8, ly});
    for (size_t i = 1; i < runs.size(); i++) placed.push_back({lx - 6, lx + 36 + legendW + 8, ly + lh * i});

    for (size_t ri = 0; ri < runs.size(); ri++) {
        const json& r = runs[ri];
        const ImU32 col = ImGui::GetColorU32(toneColor(str(r, "tone")));
        const bool dash = flag(r, "dash"), high = (int)ri == highest;
        std::vector<ImVec2> hp, vp;
        std::vector<std::pair<double, double>> xh;
        hp.push_back(ImVec2(X(0), Y(0)));
        hp.push_back(ImVec2(X(D(r, "groundNm", 0.0)), Y(35)));
        for (const auto& p : arr(r, "pts")) {
            if (!isPoint(p)) continue;
            hp.push_back(ImVec2(X(D(p[0], 0)), Y(D(p[1], 0))));
            vp.push_back(ImVec2(X(D(p[0], 0)), V(D(p[2], 0))));
            xh.emplace_back(D(p[0], 0), D(p[1], 0));
        }
        auto line = [&](const std::vector<ImVec2>& pts) {
            if (pts.size() < 2) return;
            if (!dash) { dl->AddPolyline(pts.data(), (int)pts.size(), col, ImDrawFlags_None, 2.4f); return; }
            float carry = 0; bool on = true;
            for (size_t i = 1; i < pts.size(); i++) {
                ImVec2 a = pts[i - 1], b = pts[i];
                float len = std::hypot(b.x - a.x, b.y - a.y), pos = 0;
                while (pos < len) {
                    float seg = std::min((on ? 7.0f : 5.0f) - carry, len - pos);
                    ImVec2 p0(a.x + (b.x - a.x) * pos / len, a.y + (b.y - a.y) * pos / len);
                    ImVec2 p1(a.x + (b.x - a.x) * (pos + seg) / len, a.y + (b.y - a.y) * (pos + seg) / len);
                    if (on) dl->AddLine(p0, p1, col, 2.2f);
                    pos += seg; carry += seg;
                    if (carry >= (on ? 7.0f : 5.0f) - 0.01f) { carry = 0; on = !on; }
                }
            }
        };
        dl->PushClipRect(ImVec2(x0, y0), ImVec2(x1, y1), true);
        line(hp);
        // height at the noise reference point
        if (refNm > 0 && refNm < xMax && xh.size() >= 2 && refNm >= xh.front().first && refNm <= xh.back().first) {
            double h = xh.back().second;
            for (size_t i = 1; i < xh.size(); i++)
                if (xh[i].first >= refNm) {
                    const double t = (refNm - xh[i - 1].first) / std::max(1e-9, xh[i].first - xh[i - 1].first);
                    h = xh[i - 1].second + t * (xh[i].second - xh[i - 1].second);
                    break;
                }
            dl->AddCircleFilled(ImVec2(X(refNm), Y(h)), 4.0f, col);
            const std::string s = ft(h);
            const float w = textW(s), X0 = high ? X(refNm) - 7 - w : X(refNm) + 7, Yt = high ? Y(h) - fs - 5 : Y(h) + 5;
            placed.push_back({X0, X0 + w, Yt});
            labels.push_back({X0, Yt, col, s});
        }
        // event markers; labels of events close together are merged, and moved apart if they would touch
        struct Ev { std::string key; double x, h; };
        std::vector<Ev> evs;
        bool hasMct = false;
        for (const auto& e : arr(r, "events")) {
            if (!e.is_object()) continue;
            Ev ev{str(e, "key"), D(e, "x", 0.0), D(e, "h", 0.0)};
            if (ev.x > xMax) continue;
            if (ev.key == "mct") hasMct = true;
            const bool named = ev.key == "thrRed" || ev.key == "acc" || ev.key == "clean" || ev.key == "mct";
            dl->AddCircleFilled(ImVec2(X(ev.x), Y(ev.h)), named ? 4.5f : 3.0f, col);
            if (named) evs.push_back(ev);
        }
        dl->PopClipRect();
        auto name = [&](const std::string& k) -> std::string {
            if (k == "thrRed") return "THR RED";
            if (k == "acc") return eo && ri == 0 ? "EO ACC" : "ACC";
            if (k == "mct") return "MCT";
            return "clean";
        };
        std::vector<std::vector<Ev>> groups;
        for (const auto& e : evs) {
            if (e.key == "clean" && hasMct) continue;
            if (!groups.empty() && e.x - groups.back()[0].x < 0.45 && std::fabs(e.h - groups.back()[0].h) < 400) groups.back().push_back(e);
            else groups.push_back({e});
        }
        for (const auto& g : groups) {
            std::string s;
            for (const auto& e : g) s += (s.empty() ? "" : " + ") + name(e.key);
            s += " " + ft(g[0].h);
            const float w = textW(s), ex = X(g[0].x), ey = Y(g[0].h);
            bool above = high;
            if (above && ex - 6 - w < x0 + 4) above = false;      // would run into the axis: put it below-right
            const float a = above ? ex - 6 - w : ex + 6;
            const float yy = put(a, a + w, above ? ey - fs - 5 : ey + 5, above ? -1.0f : 1.0f);
            labels.push_back({a, yy, col, s});
        }
        dl->PushClipRect(ImVec2(x0, v0), ImVec2(x1, v1), true);
        line(vp);
        dl->PopClipRect();
        // legend entry
        const float yl = ly + lh * ri;
        dl->AddLine(ImVec2(lx, yl + fs * 0.5f), ImVec2(lx + 24, yl + fs * 0.5f), col, 2.4f);
        dl->AddText(sf, fs, ImVec2(lx + 32, yl), col, str(r, "label").c_str());
    }
    dl->PushClipRect(ImVec2(o.x, o.y), ImVec2(o.x + W, y1 + 2), true);
    for (const auto& l : labels) dl->AddText(sf, fs, ImVec2(l.x, l.y), l.col, l.text.c_str());
    dl->PopClipRect();
    ImGui::Dummy(ImVec2(W, v1 + 30 + fs - o.y));
}

// =================================================================== performance
void FlightComputerWindow::drawPerformance() {
    const json& v = perfView_;
    if (!v.is_object()) { ImGui::TextColored(C_BAD, "%s", js_.lastCallError().c_str()); return; }
    const std::string tab = str(v, "tab", perfTab_.c_str());
    // aircraft profile
    ImGui::PushFont(fSmall_);
    ImGui::TextColored(C_MUTED, "AIRCRAFT PROFILE");
    ImGui::PopFont();
    const std::string prof = str(v, "profile");
    std::string shown = prof;
    for (const auto& o : arr(v, "profiles")) if (o.is_array() && o.size() >= 2 && S(o[0]) == prof) shown = S(o[1]);
    ImGui::SetNextItemWidth(std::min(420.0f, ImGui::GetContentRegionAvail().x));
    if (ImGui::BeginCombo("##profile", shown.c_str(), ImGuiComboFlags_HeightLarge)) {
        for (const auto& o : arr(v, "profiles")) {
            if (!o.is_array() || o.size() < 2) continue;
            const std::string id = S(o[0]), label = S(o[1]);
            if (ImGui::Selectable(label.c_str(), id == prof)) { js_.call("perfSet", {tab, "profile", id}); perfDirty_ = true; edits_.clear(); }
        }
        ImGui::EndCombo();
    }
    ImGui::SameLine();
    ImGui::PushFont(fBold_);
    ImGui::TextUnformatted(str(v, "profileName").c_str());
    ImGui::PopFont();
    if (flag(v, "generic")) {
        ImGui::PushTextWrapPos(0);
        ImGui::TextColored(C_WARN, "Generic profile: this type is not in the library, so wing area, flap lift and fuel flow are estimated from X-Plane's own weights.");
        ImGui::PopTextWrapPos();
    } else if (flag(v, "liveOk") && !flag(v, "detected")) {
        wrappedMuted("The loaded aircraft is not an airliner — pick a type above to plan with.");
    }
    // sub-tabs stay at the top; the page below them scrolls
    const char* ids[] = {"load", "fuel", "takeoff", "after", "landing", "cruise"};
    const char* names[] = {"Load sheet", "Fuel plan", "Take-off", "After take-off", "Landing", "Climb, cruise & descent"};
    if (ImGui::BeginTabBar("##perftabs", ImGuiTabBarFlags_FittingPolicyScroll)) {
        for (int i = 0; i < 6; i++) {
            const ImGuiTabItemFlags fl = (!perfTabShown_ && perfTab_ == ids[i]) ? ImGuiTabItemFlags_SetSelected : 0;
            if (ImGui::BeginTabItem(names[i], nullptr, fl)) {
                if (perfTab_ != ids[i] && perfTabShown_) { perfTab_ = ids[i]; perfDirty_ = true; }
                ImGui::EndTabItem();
            }
        }
        perfTabShown_ = true;
        ImGui::EndTabBar();
    }
    if (perfDirty_) { perfView_ = callJson("perfView", {perfTab_}); perfDirty_ = false; perfAt_ = XPLMGetElapsedTime(); }
    const json& pv = perfView_;
    const std::string ptab = str(pv, "tab");
    auto setter = [&](const std::string& k, const std::string& val) { js_.call("perfSet", {ptab, k, val}); perfDirty_ = true; };
    const float avail = ImGui::GetContentRegionAvail().x;
    const bool wide = avail >= 900.0f;
    auto inputs = [&]() {
        if (pv.contains("sim") && pv["sim"].is_object()) {
            ImGui::BeginDisabled(!flag(pv, "liveOk"));
            ImGui::PushStyleColor(ImGuiCol_Text, C_LIVE);
            ImGui::PushStyleColor(ImGuiCol_Button, hex(0x58D489, 0.14f));
            ImGui::PushStyleColor(ImGuiCol_ButtonHovered, hex(0x58D489, 0.24f));
            if (ImGui::Button("Use X-Plane now")) { js_.call("perfUseSim", {ptab}); perfDirty_ = true; edits_.clear(); }
            ImGui::PopStyleColor(3);
            ImGui::EndDisabled();
            ImGui::SameLine();
            ImGui::PushFont(fSmall_);
            wrappedMuted(flag(pv, "liveOk") ? str(pv["sim"], "hint") : "Start X-Plane to fill the conditions from the sim.");
            ImGui::PopFont();
        }
        for (const auto& sec : arr(pv, "sections")) {
            std::string t = str(sec, "title");
            if (!t.empty()) ImGui::SeparatorText(t.c_str());
            drawFields(arr(sec, "fields"), "perf:" + ptab, setter);
        }
    };
    auto outputs = [&]() {
        ImGui::PushFont(fBold_);
        ImGui::TextUnformatted(str(pv, "title").c_str());
        ImGui::PopFont();
        if (pv.contains("badge") && pv["badge"].is_object()) {
            std::string bt = str(pv["badge"], "text"), tone = str(pv["badge"], "tone");
            ImGui::SameLine(0, 12);
            ImVec2 p = ImGui::GetCursorScreenPos(), ts = ImGui::CalcTextSize(bt.c_str());
            ImGui::GetWindowDrawList()->AddRectFilled(ImVec2(p.x - 2, p.y - 1), ImVec2(p.x + ts.x + 12, p.y + ts.y + 2), ImGui::GetColorU32(toneBg(tone.empty() ? "sel" : tone)), 6.0f);
            ImGui::SetCursorScreenPos(ImVec2(p.x + 5, p.y));
            ImGui::TextColored(tone.empty() ? C_SEL : toneColor(tone), "%s", bt.c_str());
        }
        drawOutputs(pv);
    };
    if (wide) {
        // inputs on the left, results on the right; each side scrolls on its own
        const float leftW = std::floor(avail * 0.42f);
        ImGui::BeginChild("##perfin", ImVec2(leftW, 0), ImGuiChildFlags_None);
        inputs();
        ImGui::EndChild();
        ImGui::SameLine(0, 0);
        const ImVec2 p = ImGui::GetCursorScreenPos();
        ImGui::GetWindowDrawList()->AddLine(ImVec2(p.x + 7, p.y), ImVec2(p.x + 7, p.y + ImGui::GetContentRegionAvail().y), ImGui::GetColorU32(C_LINE));
        ImGui::SetCursorScreenPos(ImVec2(p.x + 15, p.y));
        ImGui::BeginChild("##perfout", ImVec2(0, 0), ImGuiChildFlags_None);
        outputs();
        ImGui::EndChild();
    } else {
        ImGui::BeginChild("##perfbody", ImVec2(0, 0), ImGuiChildFlags_None);
        inputs();
        ImGui::Separator();
        outputs();
        ImGui::EndChild();
    }
}

// =================================================================== settings
void FlightComputerWindow::drawSettings() {
    if (!settings_.is_object()) settings_ = callJson("settings");
    auto choice = [&](const char* label, const char* key, std::initializer_list<std::pair<const char*, const char*>> opts) {
        ImGui::TextColored(C_MUTED, "%s", label);
        ImGui::SameLine(190);
        std::string cur = str(settings_, key);
        for (const auto& o : opts) {
            if (ImGui::RadioButton(o.second, cur == o.first)) {
                js_.call("setSetting", {key, o.first});
                settings_ = callJson("settings");
                calcDirty_ = perfDirty_ = true; edits_.clear();
            }
            ImGui::SameLine();
        }
        ImGui::NewLine();
    };
    ImGui::SeparatorText("Units");
    choice("Mass and fuel", "mass", {{"kg", "kilograms"}, {"lb", "pounds"}});
    choice("Pressure", "press", {{"hPa", "hPa"}, {"inHg", "inHg"}});
    choice("Runway lengths", "rwy", {{"m", "metres"}, {"ft", "feet"}});
    ImGui::SeparatorText("Text size");
    int size = (int)D(settings_, "fontSize", 16.0);
    ImGui::SetNextItemWidth(260);
    if (ImGui::SliderInt("##font", &size, 12, 24, "%d px")) {
        js_.call("setSetting", {"fontSize", std::to_string(size)});
        settings_ = callJson("settings");
        pendingFont_ = 1;
    }
    ImGui::SeparatorText("Window");
    if (!isPoppedOut() && !isInVR()) { if (ImGui::Button("Pop out into its own window")) popOut(); ImGui::SameLine(); }
    if (isPoppedOut() || isInVR()) { if (ImGui::Button("Back into X-Plane")) popIn(); ImGui::SameLine(); }
    if (!isInVR()) {
        ImGui::BeginDisabled(!vrAvailable());
        if (ImGui::Button("Move into the VR headset")) moveToVR();
        ImGui::EndDisabled();
        if (!vrAvailable() && ImGui::IsItemHovered(ImGuiHoveredFlags_AllowWhenDisabled)) ImGui::SetTooltip("Start VR in X-Plane first.");
        ImGui::SameLine();
    }
    if (ImGui::Button("Reset position")) resetPosition();
    ImGui::PushFont(fSmall_);
    wrappedMuted("Bind a key or joystick button to “xpfc/window/toggle” (Settings → Keyboard in X-Plane) to open and close this window. The window also works popped out on a second monitor and in VR.");
    ImGui::PopFont();
    ImGui::SeparatorText("About");
    ImGui::Text("XP Flight Computer %s — plugin for X-Plane 11 and 12", str(status_, "version").c_str());
    wrappedMuted("The calculators and performance numbers come from the same code as the XP Flight Computer app (the study library, diagrams and phone view are in the app). Values in green follow X-Plane live; cyan values are yours; magenta values are calculated.");
    wrappedMuted("For flight simulation and study only — not for real-world navigation or aircraft operation. Airliner figures are typical public data and estimates.");
    ImGui::PushFont(fSmall_);
    wrappedMuted("Built with Dear ImGui (MIT) and QuickJS (MIT). Fonts: B612 (SIL Open Font License) and DejaVu Sans (Bitstream Vera licence).");
    ImGui::PopFont();
}
