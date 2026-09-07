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
constexpr uint32_t TRACE_WRITE_INTERVAL_MS = 30000UL;

struct TraceState
{
    uint32_t bootCount;
    char reason[TRACE_REASON_MAX];
    char info[TRACE_INFO_MAX];
    char stage[TRACE_STAGE_MAX];
    uint32_t stageAtMs;
};

TraceState gTrace{};
bool gTraceDirty = false;
bool gBootLogPending = false;
uint32_t gLastTraceWriteMs = 0;

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

    const size_t expected = measureJson(doc);
    const size_t written = serializeJson(doc, tmp);
    tmp.flush();
    if (doc.overflowed() || written != expected || tmp.getWriteError())
    {
        tmp.close();
        LittleFS.remove(TRACE_TMP_PATH);
        return false;
    }

    tmp.close();
    // LittleFS rename replaces an existing file atomically. Unlinking first
    // loses the previous trace if power drops between these operations.
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
            bool copied = false;
            if (in && out)
            {
                const size_t skip = currentSize / 2;
                if (in.seek(skip, SeekSet))
                {
                    size_t remaining = currentSize - skip;
                    uint8_t buffer[128];
                    while (remaining)
                    {
                        const size_t count = in.read(buffer, min(remaining, sizeof(buffer)));
                        if (!count || out.write(buffer, count) != count)
                            break;
                        remaining -= count;
                        yield();
                    }
                    out.flush();
                    copied = remaining == 0 && !out.getWriteError();
                }
            }
            if (in)
                in.close();
            if (out)
                out.close();
            if (copied)
                LittleFS.rename("/reset_trace.cut", TRACE_LOG_PATH);
            else
                LittleFS.remove("/reset_trace.cut");
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
    // Power can bounce repeatedly at startup. Diagnostics must not add flash
    // writes to each short-lived boot before the supply has had time to settle.
    gTraceDirty = true;
    gBootLogPending = true;
    gLastTraceWriteMs = millis();
}

void resetTraceSetStage(const char *stage, bool persist)
{
    copyBounded(gTrace.stage, sizeof(gTrace.stage), stage ? stage : "unknown");
    gTrace.stageAtMs = millis();
    gTraceDirty = gTraceDirty || persist;
}

void resetTraceHandle()
{
    const uint32_t now = millis();
    if (!gTraceDirty || (uint32_t)(now - gLastTraceWriteMs) < TRACE_WRITE_INTERVAL_MS)
        return;

    // Limit retries as well as successful writes if the filesystem is failing.
    gLastTraceWriteMs = now;
    if (!saveTraceFile())
    {
        LOG_WARN(LOG_CAT_SYSTEM, "reset_trace: cannot persist stage '%s'", gTrace.stage);
        return;
    }
    gTraceDirty = false;
    if (gBootLogPending)
    {
        logBootRecord();
        gBootLogPending = false;
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
