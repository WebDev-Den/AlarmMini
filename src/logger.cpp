#include "logger.h"
#include <stdarg.h>
#include <stdio.h>

static LogEntry gLogEntries[LOG_BUFFER_SIZE];
static size_t gLogHead = 0;
static size_t gLogSize = 0;
static uint32_t gLogSequence = 0;
static uint16_t gLogMask = LOG_MASK_ALL;

struct LogCategoryMeta
{
    uint16_t bit;
    const char *key;
    const char *label;
};

static const LogCategoryMeta LOG_CATEGORY_META[] = {
    {LOG_CAT_SYSTEM, "system", "System"},
    {LOG_CAT_WIFI, "wifi", "Wi-Fi"},
    {LOG_CAT_INTERNET, "internet", "Internet"},
    {LOG_CAT_MQTT, "mqtt", "MQTT"},
    {LOG_CAT_WEB, "web", "Web"},
    {LOG_CAT_CONFIG, "config", "Config"},
    {LOG_CAT_CALIBRATION, "calibration", "Calibration"},
    {LOG_CAT_TEST, "test", "Tests"},
};

static const char *logLevelLabel(uint8_t level)
{
    switch (level)
    {
    case LOG_LEVEL_WARN:
        return "WARN";
    case LOG_LEVEL_ERROR:
        return "ERROR";
    default:
        return "INFO";
    }
}

void loggerInit()
{
    gLogHead = 0;
    gLogSize = 0;
    gLogSequence = 0;
    gLogMask = LOG_MASK_ALL;
}

void loggerSetMask(uint16_t mask)
{
    gLogMask = mask;
}

uint16_t loggerGetMask()
{
    return gLogMask;
}

bool loggerIsEnabled(uint16_t category)
{
    return (gLogMask & category) != 0;
}

void loggerClear()
{
    gLogHead = 0;
    gLogSize = 0;
}

size_t loggerCount()
{
    return gLogSize;
}

const char *loggerCategoryKey(uint16_t category)
{
    for (const auto &meta : LOG_CATEGORY_META)
        if (meta.bit == category)
            return meta.key;
    return "other";
}

const char *loggerCategoryLabel(uint16_t category)
{
    for (const auto &meta : LOG_CATEGORY_META)
        if (meta.bit == category)
            return meta.label;
    return "Other";
}

const char *loggerLevelKey(uint8_t level)
{
    switch (level)
    {
    case LOG_LEVEL_WARN:
        return "warn";
    case LOG_LEVEL_ERROR:
        return "error";
    default:
        return "info";
    }
}

void loggerWrite(uint8_t level, uint16_t category, const char *message)
{
    if (!loggerIsEnabled(category))
        return;

    char line[LOG_MESSAGE_LEN + 32];
    snprintf(line, sizeof(line), "[LOG][%s][%s] %s", loggerCategoryKey(category), logLevelLabel(level), message ? message : "");
    Serial.println(line);

    LogEntry &entry = gLogEntries[gLogHead];
    entry.seq = ++gLogSequence;
    entry.ms = millis();
    entry.level = level;
    entry.category = category;
    strncpy(entry.message, message ? message : "", LOG_MESSAGE_LEN - 1);
    entry.message[LOG_MESSAGE_LEN - 1] = '\0';

    gLogHead = (gLogHead + 1) % LOG_BUFFER_SIZE;
    if (gLogSize < LOG_BUFFER_SIZE)
        gLogSize++;
}

void loggerWritef(uint8_t level, uint16_t category, const char *fmt, ...)
{
    if (!loggerIsEnabled(category))
        return;

    char buffer[LOG_MESSAGE_LEN];
    va_list args;
    va_start(args, fmt);
    vsnprintf(buffer, sizeof(buffer), fmt, args);
    va_end(args);
    loggerWrite(level, category, buffer);
}

size_t loggerExportJson(JsonArray out, size_t limit)
{
    size_t exported = 0;
    size_t count = gLogSize;
    if (limit && limit < count)
        count = limit;

    for (size_t i = 0; i < count; i++)
    {
        const size_t index = (gLogHead + LOG_BUFFER_SIZE - 1 - i) % LOG_BUFFER_SIZE;
        const LogEntry &entry = gLogEntries[index];
        JsonObject item = out.createNestedObject();
        item["seq"] = entry.seq;
        item["ms"] = entry.ms;
        item["level"] = loggerLevelKey(entry.level);
        item["category"] = loggerCategoryKey(entry.category);
        item["message"] = entry.message;
        exported++;
    }
    return exported;
}

size_t loggerExportJson(JsonArray out)
{
    return loggerExportJson(out, 0);
}
