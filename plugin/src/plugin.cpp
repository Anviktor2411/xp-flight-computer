// XP Flight Computer — X-Plane 11 / 12 plugin.
// Puts the app's calculators and airliner performance pages inside X-Plane (Plugins menu, or bind a key to
// "xpfc/window/toggle"). The calculation code is the app's own JavaScript, run by an embedded QuickJS engine.
#include "XPLMDataAccess.h"
#include "XPLMDisplay.h"
#include "XPLMMenus.h"
#include "XPLMPlugin.h"
#include "XPLMProcessing.h"
#include "XPLMUtilities.h"
#include "files.h"
#include "jshost.h"
#include "ui.h"
#include "nlohmann/json.hpp"
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <exception>
#include <map>
#include <memory>
#include <string>
#include <vector>

using nlohmann::json;

namespace {
const char* kName = "XP Flight Computer";
const char* kSig = "doesvic.xpflightcomputer";

std::unique_ptr<JsHost> gJs;
std::unique_ptr<FlightComputerWindow> gWin;
XPLMMenuID gMenu = nullptr;
XPLMCommandRef gCmdToggle = nullptr, gCmdCalc = nullptr, gCmdPerf = nullptr;
XPLMFlightLoopID gLoop = nullptr;
std::string gPluginDir, gPrefsPath;

void logLine(const char* s) { XPLMDebugString(s); }
void logf(const std::string& s) { XPLMDebugString((std::string(kName) + ": " + s + "\n").c_str()); }

/** Nothing may throw back into X-Plane: an escaped C++ exception would take the whole simulator down. */
template <class F> void guarded(const char* where, F&& f) {
    try { f(); }
    catch (const std::exception& e) { logf(std::string(where) + ": " + e.what()); }
    catch (...) { logf(std::string(where) + ": unknown error"); }
}
/** JSON text for the scripts. Aircraft files can carry text that is not valid UTF-8; replace it rather than fail. */
std::string toJson(const json& j) { return j.dump(-1, ' ', false, json::error_handler_t::replace); }

// ------------------------------------------------------------------ datarefs (same set as the bridge, xpfc.py)
// kind: f/i/d number, s string (n bytes), a array element n, S sum of the first n floats, L first n floats
struct Ref { const char* key; const char* name; char kind; int n; XPLMDataRef ref; XPLMDataTypeID type; bool looked; };
Ref gRefs[] = {
    {"icao", "sim/aircraft/view/acf_ICAO", 's', 40}, {"desc", "sim/aircraft/view/acf_descrip", 's', 260},
    {"tail", "sim/aircraft/view/acf_tailnum", 's', 40}, {"author", "sim/aircraft/view/acf_author", 's', 500},
    {"engines", "sim/aircraft/engine/acf_num_engines", 'i', 0}, {"engType", "sim/aircraft/prop/acf_en_type", 'a', 0},
    {"oew", "sim/aircraft/weight/acf_m_empty", 'f', 0}, {"mtow", "sim/aircraft/weight/acf_m_max", 'f', 0},
    {"maxFuel", "sim/aircraft/weight/acf_m_fuel_tot", 'f', 0}, {"vso", "sim/aircraft/view/acf_Vso", 'f', 0},
    {"vs", "sim/aircraft/view/acf_Vs", 'f', 0}, {"vfe", "sim/aircraft/view/acf_Vfe", 'f', 0},
    {"vno", "sim/aircraft/view/acf_Vno", 'f', 0}, {"vne", "sim/aircraft/view/acf_Vne", 'f', 0},
    {"mmo", "sim/aircraft/view/acf_Mmo", 'f', 0}, {"vle", "sim/aircraft/overflow/acf_Vle", 'f', 0},
    {"vmca", "sim/aircraft/overflow/acf_Vmca", 'f', 0}, {"vyse", "sim/aircraft/overflow/acf_Vyse", 'f', 0},
    {"gearRetract", "sim/aircraft/gear/acf_gear_retract", 'i', 0}, {"flapDetents", "sim/aircraft/controls/acf_flap_detents", 'i', 0},
    {"flag_airliner", "sim/aircraft2/metadata/is_airliner", 'i', 0}, {"flag_general_aviation", "sim/aircraft2/metadata/is_general_aviation", 'i', 0},
    {"flag_helicopter", "sim/aircraft2/metadata/is_helicopter", 'i', 0}, {"flag_glider", "sim/aircraft2/metadata/is_glider", 'i', 0},
    {"flag_military", "sim/aircraft2/metadata/is_military", 'i', 0}, {"flag_cargo", "sim/aircraft2/metadata/is_cargo", 'i', 0},
    {"flag_experimental", "sim/aircraft2/metadata/is_experimental", 'i', 0}, {"flag_ultralight", "sim/aircraft2/metadata/is_ultralight", 'i', 0},
    {"flag_seaplane", "sim/aircraft2/metadata/is_seaplane", 'i', 0}, {"flag_vtol", "sim/aircraft2/metadata/is_vtol", 'i', 0},
    {"flag_sci_fi", "sim/aircraft2/metadata/is_sci_fi", 'i', 0},
    {"lat", "sim/flightmodel/position/latitude", 'd', 0}, {"lon", "sim/flightmodel/position/longitude", 'd', 0},
    {"elevM", "sim/flightmodel/position/elevation", 'd', 0}, {"aglM", "sim/flightmodel/position/y_agl", 'f', 0},
    {"altInd", "sim/cockpit2/gauges/indicators/altitude_ft_pilot", 'f', 0}, {"pa", "sim/flightmodel2/position/pressure_altitude", 'd', 0},
    {"ias", "sim/cockpit2/gauges/indicators/airspeed_kts_pilot", 'f', 0}, {"cas", "sim/cockpit2/gauges/indicators/calibrated_airspeed_kts_pilot", 'f', 0},
    {"tasMs", "sim/flightmodel/position/true_airspeed", 'f', 0}, {"gsMs", "sim/flightmodel/position/groundspeed", 'f', 0},
    {"mach", "sim/flightmodel/misc/machno", 'f', 0}, {"vsFpm", "sim/flightmodel/position/vh_ind_fpm", 'f', 0},
    {"hdgT", "sim/flightmodel/position/psi", 'f', 0}, {"hdgM", "sim/flightmodel/position/mag_psi", 'f', 0},
    {"trkT", "sim/flightmodel/position/hpath", 'f', 0}, {"pitch", "sim/flightmodel/position/theta", 'f', 0},
    {"roll", "sim/flightmodel/position/phi", 'f', 0}, {"aoa", "sim/flightmodel2/position/alpha", 'f', 0},
    {"oat", "sim/weather/aircraft/temperature_ambient_deg_c", 'f', 0}, {"oat2", "sim/cockpit2/temperature/outside_air_temp_degc", 'f', 0},
    {"tat", "sim/weather/aircraft/temperature_leadingedge_deg_c", 'f', 0}, {"tat2", "sim/cockpit2/temperature/outside_air_LE_temp_degc", 'f', 0},
    {"qnhPa", "sim/weather/aircraft/qnh_pas", 'f', 0}, {"qnhInHg", "sim/weather/barometer_sealevel_inhg", 'f', 0},
    {"pStaticPa", "sim/weather/aircraft/barometer_current_pas", 'f', 0}, {"baroInHg", "sim/cockpit2/gauges/actuators/barometer_setting_in_hg_pilot", 'f', 0},
    {"windDirT", "sim/weather/aircraft/wind_now_direction_degt", 'f', 0}, {"windMs", "sim/weather/aircraft/wind_now_speed_msc", 'f', 0},
    {"windDirM2", "sim/cockpit2/gauges/indicators/wind_heading_deg_mag", 'f', 0}, {"windKt2", "sim/cockpit2/gauges/indicators/wind_speed_kts", 'f', 0},
    {"rho", "sim/weather/rho", 'f', 0}, {"altTempErr", "sim/weather/aircraft/altimeter_temperature_error", 'f', 0},
    {"visSm", "sim/weather/aircraft/visibility_reported_sm", 'f', 0}, {"rwyFriction", "sim/weather/region/runway_friction", 'f', 0},
    {"mass", "sim/flightmodel/weight/m_total", 'f', 0}, {"fuel", "sim/flightmodel/weight/m_fuel_total", 'f', 0},
    {"payload", "sim/flightmodel/weight/m_fixed", 'f', 0}, {"ffKgs", "sim/cockpit2/engine/indicators/fuel_flow_kg_sec", 'S', 8},
    {"n1", "sim/cockpit2/engine/indicators/N1_percent", 'L', 4},
    {"flapReq", "sim/cockpit2/controls/flap_handle_request_ratio", 'f', 0}, {"flapDep", "sim/cockpit2/controls/flap_handle_deploy_ratio", 'f', 0},
    {"gearDown", "sim/cockpit2/controls/gear_handle_down", 'i', 0}, {"onGround", "sim/flightmodel/failures/onground_any", 'i', 0},
    {"paused", "sim/time/paused", 'i', 0}, {"zulu", "sim/time/zulu_time_sec", 'f', 0},
    {"gpsDist", "sim/cockpit2/radios/indicators/gps_dme_distance_nm", 'f', 0}, {"gpsBrgM", "sim/cockpit2/radios/indicators/gps_bearing_deg_mag", 'f', 0},
    {"todDist", "sim/cockpit2/radios/indicators/fms_distance_to_tod_pilot", 'f', 0}, {"landingAlt", "sim/cockpit2/radios/indicators/landing_alt_pilot", 'f', 0},
};

struct Values {
    std::map<std::string, double> num;
    std::map<std::string, std::string> str;
    std::vector<float> n1;
    bool has(const char* k) const { return num.count(k) != 0; }
    double get(const char* k, double d = 0) const { auto it = num.find(k); return it == num.end() ? d : it->second; }
};

Values readAll() {
    Values v;
    for (auto& r : gRefs) {
        if (!r.looked) { r.ref = XPLMFindDataRef(r.name); r.type = r.ref ? XPLMGetDataRefTypes(r.ref) : 0; r.looked = true; }
        if (!r.ref) continue;
        const XPLMDataTypeID t = r.type;
        switch (r.kind) {
            case 's': {
                std::vector<char> buf(r.n + 1, 0);
                int got = XPLMGetDatab(r.ref, buf.data(), 0, r.n);
                if (got < 0) got = 0;
                buf[std::min(got, r.n)] = 0;
                v.str[r.key] = std::string(buf.data());
                break;
            }
            case 'a':
                if (t & xplmType_IntArray) { int x = 0; if (XPLMGetDatavi(r.ref, &x, r.n, 1) == 1) v.num[r.key] = x; }
                else if (t & xplmType_FloatArray) { float x = 0; if (XPLMGetDatavf(r.ref, &x, r.n, 1) == 1) v.num[r.key] = x; }
                break;
            case 'S': {
                float x[16] = {0};
                int got = XPLMGetDatavf(r.ref, x, 0, std::min(r.n, 16));
                double s = 0;
                for (int i = 0; i < got; i++) s += x[i];
                if (got > 0) v.num[r.key] = s;
                break;
            }
            case 'L': {
                float x[16] = {0};
                int got = XPLMGetDatavf(r.ref, x, 0, std::min(r.n, 16));
                v.n1.assign(x, x + std::max(0, got));
                break;
            }
            default:
                if (t & xplmType_Double) v.num[r.key] = XPLMGetDatad(r.ref);
                else if (t & xplmType_Float) v.num[r.key] = XPLMGetDataf(r.ref);
                else if (t & xplmType_Int) v.num[r.key] = XPLMGetDatai(r.ref);
                break;
        }
    }
    return v;
}

json numOrNull(const Values& v, const char* k) { return v.has(k) && std::isfinite(v.get(k)) ? json(v.get(k)) : json(); }
json pick(const Values& v, const char* a, const char* b) {
    if (!v.has(a)) return numOrNull(v, b);
    if (v.get(a) == 0 && v.has(b) && v.get(b) != 0) return numOrNull(v, b);
    return numOrNull(v, a);
}

/** The same "ac" and "f" objects the bridge (xpfc.py build_state) sends to the web app. */
void buildState(const Values& v, json& ac, json& f) {
    const double msToKt = 3600.0 / 1852.0;
    const char* flags[] = {"airliner", "general_aviation", "helicopter", "glider", "military", "cargo", "experimental", "ultralight", "seaplane", "vtol", "sci_fi"};
    auto s = [&](const char* k) { auto it = v.str.find(k); return it == v.str.end() ? std::string() : it->second; };
    ac = {{"icao", s("icao")}, {"desc", s("desc")}, {"tail", s("tail")}, {"author", s("author")},
          {"engines", (int)v.get("engines")}, {"engType", v.has("engType") ? (int)v.get("engType") : -1},
          {"mtow", numOrNull(v, "mtow")}, {"oew", numOrNull(v, "oew")}, {"maxFuel", numOrNull(v, "maxFuel")},
          {"vso", numOrNull(v, "vso")}, {"vs", numOrNull(v, "vs")}, {"vfe", numOrNull(v, "vfe")}, {"vno", numOrNull(v, "vno")},
          {"vne", numOrNull(v, "vne")}, {"mmo", numOrNull(v, "mmo")}, {"vle", numOrNull(v, "vle")}, {"vmca", numOrNull(v, "vmca")},
          {"vyse", numOrNull(v, "vyse")}, {"gearRetract", v.get("gearRetract") != 0}, {"flapDetents", (int)v.get("flapDetents")}};
    json fl = json::object();
    for (const char* n : flags) fl[n] = v.get((std::string("flag_") + n).c_str()) != 0;
    ac["flags"] = fl;

    json magvar;
    if (v.has("hdgT") && v.has("hdgM")) magvar = std::fmod(v.get("hdgT") - v.get("hdgM") + 540.0, 360.0) - 180.0;
    json windDirT = numOrNull(v, "windDirT"), windKt;
    if (v.has("windMs") && v.has("windDirT")) windKt = v.get("windMs") * msToKt;
    else if (v.has("windKt2")) {
        windKt = v.get("windKt2");
        if (v.has("windDirM2")) windDirT = std::fmod(v.get("windDirM2") + (magvar.is_number() ? magvar.get<double>() : 0.0) + 360.0, 360.0);
        else windDirT = json();
    }
    json qnh;
    if (v.get("qnhPa") > 80000) qnh = v.get("qnhPa") / 100.0;
    else if (v.get("qnhInHg") > 25) qnh = v.get("qnhInHg") * 33.8638866667;
    json baro;
    if (v.get("baroInHg") > 25) baro = v.get("baroInHg") * 33.8638866667;
    int engines = std::max(1, (int)v.get("engines", 1));
    json n1 = json::array();
    for (int i = 0; i < (int)v.n1.size() && i < engines; i++) n1.push_back(std::round(v.n1[i] * 10) / 10);
    auto conv = [&](const char* k, double m) { return v.has(k) ? json(v.get(k) * m) : json(); };
    f = {{"lat", numOrNull(v, "lat")}, {"lon", numOrNull(v, "lon")},
         {"altMsl", conv("elevM", 1 / 0.3048)}, {"agl", conv("aglM", 1 / 0.3048)},
         {"altInd", numOrNull(v, "altInd")}, {"pa", numOrNull(v, "pa")}, {"ias", numOrNull(v, "ias")}, {"cas", numOrNull(v, "cas")},
         {"tas", conv("tasMs", msToKt)}, {"gs", conv("gsMs", msToKt)}, {"mach", numOrNull(v, "mach")}, {"vs", numOrNull(v, "vsFpm")},
         {"hdgT", numOrNull(v, "hdgT")}, {"hdgM", numOrNull(v, "hdgM")}, {"trkT", numOrNull(v, "trkT")}, {"magVar", magvar},
         {"pitch", numOrNull(v, "pitch")}, {"roll", numOrNull(v, "roll")}, {"aoa", numOrNull(v, "aoa")},
         {"oat", pick(v, "oat", "oat2")}, {"tat", pick(v, "tat", "tat2")}, {"qnh", qnh}, {"baro", baro},
         {"pStatic", v.get("pStaticPa") > 0 ? json(v.get("pStaticPa") / 100.0) : json()},
         {"windDirT", windDirT}, {"windKt", windKt}, {"rho", numOrNull(v, "rho")}, {"altTempErr", numOrNull(v, "altTempErr")},
         {"visSm", numOrNull(v, "visSm")}, {"rwyFriction", numOrNull(v, "rwyFriction")},
         {"mass", numOrNull(v, "mass")}, {"fuel", numOrNull(v, "fuel")}, {"payload", numOrNull(v, "payload")},
         {"ff", conv("ffKgs", 3600.0)}, {"n1", n1}, {"flapReq", numOrNull(v, "flapReq")}, {"flapDep", numOrNull(v, "flapDep")},
         {"gearDown", v.has("gearDown") ? json(v.get("gearDown") != 0) : json()}, {"onGround", v.has("onGround") ? json(v.get("onGround") != 0) : json()},
         {"paused", v.get("paused") != 0}, {"zulu", numOrNull(v, "zulu")}, {"gpsDist", numOrNull(v, "gpsDist")},
         {"gpsBrgM", numOrNull(v, "gpsBrgM")}, {"todDist", numOrNull(v, "todDist")}, {"landingAlt", numOrNull(v, "landingAlt")}};
}

void pushLive() {
    if (!gJs || !gJs->ok()) return;
    json ac, f;
    buildState(readAll(), ac, f);
    gJs->call("setLive", {toJson(f), toJson(ac)});
    if (gWin) gWin->liveChanged();
}

// ------------------------------------------------------------------ files
std::string dirOf(const std::string& p) {
    size_t i = p.find_last_of("/\\");
    return i == std::string::npos ? std::string() : p.substr(0, i + 1);
}
void savePrefs() {
    if (!gJs || !gJs->ok() || gPrefsPath.empty()) return;
    std::string data = gJs->call("save");
    if (data.empty()) return;
    static bool warned = false;
    if (!xpfc::writeFileAtomic(gPrefsPath, data) && !warned) { warned = true; logf("could not save " + gPrefsPath); }
}

// ------------------------------------------------------------------ window, menu, commands
void ensureWindow() {
    if (gWin) return;
    int l, t, r, b;
    XPLMGetScreenBoundsGlobal(&l, &t, &r, &b);
    int w = std::min(1100, r - l - 60), h = std::min(760, t - b - 120);
    int x = l + (r - l - w) / 2, y = t - 70;
    gWin.reset(new FlightComputerWindow(*gJs, gPluginDir + "fonts/", x, y, x + w, y - h));
    if (!gJs->ok()) gWin->setFatal(gJs->error());
}

void show(int tab) {
    ensureWindow();
    pushLive();
    if (tab < 0) { gWin->setVisible(!gWin->isVisible()); return; }
    gWin->showTab((FlightComputerWindow::Tab)tab);
}

int commandCB(XPLMCommandRef, XPLMCommandPhase phase, void* ref) {
    if (phase == xplm_CommandBegin) guarded("command", [&] { show((int)(intptr_t)ref); });
    return 1;
}

void menuCB(void*, void* item) {
    guarded("menu", [&] {
        ensureWindow();
        switch ((int)(intptr_t)item) {
            case 1: gWin->setVisible(true); gWin->popOut(); break;
            case 2: gWin->setVisible(true); gWin->moveToVR(); break;
            case 3: gWin->setVisible(true); gWin->resetPosition(); break;
            default: break;
        }
    });
}

float loopCB(float, float, int, void*) {
    static int n = 0;
    guarded("update", [&] {
        if (gWin && gWin->isVisible()) pushLive();
        if (++n % 4 == 0 && gJs && gJs->ok() && gJs->call("isDirty") == "true") savePrefs();
    });
    return 0.5f;
}
}  // namespace

