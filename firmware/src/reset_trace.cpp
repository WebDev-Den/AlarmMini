#include "reset_trace.h"
#include "platform_compat.h"

#include <LittleFS.h>

#include "logger.h"

namespace
{
constexpr char TRACE_PATH[] = "/reset_trace.json";
constexpr char TRACE_TMP_PATH[] = "/reset_trace.tmp";
constexpr char TRACE_LOG_PATH[] = "/reset_trace.log";
constexpr uint8_t TRACE_SCHEMA_VERSION = 1;
constexpr size_t TRACE_REASON_MAX = 96;
constexpr size_t TRACE_INFO_MAX = 224;
constexpr size_t TRACE_STAGE_MAX = 40;
constexpr size_t TRACE_LOG_MAX_BYTES = 8192;

struct TraceState
{
    uint32_t bootCount;
    char reason[TRACE_REASON_MAX];
    char info[TRACE_INFO_MAX];
    char stage[TRACE_STAGE_MAX];
    uint32_t stageAtMs;
};

TraceState gTrace{};

void copyBounded(char *dst, size_t size, const char *value)
{
    if (!dst || size == 0)
        return;
    strncpy(dst, value ? value : "", size - 1);
    dst[size - 1] = '\0';
}

bool saveTraceFile()
{
    StaticJsonDocument<512> doc;
    doc["v"] = TRACE_SCHEMA_VERSION;
    doc["bootCount"] = gTrace.bootCount;
    doc["resetReason"] = gTrace.reason;
    doc["resetInfo"] = gTrace.info;
    doc["stage"] = gTrace.stage;
    doc["stageAtMs"] = gTrace.stageAtMs;

    File tmp = LittleFS.open(TRACE_TMP_PATH, "w");
    if (!tmp)
        return false;

    if (serializeJson(doc, tmp) == 0 || tmp.getWriteError())
    {
        tmp.close();
        LittleFS.remove(TRACE_TMP_PATH);
        return false;
    }

    tmp.flush();
    tmp.close();
    LittleFS.remove(TRACE_PATH);
    return LittleFS.rename(TRACE_TMP_PATH, TRACE_PATH);
}

void appendTraceLogLine(const char *line)
{
    if (!line || !line[0])
        return;

    if (LittleFS.exists(TRACE_LOG_PATH))
    {
        File existing = LittleFS.open(TRACE_LOG_PATH, "r");
        const size_t currentSize = existing ? existing.size() : 0;
        if (existing)
            existing.close();

        if (currentSize > TRACE_LOG_MAX_BYTES)
        {
            File in = LittleFS.open(TRACE_LOG_PATH, "r");
            File out = LittleFS.open("/reset_trace.cut", "w");
            if (in && out)
            {
                const size_t skip = currentSize / 2;
                in.seek(skip, SeekSet);
                while (in.available())
                    out.write((uint8_t)in.read());
            }
            if (in)
                in.close();
            if (out)
                out.close();
            LittleFS.remove(TRACE_LOG_PATH);
            LittleFS.rename("/reset_trace.cut", TRACE_LOG_PATH);
        }
    }

    File logFile = LittleFS.open(TRACE_LOG_PATH, "a");
    if (!logFile)
        return;

    logFile.print(line);
    logFile.print('\n');
    logFile.close();
}

void logBootRecord()
{
    char line[400];
    snprintf(line, sizeof(line),
             "{\"boot\":%lu,\"reason\":\"%s\",\"stage\":\"%s\",\"ip\":\"%s\"}",
             (unsigned long)gTrace.bootCount,
             gTrace.reason,
             gTrace.stage,
             WiFi.localIP().toString().c_str());
    appendTraceLogLine(line);
}

} // namespace

void resetTraceInit()
{
    memset(&gTrace, 0, sizeof(gTrace));
    copyBounded(gTrace.reason, sizeof(gTrace.reason), platformResetReason().c_str());
    copyBounded(gTrace.info, sizeof(gTrace.info), platformResetInfo().c_str());
    copyBounded(gTrace.stage, sizeof(gTrace.stage), "boot_init");
    gTrace.stageAtMs = millis();

    if (LittleFS.exists(TRACE_PATH))
    {
        StaticJsonDocument<512> saved;
        File f = LittleFS.open(TRACE_PATH, "r");
        if (f)
        {
            const DeserializationError err = deserializeJson(saved, f);
            f.close();
            if (!err)
            {
                gTrace.bootCount = saved["bootCount"] | 0UL;
            }
        }
    }

    gTrace.bootCount += 1UL;

    if (!saveTraceFile())
    {
        LOG_WARN(LOG_CAT_SYSTEM, "reset_trace: cannot persist initial trace");
    }
    logBootRecord();
}

void resetTraceSetStage(const char *stage, bool persist)
{
    copyBounded(gTrace.stage, sizeof(gTrace.stage), stage ? stage : "unknown");
    gTrace.stageAtMs = millis();
    if (persist)
    {
        if (!saveTraceFile())
            LOG_WARN(LOG_CAT_SYSTEM, "reset_trace: cannot persist stage '%s'", gTrace.stage);
    }
}

const char *resetTraceReason()
{
    return gTrace.reason;
}

const char *resetTraceInfo()
{
    return gTrace.info;
}

const char *resetTraceStage()
{
    return gTrace.stage;
}

uint32_t resetTraceBootCount()
{
    return gTrace.bootCount;
}

void resetTraceFillHealth(JsonDocument &doc)
{
    doc["resetReason"] = gTrace.reason;
    doc["resetInfo"] = gTrace.info;
    doc["bootCount"] = gTrace.bootCount;
    doc["lastStage"] = gTrace.stage;
    doc["lastStageMs"] = gTrace.stageAtMs;
}
