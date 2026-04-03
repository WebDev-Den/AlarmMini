#pragma once
#include <Arduino.h>
#include <ArduinoJson.h>

enum LogLevel : uint8_t
{
    LOG_LEVEL_INFO = 0,
    LOG_LEVEL_WARN,
    LOG_LEVEL_ERROR
};

enum LogCategory : uint16_t
{
    LOG_CAT_SYSTEM      = 1 << 0,
    LOG_CAT_WIFI        = 1 << 1,
    LOG_CAT_INTERNET    = 1 << 2,
    LOG_CAT_MQTT        = 1 << 3,
    LOG_CAT_WEB         = 1 << 4,
    LOG_CAT_CONFIG      = 1 << 5,
    LOG_CAT_CALIBRATION = 1 << 6,
    LOG_CAT_TEST        = 1 << 7,
};

constexpr uint16_t LOG_MASK_ALL = LOG_CAT_SYSTEM | LOG_CAT_WIFI | LOG_CAT_INTERNET |
                                  LOG_CAT_MQTT | LOG_CAT_WEB | LOG_CAT_CONFIG |
                                  LOG_CAT_CALIBRATION | LOG_CAT_TEST;

constexpr size_t LOG_MESSAGE_LEN = 112;
constexpr size_t LOG_BUFFER_SIZE = 80;

struct LogEntry
{
    uint32_t seq;
    unsigned long ms;
    uint8_t level;
    uint16_t category;
    char message[LOG_MESSAGE_LEN];
};

void loggerInit();
void loggerSetMask(uint16_t mask);
uint16_t loggerGetMask();
bool loggerIsEnabled(uint16_t category);
void loggerClear();
size_t loggerCount();
size_t loggerExportJson(JsonArray out);
size_t loggerExportJson(JsonArray out, size_t limit);
void loggerWrite(uint8_t level, uint16_t category, const char *message);
void loggerWritef(uint8_t level, uint16_t category, const char *fmt, ...);
const char *loggerCategoryKey(uint16_t category);
const char *loggerCategoryLabel(uint16_t category);
const char *loggerLevelKey(uint8_t level);

#define LOG_INFO(cat, fmt, ...) loggerWritef(LOG_LEVEL_INFO, cat, fmt, ##__VA_ARGS__)
#define LOG_WARN(cat, fmt, ...) loggerWritef(LOG_LEVEL_WARN, cat, fmt, ##__VA_ARGS__)
#define LOG_ERROR(cat, fmt, ...) loggerWritef(LOG_LEVEL_ERROR, cat, fmt, ##__VA_ARGS__)
