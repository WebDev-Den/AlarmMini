#pragma once
#include <ArduinoJson.h>
#include <stdint.h>
#include <string.h>
#include <time.h>

namespace tryvoha {
constexpr char URL[] = "https://tryvoha.online/api/v1/alerts";
constexpr size_t MAX_BODY = 65536;
constexpr unsigned MAX_AGE_SECONDS = 180;

// API slugs verified against /api/v1/regions; order is the firmware's 24 oblasts.
constexpr const char *SLUGS[] = {
    "vinnicka-oblast", "volinska-oblast", "dnipropetrovska", "donecka-oblast",
    "zitomirska-oblast", "zakarpatska-oblast", "zaporizka-oblast", "ivano-frankivska-oblast",
    "kyivska", "kirovogradska-oblast", "luganska-oblast", "lvivska", "mikolayivska-oblast",
    "odeska", "poltavska-oblast", "rivnenska-oblast", "sumska-oblast", "ternopilska-oblast",
    "xarkivska-oblast", "xersonska-oblast", "xmelnycka-oblast", "cerkaska-oblast",
    "cernivecka-oblast", "cernigivska-oblast"
};

inline int regionIndex(const char *slug) {
    if (!slug) return -1;
    for (unsigned i = 0; i < 24; ++i) if (strcmp(slug, SLUGS[i]) == 0) return int(i);
    if (strcmp(slug, "kyiv") == 0) return 8;
    if (strcmp(slug, "m-zaporizzia-ta-zaporizka-teritorialna-gromada") == 0) return 6;
    if (strcmp(slug, "m-xarkiv-ta-xarkivska-teritorialna-gromada") == 0) return 18;
    return -1;
}

inline time_t timestamp(const char *s) {
    if (!s || strlen(s) < 20) return 0;
    for (int i = 0; i < 19; ++i) {
        const char separator = i == 4 || i == 7 ? '-' : i == 10 ? 'T' : i == 13 || i == 16 ? ':' : 0;
        if (separator ? s[i] != separator : s[i] < '0' || s[i] > '9') return 0;
    }
    const char *tail = s + 19;
    if (*tail == '.') {
        ++tail;
        if (*tail < '0' || *tail > '9') return 0;
        while (*tail >= '0' && *tail <= '9') ++tail;
    }
    if (strcmp(tail, "Z") != 0) return 0;
    auto pair = [s](int i) { return (s[i] - '0') * 10 + s[i + 1] - '0'; };
    const int year = pair(0) * 100 + pair(2), month = pair(5), day = pair(8);
    const int hour = pair(11), minute = pair(14), second = pair(17);
    if (year < 2020 || year > 2037 || month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return 0;
    const unsigned monthDays[] = {31,28,31,30,31,30,31,31,30,31,30,31};
    const bool leap = year % 4 == 0;
    if (day < 1 || unsigned(day) > monthDays[month - 1] + (month == 2 && leap ? 1U : 0U)) return 0;
    uint32_t days = 0;
    for (int y = 1970; y < year; ++y) days += y % 4 == 0 ? 366 : 365;
    for (int m = 1; m < month; ++m) days += monthDays[m - 1] + (m == 2 && leap ? 1 : 0);
    return time_t((days + day - 1) * 86400UL + hour * 3600UL + minute * 60UL + second);
}

inline bool fresh(time_t updated, time_t now) {
    return updated > 0 && now >= 1700000000 && difftime(now, updated) <= MAX_AGE_SECONDS && difftime(updated, now) <= 30;
}

// Keep only one alert object in RAM; the complete response can exceed 30 KB.
// HTTPClient decodes chunk framing before sending bytes to this parser.
class Parser {
    char envelope[256] = {}, item[1024] = {};
    size_t envelopeSize = 0, itemSize = 0, bytes = 0;
    unsigned entries = 0, depth = 0;
    bool quoted = false, escaped = false, inArray = false, sawArray = false;
    bool needItem = false, afterItem = false, closed = false, failed = false;
    uint8_t levels[24] = {}, wholeLevels[24] = {};

    static bool space(char c) { return c == ' ' || c == '\r' || c == '\n' || c == '\t'; }
    void track(char c) {
        if (escaped) { escaped = false; return; }
        if (quoted && c == '\\') { escaped = true; return; }
        if (c == '"') quoted = !quoted;
        if (!quoted) {
            if (c == '{' || c == '[') ++depth;
            if (c == '}' || c == ']') { if (depth) --depth; else failed = true; }
        }
    }
    bool acceptItem() {
        StaticJsonDocument<768> doc;
        if (deserializeJson(doc, item, itemSize) || !doc.is<JsonObject>()) return false;
        const char *slug = doc["slug"], *type = doc["type"], *level = doc["level"];
        if (!slug || !*slug || !type || !level || (strcmp(level, "yellow") && strcmp(level, "red"))) return false;
        const char *region = nullptr;
        if (!strcmp(type, "state")) region = slug;
        else if (!strcmp(type, "district") || !strcmp(type, "community")) region = doc["oblast_slug"];
        else return false;
        const int index = regionIndex(region);
        if (index < 0 || ++entries > 300) return false;
        const uint8_t bit = strcmp(level, "red") == 0 ? 1 : 2;
        levels[index] |= bit;
        // City aliases share an oblast LED, but never imply whole-oblast coverage.
        if (!strcmp(type, "state") && !strcmp(slug, SLUGS[index])) wholeLevels[index] |= bit;
        return true;
    }
public:
    bool write(char c) {
        if (failed || !c || ++bytes > MAX_BODY) return false;
        if (inArray) {
            if (!itemSize) {
                if (space(c)) return true;
                if (c == ']' && !needItem) {
                    inArray = false;
                    depth = 1;
                    // The envelope retains an empty array for ordinary JSON validation.
                } else if (c == ',' && afterItem) {
                    afterItem = false; needItem = true; return true;
                } else if (c == '{' && !afterItem) {
                    item[itemSize++] = c; depth = 1; needItem = false; return true;
                } else return failed = true, false;
            } else {
                if (itemSize >= sizeof(item) - 1) return failed = true, false;
                item[itemSize++] = c;
                track(c);
                if (!depth) {
                    if (!acceptItem()) return failed = true, false;
                    itemSize = 0; afterItem = true;
                }
                return !failed;
            }
        } else {
            if (closed) return space(c) ? true : (failed = true, false);
            if (!quoted && c == '[') {
                if (depth != 1 || sawArray) return failed = true, false;
                sawArray = inArray = true;
                depth = 0;
            } else {
                track(c);
                if (!quoted && c == '}' && !depth) closed = true;
            }
        }
        if (envelopeSize >= sizeof(envelope) - 1) return failed = true, false;
        envelope[envelopeSize++] = c;
        return !failed;
    }

    bool finish(uint8_t *out, time_t now, time_t &updated) {
        if (failed || !closed || inArray || !sawArray) return false;
        StaticJsonDocument<384> doc;
        if (deserializeJson(doc, envelope, envelopeSize) || !doc.is<JsonObject>() ||
            !doc["alerts"].is<JsonArray>() || !doc["active"].is<unsigned>() ||
            doc["active"].as<unsigned>() != entries) return false;
        const time_t parsed = timestamp(doc["updated_at"]);
        if (!fresh(parsed, now)) return false;
        for (unsigned i = 0; i < 24; ++i) { // Crimea is not covered by this API.
            if (levels[i] == 3) out[i] = 3;
            else if (levels[i] == 1) out[i] = (wholeLevels[i] & 1) ? 1 : 4;
            else if (levels[i] == 2) out[i] = (wholeLevels[i] & 2) ? 2 : 5;
            else out[i] = 0;
        }
        updated = parsed;
        return true;
    }
};
}
