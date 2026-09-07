#include "storage_test_platform.h"
#include <ArduinoJson.h>
#include <cassert>
#include <cmath>
#include <ctime>
#include <vector>
#include <atomic>

using std::max;
template <typename T> T constrain(T value, T lo, T hi) { return min(max(value, lo), hi); }
using byte = unsigned char;
static uint32_t &clockMs = fakeMillis;
#define LOG_INFO(...) ((void)0)
#define LOG_WARN(...) ((void)0)
#define LOG_ERROR(...) ((void)0)
#include "config.h"
#include "animations.h"
AppConfig gConfig{};
constexpr size_t CONFIG_JSON_CAPACITY = 4096;

class WiFiClient {
public:
    bool stopped = false;
    virtual int available() { return stopped ? 0 : 1; }
    void stop() { stopped = true; }
};

struct IPAddress {
    uint32_t value = 0;
    IPAddress() = default;
    explicit IPAddress(uint32_t raw) : value(raw) {}
};
struct ip_addr_t { uint32_t value; };
#define IP_IS_V4(value) true
#define ip_2_ip4(value) value
uint32_t ip4_addr_get_u32(const ip_addr_t *value) { return value->value; }
using err_t = int;
constexpr int ERR_OK = 0, ERR_INPROGRESS = 1;
static int dnsQueries = 0;
err_t dns_gethostbyname(const char*, ip_addr_t*, void (*)(const char*, const ip_addr_t*, void*), void*) {
    ++dnsQueries;
    return ERR_INPROGRESS;
}

static int nacks = 0;
static std::vector<std::string> processed;
struct SerialInput {
    std::string bytes;
    size_t offset = 0;
    int available() { return static_cast<int>(bytes.size() - offset); }
    int read() { return offset < bytes.size() ? (uint8_t)bytes[offset++] : -1; }
    void set(std::string value) { bytes = std::move(value); offset = 0; }
} console;
#define CONSOLE_PORT console

namespace platform_audio {
    unsigned frequency = 0;
    unsigned notesStarted = 0;
    void initBuzzerPin() {}
    void playTone(uint16_t value) { frequency = value; ++notesStarted; }
    void stopTone() { frequency = 0; }
}

#include "runtime_under_test.h"

static void deliver(std::string payload) {
    _mqttCallback(nullptr, reinterpret_cast<byte*>(&payload[0]), static_cast<unsigned>(payload.size()));
}

static std::string allStates(const char *value) {
    std::string result = "[";
    for (int i = 0; i < REGIONS_COUNT; ++i) {
        if (i) result += ',';
        result += value;
    }
    return result + ']';
}

