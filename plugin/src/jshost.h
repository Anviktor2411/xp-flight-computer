// XP Flight Computer — the embedded JavaScript engine (QuickJS) that runs the app's calculation code.
#pragma once
#include <chrono>
#include <initializer_list>
#include <string>
#include <vector>

struct JSRuntime;
struct JSContext;

class JsHost {
public:
    JsHost() = default;
    ~JsHost();
    JsHost(const JsHost&) = delete;
    JsHost& operator=(const JsHost&) = delete;

    /** Load the script files in order from dir (js/...). Returns false and sets error() if any fails. */
    bool init(const std::string& dir, const std::vector<std::string>& files, void (*log)(const char*));
    /** Run a snippet of JavaScript; returns its value as a string. */
    std::string eval(const std::string& code, const char* name = "<plugin>");
    /** Call XFCHost[fn](args...) with string arguments; returns the result as a string ("" on error). */
    std::string call(const char* fn, std::initializer_list<std::string> args = {});
    bool ok() const { return ctx_ != nullptr && error_.empty(); }
    const std::string& error() const { return error_; }
    const std::string& lastCallError() const { return callError_; }

private:
    static int interruptCB(JSRuntime*, void* opaque);
    void begin(double seconds);
    std::string takeException();
    void logOnce(const std::string& msg);
    JSRuntime* rt_ = nullptr;
    JSContext* ctx_ = nullptr;
    std::string error_, callError_, lastLogged_;
    std::chrono::steady_clock::time_point deadline_{};
};
