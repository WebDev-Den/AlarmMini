#include <cassert>
#include <iostream>
#include "reset_trace_under_test.cpp"

void loggerWritef(uint8_t, uint16_t, const char *, ...) {}

int main()
{
    resetTraceInit();
    resetTraceSetStage("storage_init");
    resetTraceSetStage("wifi_start");
    resetTraceSetStage("runtime");
    assert(faults.operations == 0);
    fakeMillis = 29999;
    resetTraceHandle();
    assert(faults.operations == 0);
    fakeMillis = 30000;
    resetTraceHandle();
    assert(files.count(TRACE_PATH) && files.count(TRACE_LOG_PATH));
    const int firstWrite = faults.operations;
    DynamicJsonDocument trace(1024);
    assert(!deserializeJson(trace, files.at(TRACE_PATH)));
    assert(std::string(trace["stage"].as<const char *>()) == "runtime");

    resetTraceSetStage("web_save");
    resetTraceSetStage("cfg_write_done", false);
    fakeMillis = 59999;
    resetTraceHandle();
    assert(faults.operations == firstWrite);
    fakeMillis = 60000;
    resetTraceHandle();
    assert(faults.operations > firstWrite);
    assert(!deserializeJson(trace, files.at(TRACE_PATH)));
    assert(std::string(trace["stage"].as<const char *>()) == "cfg_write_done");
    const std::string committed = files.at(TRACE_PATH);

    // A failed replacement keeps the committed trace and backs off retries.
    resetTraceSetStage("next_stage");
    faults.failRenameTo = TRACE_PATH;
    fakeMillis = 90000;
    resetTraceHandle();
    assert(files.at(TRACE_PATH) == committed);
    const int failedWrite = faults.operations;
    fakeMillis = 119999;
    resetTraceHandle();
    assert(faults.operations == failedWrite);
    faults.failRenameTo.clear();
    fakeMillis = 120000;
    resetTraceHandle();
    assert(files.at(TRACE_PATH) != committed);

    // Millis wrap does not bypass the 30-second quiet interval.
    fakeMillis = 0xfffffff0UL;
    resetTraceInit();
    const int beforeWrap = faults.operations;
    fakeMillis += 29999UL;
    resetTraceHandle();
    assert(faults.operations == beforeWrap);
    ++fakeMillis;
    resetTraceHandle();
    assert(faults.operations > beforeWrap);

    // Rotation failures never remove the log being rotated.
    faults = {};
    files[TRACE_LOG_PATH] = std::string(TRACE_LOG_MAX_BYTES + 100, 'x');
    const std::string originalLog = files.at(TRACE_LOG_PATH);
    faults.failOpenWrite = true;
    appendTraceLogLine("new");
    assert(files.at(TRACE_LOG_PATH) == originalLog + "new\n");
    faults = {};
    files[TRACE_LOG_PATH] = originalLog;
    appendTraceLogLine("new");
    assert(files.at(TRACE_LOG_PATH).size() == originalLog.size() - originalLog.size() / 2 + 4);

    std::cout << "PASS: reset trace quiet boot; stage coalescing; failed rename/backoff; "
                 "millis wrap; non-destructive log rotation\n";
}