// ------------------------------------------------------------------ plugin entry points
PLUGIN_API int XPluginStart(char* outName, char* outSig, char* outDesc) {
    std::snprintf(outName, 256, "%s", kName);
    std::snprintf(outSig, 256, "%s", kSig);
    std::snprintf(outDesc, 256, "%s", "Flight computer calculators and airliner performance (take-off, NADP, landing, fuel) inside X-Plane.");
    XPLMEnableFeature("XPLM_USE_NATIVE_PATHS", 1);

    char path[1024] = {0};
    XPLMGetPluginInfo(XPLMGetMyID(), nullptr, path, nullptr, nullptr);
    gPluginDir = dirOf(dirOf(path).substr(0, dirOf(path).size() - 1));      // …/XPFlightComputer/64/win.xpl → …/XPFlightComputer/
    char prefs[1024] = {0};
    XPLMGetPrefsPath(prefs);
    gPrefsPath = dirOf(prefs) + "XPFlightComputer.json";

    gJs.reset(new JsHost());
    guarded("start", [&] {
        const std::vector<std::string> files = {"js/polyfill.js", "js/calc.js", "js/aircraft.js", "js/perf.js", "js/derive.js", "js/calculators.js", "js/xphost.js"};
        if (gJs->init(gPluginDir, files, logLine)) {
            std::string up;
            if (xpfc::readFile(gPluginDir + "user_profiles.json", up)) {
                std::string n = gJs->eval("String(XFC.aircraft.addUserProfiles(" + up + "))", "user_profiles.json");
                logf("user_profiles.json: " + (n.empty() ? std::string("could not be read — check the JSON") : n + " profile(s) added"));
            }
            std::string saved;
            if (xpfc::readFile(gPrefsPath, saved)) gJs->call("load", {saved});
            logf("version " + gJs->call("version") + " ready (" + gPluginDir + ")");
        } else {
            logf("could not start: " + gJs->error());
        }
    });

    gCmdToggle = XPLMCreateCommand("xpfc/window/toggle", "XP Flight Computer: show or hide the window");
    gCmdCalc = XPLMCreateCommand("xpfc/window/calculators", "XP Flight Computer: open the calculators");
    gCmdPerf = XPLMCreateCommand("xpfc/window/performance", "XP Flight Computer: open airliner performance");
    XPLMRegisterCommandHandler(gCmdToggle, commandCB, 1, (void*)(intptr_t)-1);
    XPLMRegisterCommandHandler(gCmdCalc, commandCB, 1, (void*)(intptr_t)FlightComputerWindow::TabCalc);
    XPLMRegisterCommandHandler(gCmdPerf, commandCB, 1, (void*)(intptr_t)FlightComputerWindow::TabPerf);

    int item = XPLMAppendMenuItem(XPLMFindPluginsMenu(), kName, nullptr, 0);
    gMenu = XPLMCreateMenu(kName, XPLMFindPluginsMenu(), item, menuCB, nullptr);
    XPLMAppendMenuItemWithCommand(gMenu, "Show / hide", gCmdToggle);
    XPLMAppendMenuItemWithCommand(gMenu, "Calculators", gCmdCalc);
    XPLMAppendMenuItemWithCommand(gMenu, "Performance", gCmdPerf);
    XPLMAppendMenuSeparator(gMenu);
    XPLMAppendMenuItem(gMenu, "Pop out into its own window", (void*)(intptr_t)1, 0);
    XPLMAppendMenuItem(gMenu, "Move into the VR headset", (void*)(intptr_t)2, 0);
    XPLMAppendMenuItem(gMenu, "Reset window position", (void*)(intptr_t)3, 0);
    return 1;
}

