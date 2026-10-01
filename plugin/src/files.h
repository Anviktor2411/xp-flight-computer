// XP Flight Computer — small file helpers. Paths are UTF-8 (X-Plane native paths); on Windows they are
// converted to UTF-16 so folders with non-English names work.
#pragma once
#include <string>

namespace xpfc {
bool readFile(const std::string& path, std::string& out);
bool fileExists(const std::string& path);
/** Write through a temporary file and swap it in, so a crash never leaves half a file behind. */
bool writeFileAtomic(const std::string& path, const std::string& data);
}  // namespace xpfc
