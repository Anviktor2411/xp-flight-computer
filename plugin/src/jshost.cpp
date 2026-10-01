// XP Flight Computer — QuickJS wrapper. Loads the same calc/aircraft/perf/calculator scripts the web app
// uses, plus the plugin host (xphost.js), and calls into XFCHost with string arguments.
#include "jshost.h"
#include "files.h"
#include "quickjs.h"
#include <cstdio>
#include <cstring>

namespace {
void (*g_log)(const char*) = nullptr;

JSValue jsConsole(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
    std::string line = "XP Flight Computer (js): ";
    for (int i = 0; i < argc; i++) {
        const char* s = JS_ToCString(ctx, argv[i]);
        if (s) { if (i) line += ' '; line += s; JS_FreeCString(ctx, s); }
    }
    line += '\n';
    if (g_log) g_log(line.c_str());
    return JS_UNDEFINED;
}
}  // namespace

JsHost::~JsHost() {
    if (ctx_) JS_FreeContext(ctx_);
    if (rt_) JS_FreeRuntime(rt_);
}

// A script that runs away (a bug, or a loop that never converges) is stopped instead of freezing X-Plane.
int JsHost::interruptCB(JSRuntime*, void* opaque) {
    auto* self = static_cast<JsHost*>(opaque);
    return std::chrono::steady_clock::now() > self->deadline_ ? 1 : 0;
}

// Called before every entry into JavaScript. X-Plane calls the plugin from different stack depths (flight
// loop, drawing, menus), so the stack limit is measured from here each time.
void JsHost::begin(double seconds) {
    JS_UpdateStackTop(rt_);
    deadline_ = std::chrono::steady_clock::now() + std::chrono::milliseconds((long long)(seconds * 1000));
}

void JsHost::logOnce(const std::string& msg) {
    if (msg == lastLogged_) return;       // the window asks again every frame; say it once
    lastLogged_ = msg;
    if (g_log) g_log(("XP Flight Computer: " + msg + "\n").c_str());
}

std::string JsHost::takeException() {
    JSValue ex = JS_GetException(ctx_);
    std::string msg;
    const char* s = JS_ToCString(ctx_, ex);
    if (s) { msg = s; JS_FreeCString(ctx_, s); }
    if (JS_IsObject(ex)) {
        JSValue st = JS_GetPropertyStr(ctx_, ex, "stack");
        if (!JS_IsUndefined(st)) {
            const char* t = JS_ToCString(ctx_, st);
            if (t) { if (*t) { msg += "\n"; msg += t; } JS_FreeCString(ctx_, t); }
        }
        JS_FreeValue(ctx_, st);
    }
    JS_FreeValue(ctx_, ex);
    return msg.empty() ? std::string("unknown JavaScript error") : msg;
}

bool JsHost::init(const std::string& dir, const std::vector<std::string>& files, void (*log)(const char*)) {
    g_log = log;
    rt_ = JS_NewRuntime();
    if (!rt_) { error_ = "Could not start the JavaScript engine."; return false; }
    JS_SetMemoryLimit(rt_, 256u * 1024u * 1024u);
    JS_SetMaxStackSize(rt_, 512u * 1024u);
    JS_SetInterruptHandler(rt_, interruptCB, this);
    ctx_ = JS_NewContext(rt_);
    if (!ctx_) { error_ = "Could not create the JavaScript context."; return false; }
    begin(20.0);
    JSValue global = JS_GetGlobalObject(ctx_);
    JSValue console = JS_NewObject(ctx_);
    for (const char* name : {"log", "warn", "error", "info"})
        JS_SetPropertyStr(ctx_, console, name, JS_NewCFunction(ctx_, jsConsole, name, 1));
    JS_SetPropertyStr(ctx_, global, "console", console);
    JS_FreeValue(ctx_, global);
    for (const auto& f : files) {
        std::string src, path = dir + f;
        if (!xpfc::readFile(path, src)) { error_ = "Could not read " + path; return false; }
        begin(20.0);
        JSValue r = JS_Eval(ctx_, src.c_str(), src.size(), f.c_str(), JS_EVAL_TYPE_GLOBAL);
        if (JS_IsException(r)) { error_ = "Error in " + f + ": " + takeException(); return false; }
        JS_FreeValue(ctx_, r);
    }
    return true;
}

std::string JsHost::eval(const std::string& code, const char* name) {
    if (!ok()) return "";
    begin(5.0);
    JSValue r = JS_Eval(ctx_, code.c_str(), code.size(), name, JS_EVAL_TYPE_GLOBAL);
    std::string out;
    if (JS_IsException(r)) { callError_ = takeException(); logOnce(callError_); }
    else if (!JS_IsUndefined(r)) { const char* s = JS_ToCString(ctx_, r); if (s) { out = s; JS_FreeCString(ctx_, s); } }
    JS_FreeValue(ctx_, r);
    return out;
}

std::string JsHost::call(const char* fn, std::initializer_list<std::string> args) {
    if (!ok()) return "";
    begin(1.0);
    JSValue global = JS_GetGlobalObject(ctx_);
    JSValue host = JS_GetPropertyStr(ctx_, global, "XFCHost");
    JSValue func = JS_GetPropertyStr(ctx_, host, fn);
    std::string out;
    if (!JS_IsFunction(ctx_, func)) {
        callError_ = std::string("XFCHost.") + fn + " is not a function";
        logOnce(callError_);
    } else {
        JSValue argv[8];
        int argc = 0;
        for (const auto& a : args) { if (argc >= 8) break; argv[argc++] = JS_NewStringLen(ctx_, a.data(), a.size()); }
        JSValue r = JS_Call(ctx_, func, host, argc, argv);
        for (int i = 0; i < argc; i++) JS_FreeValue(ctx_, argv[i]);
        if (JS_IsException(r)) {
            callError_ = std::string("XFCHost.") + fn + ": " + takeException();
            logOnce(callError_);
        } else if (!JS_IsUndefined(r) && !JS_IsNull(r)) {
            const char* s = JS_ToCString(ctx_, r);
            if (s) { out = s; JS_FreeCString(ctx_, s); }
        }
        JS_FreeValue(ctx_, r);
    }
    JS_FreeValue(ctx_, func);
    JS_FreeValue(ctx_, host);
    JS_FreeValue(ctx_, global);
    return out;
}