PLUGIN_API void XPluginStop(void) {
    guarded("save", [] { savePrefs(); });
    XPLMUnregisterCommandHandler(gCmdToggle, commandCB, 1, (void*)(intptr_t)-1);
    XPLMUnregisterCommandHandler(gCmdCalc, commandCB, 1, (void*)(intptr_t)FlightComputerWindow::TabCalc);
    XPLMUnregisterCommandHandler(gCmdPerf, commandCB, 1, (void*)(intptr_t)FlightComputerWindow::TabPerf);
    if (gMenu) { XPLMDestroyMenu(gMenu); gMenu = nullptr; }
    gWin.reset();
    gJs.reset();
}

PLUGIN_API int XPluginEnable(void) {
    XPLMCreateFlightLoop_t fl;
    fl.structSize = sizeof(fl);
    fl.phase = xplm_FlightLoop_Phase_AfterFlightModel;
    fl.callbackFunc = loopCB;
    fl.refcon = nullptr;
    gLoop = XPLMCreateFlightLoop(&fl);
    XPLMScheduleFlightLoop(gLoop, 1.0f, 1);
    return 1;
}

PLUGIN_API void XPluginDisable(void) {
    if (gLoop) { XPLMDestroyFlightLoop(gLoop); gLoop = nullptr; }
    guarded("save", [] { savePrefs(); });
    gWin.reset();
}

PLUGIN_API void XPluginReceiveMessage(XPLMPluginID, int msg, void* param) {
    if (msg == XPLM_MSG_PLANE_LOADED && param == nullptr && gWin && gWin->isVisible()) guarded("aircraft", [] { pushLive(); });
}
