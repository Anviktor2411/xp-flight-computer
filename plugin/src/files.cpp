// XP Flight Computer — file helpers. See files.h.
#include "files.h"
#include <cstdio>

#if IBM
#include <windows.h>
#endif

namespace xpfc {
namespace {
#if IBM
std::wstring wide(const std::string& s) {
    int n = MultiByteToWideChar(CP_UTF8, 0, s.c_str(), -1, nullptr, 0);
    if (n <= 0) return std::wstring();
    std::wstring w((size_t)n, L'\0');
    MultiByteToWideChar(CP_UTF8, 0, s.c_str(), -1, &w[0], n);
    w.resize((size_t)n - 1);
    return w;
}
FILE* openFile(const std::string& path, const wchar_t* mode) { return _wfopen(wide(path).c_str(), mode); }
#else
FILE* openFile(const std::string& path, const char* mode) { return std::fopen(path.c_str(), mode); }
#endif
}  // namespace

bool readFile(const std::string& path, std::string& out) {
#if IBM
    FILE* f = openFile(path, L"rb");
#else
    FILE* f = openFile(path, "rb");
#endif
    if (!f) return false;
    out.clear();
    char buf[16384];
    size_t n;
    while ((n = std::fread(buf, 1, sizeof buf, f)) > 0) out.append(buf, n);
    const bool ok = !std::ferror(f);
    std::fclose(f);
    return ok;
}

bool fileExists(const std::string& path) {
#if IBM
    FILE* f = openFile(path, L"rb");
#else
    FILE* f = openFile(path, "rb");
#endif
    if (!f) return false;
    std::fclose(f);
    return true;
}

bool writeFileAtomic(const std::string& path, const std::string& data) {
    const std::string tmp = path + ".tmp";
#if IBM
    FILE* f = openFile(tmp, L"wb");
#else
    FILE* f = openFile(tmp, "wb");
#endif
    if (!f) return false;
    bool ok = std::fwrite(data.data(), 1, data.size(), f) == data.size();
    ok = (std::fflush(f) == 0) && ok;
    ok = (std::fclose(f) == 0) && ok;
    if (!ok) return false;
#if IBM
    return MoveFileExW(wide(tmp).c_str(), wide(path).c_str(), MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH) != 0;
#else
    return std::rename(tmp.c_str(), path.c_str()) == 0;
#endif
}
}  // namespace xpfc
