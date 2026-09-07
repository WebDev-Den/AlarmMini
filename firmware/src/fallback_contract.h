#pragma once
#include <stddef.h>
#include <stdint.h>
#include <string.h>

namespace fallbackContract {
constexpr size_t URL_CAPACITY = 256;
constexpr size_t TOKEN_CAPACITY = 512;
constexpr size_t BODY_CAPACITY = 256;
constexpr uint32_t POLL_MS = 30000;
constexpr uint32_t FRESH_MS = 90000;

inline bool validToken(const char *token) {
    if (!token) return true;
    if (strlen(token) >= TOKEN_CAPACITY) return false;
    for (const unsigned char *p = (const unsigned char *)token; *p; ++p)
        if (*p < 33 || *p > 126) return false;
    return true;
}

inline bool validUrl(const char *url) {
    if (!url || !*url) return true; // Empty disables the reserve.
    if (strlen(url) >= URL_CAPACITY) return false;
    const char *host = nullptr;
    if (strncmp(url, "https://", 8) == 0) host = url + 8;
    else if (strncmp(url, "http://", 7) == 0) host = url + 7;
    else return false;
    if (!*host || *host == '/' || *host == '?' || *host == ':') return false;
    const char *end = host;
    while (*end && *end != '/' && *end != '?') ++end;
    const char *port = nullptr;
    for (const char *p = host; p < end; ++p) {
        if (*p == ':') { port = p + 1; break; }
        if (!((*p >= 'a' && *p <= 'z') || (*p >= 'A' && *p <= 'Z') ||
              (*p >= '0' && *p <= '9') || *p == '-' || *p == '.')) return false;
    }
    if (port) {
        if (port == end) return false;
        unsigned value = 0;
        for (const char *p = port; p < end; ++p) {
            if (*p < '0' || *p > '9') return false;
            value = value * 10 + unsigned(*p - '0');
            if (value > 65535) return false;
        }
        if (!value) return false;
    }
    bool authority = true;
    for (const unsigned char *p = (const unsigned char *)host; *p; ++p) {
        if (*p <= 32 || *p >= 127 || *p == '#' || *p == '\\') return false;
        if (*p == '/' || *p == '?') authority = false;
        if (authority && *p == '@') return false;
    }
    return true;
}

inline void skipSpace(const char *&p) {
    while (*p == ' ' || *p == '\t' || *p == '\r' || *p == '\n') ++p;
}

// Parse a complete JSON array. Never partially apply a malformed snapshot.
inline bool parseStates(const char *text, bool *states, size_t count) {
    if (!text || !states || count > 32) return false;
    bool parsed[32] = {};
    const char *p = text;
    skipSpace(p);
    if (*p++ != '[') return false;
    for (size_t i = 0; i < count; ++i) {
        skipSpace(p);
        if (*p != '0' && *p != '1') return false;
        parsed[i] = *p++ == '1';
        skipSpace(p);
        if (*p++ != (i + 1 == count ? ']' : ',')) return false;
    }
    skipSpace(p);
    if (*p) return false;
    memcpy(states, parsed, count * sizeof(bool));
    return true;
}
}