int main() {
    static_assert(sizeof(void*) == 4, "Run in 32-bit mode to match MCU JSON capacities");

    // Whole-packet time budget remains bounded even when the broker keeps
    // supplying bytes. Check the deadline across 32-bit millis rollover too.
    MqttWiFiClient client;
    clockMs = 0xFFFFFF00UL;
    client.beginOperation();
    clockMs += 1499;
    assert(client.available() == 1 && !client.stopped);
    ++clockMs;
    assert(client.available() == 0 && client.stopped);
    client.endOperation();

    // A DNS result from a superseded broker must not become the cached address
    // for the new broker, and pending queries must not duplicate/reuse storage.
    clockMs = 100;
    std::strcpy(gConfig.mqttHost, "old.example");
    _mqttResolveHost(clockMs);
    _mqttResolveHost(clockMs);
    assert(dnsQueries == 1 && !_mqttHasResolvedIp);
    std::strcpy(gConfig.mqttHost, "new.example");
    _mqttDnsAttempted = false; // alertsReloadClientConfig resets this on save.
    _mqttResolveHost(clockMs);
    assert(dnsQueries == 1);
    const ip_addr_t oldAddress{0x01020304}, newAddress{0x05060708};
    _mqttDnsFound(nullptr, &oldAddress, nullptr);
    _mqttResolveHost(clockMs);
    assert(dnsQueries == 2 && !_mqttHasResolvedIp);
    _mqttDnsFound(nullptr, &newAddress, nullptr);
    _mqttResolveHost(clockMs);
    assert(_mqttHasResolvedIp && _mqttResolvedIp.value == newAddress.value && dnsQueries == 2);

    // A partial or malformed broker payload must never clear retained alarms.
    deliver(allStates("1"));
    assert(gFetchOk && gMqttMessagesReceived == 1);
    for (bool state : gMqttAlerts) assert(state);
    deliver("[]");
    deliver("[0,0]");
    deliver(allStates("2"));
    deliver(allStates("\"false\""));
    deliver("broken");
    assert(gFetchOk && gMqttMessagesReceived == 1 && gMqttPayloadErrors == 5);
    for (bool state : gMqttAlerts) assert(state);

    // Full snapshot, state transitions beyond the old 256-byte capacity, and
    // no recurring flash writes for unchanged retained/heartbeat messages.
    _mqttSnapshotTick(clockMs);
    assert(_mqttSnapshotSaved && !_mqttSnapshotDirty);
    const auto goodSnapshot = files.at(MQTT_SNAPSHOT_PATH);
    StaticJsonDocument<MQTT_SNAPSHOT_DOC_CAPACITY> snapshot;
    assert(deserializeJson(snapshot, goodSnapshot) == DeserializationError::Ok);
    assert(snapshot["states"].size() == REGIONS_COUNT);
    const int initialMutations = faults.operations;
    deliver(allStates("true"));
    clockMs += 60000;
    _mqttSnapshotTick(clockMs);
    assert(faults.operations == initialMutations);
    deliver(allStates("0"));
    _mqttSnapshotTick(clockMs);
    const int changedMutations = faults.operations;
    assert(changedMutations > initialMutations);
    deliver(allStates("1"));
    _mqttSnapshotTick(++clockMs);
    assert(faults.operations == changedMutations && _mqttSnapshotDirty);
    clockMs += 60000;
    _mqttSnapshotTick(clockMs);
    assert(!_mqttSnapshotDirty && faults.operations > changedMutations);

    // Every power cut during replacement retains either the old or new complete
    // snapshot. The adapter's rename is atomic, matching LittleFS semantics.
    files[MQTT_SNAPSHOT_PATH] = goodSnapshot;
    memset(gMqttAlerts, 0, sizeof(gMqttAlerts));
    faults = {};
    assert(_saveMqttSnapshot());
    const int snapshotOperations = faults.operations;
    const auto newSnapshot = files.at(MQTT_SNAPSHOT_PATH);
    for (int cut = 1; cut <= snapshotOperations; ++cut) {
        files.clear();
        files[MQTT_SNAPSHOT_PATH] = goodSnapshot;
        faults = {};
        faults.cutAfter = cut;
        try { _saveMqttSnapshot(); } catch (const PowerCut&) {}
        assert(files.at(MQTT_SNAPSHOT_PATH) == goodSnapshot || files.at(MQTT_SNAPSHOT_PATH) == newSnapshot);
    }
    faults = {};
    files[MQTT_SNAPSHOT_PATH] = "{\"states\":[true],\"ts\":1}";
    assert(!_loadMqttSnapshot());
    files[MQTT_SNAPSHOT_PATH] = goodSnapshot;
    assert(_loadMqttSnapshot());
    for (bool state : gMqttAlerts) assert(state);

    // Rebuilding a test/MQTT state twice before the buzzer runs preserves edge.
    gAlertsChanged = false;
    memset(gAlerts, 0, sizeof(gAlerts));
    _rebuildEffectiveAlerts();
    _rebuildEffectiveAlerts();
    assert(gAlertsChanged && !gPrevAlerts[0] && gAlerts[0]);

    // All input bytes count against UART budget, including CR; an overflowing
    // line's suffix is discarded until newline, never treated as a command.
    uartcfg::init();
    console.set(std::string(10000, '\r'));
    uartcfg::handle();
    assert(console.offset == uartcfg::UART_READ_BUDGET_PER_TICK);
    console.set(std::string(uartcfg::UART_LINE_MAX + 50, 'x') + "cmd=wifi_set\nvalid\n");
    while (console.available()) uartcfg::handle();
    assert(nacks == 1 && processed.size() == 1 && processed[0] == "valid");
    processed.clear();
    console.set("one\ntwo\n");
    uartcfg::handle();
    assert(processed.size() == 1 && console.available());
    uartcfg::handle();
    assert(processed.size() == 2);

    // Timeouts also work for sessions that started at uptime zero or cross the
    // 32-bit millis rollover; validated by the actual receive loop.
    uartcfg::init();
    clockMs = 0;
    console.set("partial");
    uartcfg::handle();
    clockMs = uartcfg::UART_LINE_TIMEOUT_MS + 1;
    uartcfg::handle();
    assert(uartcfg::gState.lineLen == 0);
    uartcfg::gState.receivingConfig = true;
    uartcfg::gState.lastChunkAt = 0xFFFFFF00UL;
    clockMs = 16000;
    uartcfg::handle();
    assert(!uartcfg::gState.receivingConfig);

    // Flag color mixing obeys alpha caps, including fully dark endpoints.
    AnimationConfig flag{ANIM_FLAG, 5, 100, 4, 15, true};
    for (unsigned t = 0; t < 10000; t += 67) {
        const uint32_t color = animationColor(flag, 2, 25, t, {255,255,255,15}, {255,255,255,0});
        assert(((color >> 16) & 255) <= 15 && ((color >> 8) & 255) <= 15 && (color & 255) <= 15);
        assert(animationColor(flag, 2, 25, t, {255,255,255,0}, {255,255,255,0}) == 0);
    }
    flag.enabled = false;
    assert(animationColor(flag, 2, 25, 5000, {255,0,0,15}, {0,255,0,15}) == 0x0F0000);

    // Every note plays for its own duration, including the final note.
    gConfig.buzzer.enabled = false;
    clockMs = 0;
    buzzerPlay(true);
    buzzerHandle();
    for (int note = 0; note < ALERT_NOTES; ++note) {
        assert(gPlaying && platform_audio::frequency == (unsigned)ALERT_MELODY[note]);
        clockMs += ALERT_DURATIONS[note] - 1;
        buzzerHandle();
        assert(gPlaying && platform_audio::frequency == (unsigned)ALERT_MELODY[note]);
        ++clockMs;
        buzzerHandle();
    }
    assert(!gPlaying && platform_audio::frequency == 0 && platform_audio::notesStarted == ALERT_NOTES);
    std::printf("PASS runtime regressions: MQTT packet deadline/DNS/validation/snapshot (%d power cuts), UART budget/timeouts, brightness, buzzer\n", snapshotOperations);
}
