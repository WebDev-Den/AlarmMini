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
constexpr size_t CONFIG_JSON_CAPACITY = 6144;
struct Pixels {
    uint32_t colors[MAX_LEDS]{};
    void setPixelColor(int index, uint32_t color) { colors[index] = color; }
} strip;
void ledsShowIfChanged() {}

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

#include "fallback_http.h"
static bool reserveBusy = false, reserveReady = false;
static int reserveStarted = 0;
static FallbackHttpResult reserveResponse;
static std::string reserveToken;
bool fallbackHttpBusy() { return reserveBusy; }
bool fallbackHttpStart(const char *url, const char *token, uint32_t generation) {
    ++reserveStarted;
    reserveBusy = true;
    snprintf(reserveResponse.url, sizeof(reserveResponse.url), "%s", url);
    reserveToken = token;
    reserveResponse.generation = generation;
    return true;
}
bool fallbackHttpTakeResult(FallbackHttpResult &out) {
    if (!reserveReady) return false;
    out = reserveResponse;
    reserveReady = reserveBusy = false;
    return true;
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
    deliver(allStates("256"));
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

    // Repeated MQTT messages preserve the transition timestamp.
    memset(gAlerts, 0, sizeof(gAlerts));
    _rebuildEffectiveAlerts();
    assert(gAlertsChanged && gAlerts[0] == 1);
    const auto changedAt = gRegionStateChangedAt[0];
    ++clockMs;
    _rebuildEffectiveAlerts();
    assert(!gAlertsChanged && gRegionStateChangedAt[0] == changedAt);

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

    // Reserve contract: exact region order, integer codes, no partial application.
    AlertState decoded[REGIONS_COUNT] = {};
    for (int selected = 0; selected < REGIONS_COUNT; ++selected) {
        auto payload = allStates("0");
        payload[1 + selected * 2] = '1';
        assert(fallbackContract::parseStates(payload.c_str(), decoded, REGIONS_COUNT));
        for (int i = 0; i < REGIONS_COUNT; ++i) assert(decoded[i] == (i == selected));
    }
    for (const auto &bad : {allStates("true"), allStates("256"), allStates("0.0"), allStates("-1"), allStates("01"), allStates("1e0"),
            allStates("0") + "x", std::string("[0,1]"), std::string("[]"), std::string("null"), std::string(""),
            allStates("0").substr(0, 49), allStates("0").substr(0, 50) + ",0]"}) {
        std::fill_n(decoded, REGIONS_COUNT, true);
        assert(!fallbackContract::parseStates(bad.c_str(), decoded, REGIONS_COUNT));
        for (bool v : decoded) assert(v);
    }
    assert(fallbackContract::validUrl("https://example.test/alerts.json"));
    assert(fallbackContract::validToken(std::string(511, 'x').c_str()));
    assert(!fallbackContract::validToken(std::string(512, 'x').c_str()));
    assert(!fallbackContract::validToken("Bearer secret"));
    assert(!fallbackContract::validToken("secret\r\nX-Injected: value"));
    for (const char *bad : {"ftp://host/x", "https:///x", "http://user:pass@host/x", "http://host/x#fragment", "http://host/\r\ninjected"})
        assert(!fallbackContract::validUrl(bad));

    // Exercise the production failover coordinator, including late HTTP replies.
    clockMs = 100000;
    WiFi.state = WL_CONNECTED;
    gMqttConnected = true;
    gLastMqttMessageAt = clockMs;
    gUsingFallbackSnapshot = false;
    strcpy(gConfig.fallbackUrl, "http://reserve.test/alerts");
    alertsFallbackTick();
    assert(reserveStarted == 0); // MQTT wins while fresh.
    gMqttConnected = false;
    alertsFallbackTick();
    assert(reserveStarted == 1 && reserveBusy);
    reserveResponse.status = 200;
    strcpy(reserveResponse.body, allStates("1").c_str());
    reserveReady = true;
    alertsFallbackTick();
    assert(gUsingHttpFallback && alertsDataFresh());
    gMqttConnected = true;
    assert(!alertsMqttFresh(clockMs)); // Reconnection alone is not a new payload.
    gMqttConnected = false;
    for (bool v : gMqttAlerts) assert(v);
    clockMs += 20000;
    alertsFallbackTick();
    assert(reserveStarted == 1 && !reserveBusy);
    clockMs += 9999;
    alertsFallbackTick();
    assert(reserveStarted == 1 && !reserveBusy);
    ++clockMs;
    alertsFallbackTick();
    assert(reserveStarted == 2);
    reserveResponse.status = 503;
    reserveReady = true;
    alertsFallbackTick();
    assert(gFallbackErrors == 1);
    for (bool v : gMqttAlerts) assert(v); // HTTP error never clears alerts.
    clockMs += 30000;
    alertsFallbackTick();
    reserveResponse.status = 200;
    strcpy(reserveResponse.body, "[0,1]");
    reserveReady = true;
    alertsFallbackTick();
    assert(gFallbackErrors == 2);
    for (bool v : gMqttAlerts) assert(v);
    clockMs += 30000;
    alertsFallbackTick();
    gMqttConnected = true;
    deliver(allStates("0"));
    strcpy(reserveResponse.body, allStates("1").c_str());
    reserveReady = true;
    alertsFallbackTick();
    assert(!gUsingHttpFallback);
    for (bool v : gMqttAlerts) assert(!v); // Late reserve cannot overwrite MQTT.
    clockMs += fallbackContract::FRESH_MS + 1;
    alertsFallbackTick();
    assert(reserveBusy); // Connected broker without payloads also activates reserve.
    strcpy(gConfig.fallbackToken, "new-test-token");
    reserveResponse.status = 200;
    strcpy(reserveResponse.body, allStates("1").c_str());
    reserveReady = true;
    alertsFallbackTick();
    for (bool v : gMqttAlerts) assert(!v); // Previous credential's reply is stale.
    assert(reserveToken == "new-test-token" && reserveBusy);
    strcpy(gConfig.fallbackUrl, "http://other.test/alerts");
    reserveReady = true;
    alertsFallbackTick();
    for (bool v : gMqttAlerts) assert(!v); // Old URL result ignored.
    gConfig.fallbackUrl[0] = 0;
    reserveReady = true;
    alertsFallbackTick();
    assert(!alertsDataFresh());

    // Numeric codes survive MQTT, HTTP, snapshots and source changes.
    for (const char *code : {"2", "3", "4", "10", "255"}) {
        deliver(allStates(code));
        for (AlertState state : gAlerts) assert(state == std::atoi(code));
        assert(fallbackContract::parseStates(allStates(code).c_str(), decoded, REGIONS_COUNT));
        for (AlertState state : decoded) assert(state == std::atoi(code));
        assert(_saveMqttSnapshot());
        memset(gMqttAlerts, 0, sizeof(gMqttAlerts));
        assert(_loadMqttSnapshot());
        for (AlertState state : gAlerts) assert(state == std::atoi(code));
    }
    files[MQTT_SNAPSHOT_PATH] = "{\"states\":" + allStates("true") + ",\"ts\":1}";
    assert(_loadMqttSnapshot());
    for (AlertState state : gAlerts) assert(state == 1); // Pre-2.1.0 boolean snapshots.
    deliver(allStates("4"));
    const auto received = gMqttMessagesReceived;
    for (const char *bad : {"-1", "256", "1.5", "null", "\"2\""}) deliver(allStates(bad));
    assert(gMqttMessagesReceived == received);
    for (AlertState state : gAlerts) assert(state == 4);
    strcpy(gConfig.fallbackUrl, "http://reserve.test/multistate");
    gMqttConnected = false;
    alertsFallbackTick(); assert(reserveBusy);
    reserveResponse.status = 200;
    strcpy(reserveResponse.body, allStates("255").c_str()); reserveReady = true;
    alertsFallbackTick();
    assert(gUsingHttpFallback);
    for (AlertState state : gAlerts) assert(state == 255);
    gMqttConnected = true; deliver(allStates("3"));
    assert(!gUsingHttpFallback);
    for (AlertState state : gAlerts) assert(state == 3);

    // Settled live/retained rendering uses the numeric state's own color and caps.
    clockMs += ALERT_CLEAR_HOLD_MS + 1;
    gConfig.ledCount = 1; gConfig.ledRegion[0] = 0;
    gConfig.stateColorCount = 1;
    gConfig.stateColors[0] = {2, {0,255,0,255}, {0,0,255,80}};
    gConfig.dayMode.alertColor = {255,0,0,255};
    gConfig.night.maxBrightness = 30;
    gAlerts[0] = 2;
    renderAlertClearState(false); assert(strip.colors[0] == 0x00FF00);
    renderAlertClearState(true); assert(strip.colors[0] == 30);
    const auto offline = animationForState(MAP_STATE_MQTT_LOST);
    assert(retainedStateColorForLed(0, true, clockMs, offline, 1) == 15);
    gConfig.stateColors[0].night.a = 0;
    renderAlertClearState(true); assert(strip.colors[0] == 0);
    gAlerts[0] = 255;
    renderAlertClearState(false); assert(strip.colors[0] == 0xFF0000);

    // Real MQTT transitions, including extra -> extra, pulse the destination
    // color without restarting on repeated messages. Retained frames follow
    // the same transition and retain their stricter brightness cap.
    gConfig.dayMode.clearColor = {0,255,0,180};
    gConfig.nightMode.clearColor = {0,255,0,24};
    gConfig.nightMode.alertColor = {255,0,0,24};
    gConfig.night.maxBrightness = 30;
    gConfig.night.pulseOnAlert = gConfig.night.pulseOnClear = true;
    gConfig.stateColorCount = 4;
    gConfig.stateColors[0] = {2, {0,0,255,160}, {0,0,255,24}};
    gConfig.stateColors[1] = {3, {255,0,255,200}, {255,0,255,80}};
    gConfig.stateColors[2] = {4, {255,255,0,100}, {255,255,0,20}};
    gConfig.stateColors[3] = {5, {0,255,255,220}, {0,255,255,28}};
    auto within = [](uint32_t actual, uint32_t limit) {
        for (int shift : {0,8,16}) assert(((actual >> shift) & 255) <= ((limit >> shift) & 255));
    };
    for (const char *code : {"1","0","2","3","4","5","2","0","255"}) {
        clockMs += ALERT_CLEAR_HOLD_MS + 1;
        deliver(allStates(code));
        const auto started = gRegionStateChangedAt[0];
        assert(started == clockMs && gAlertsChanged);
        ++clockMs;
        deliver(allStates(code));
        assert(!gAlertsChanged && gRegionStateChangedAt[0] == started);
        for (bool night : {false,true}) {
            const Color target = colorForAlertState(gConfig, gAlerts[0], night);
            const auto liveLimit = applyColorBrightness(capColorForMode(target, night), 1.0f);
            const auto retainedLimit = applyColorBrightness(capColorForAnimation(target, offline, night), 1.0f);
            uint32_t previous = 0, retainedPrevious = 0;
            bool rose = false, fell = false, retainedRose = false, retainedFell = false;
            for (unsigned elapsed = 500; elapsed < 10000; elapsed += 41) {
                clockMs = started + elapsed;
                renderAlertClearState(night);
                const auto live = strip.colors[0];
                const auto retained = retainedStateColorForLed(0, night, clockMs, offline, 1);
                within(live, liveLimit); within(retained, retainedLimit);
                if (elapsed > 500) {
                    rose |= live > previous; fell |= live < previous;
                    retainedRose |= retained > retainedPrevious; retainedFell |= retained < retainedPrevious;
                }
                previous = live; retainedPrevious = retained;
            }
            assert(rose && fell && retainedRose && retainedFell);
            if (gAlerts[0] != 0) {
                clockMs = started + ALERT_CLEAR_HOLD_MS;
                renderAlertClearState(night); assert(strip.colors[0] == liveLimit);
                assert(retainedStateColorForLed(0, night, clockMs, offline, 1) == retainedLimit);
            }
        }
    }

    // An HTTP source change triggers the same effect, including between extras.
    assert(fallbackContract::parseStates(allStates("3").c_str(), decoded, REGIONS_COUNT));
    clockMs += ALERT_CLEAR_HOLD_MS + 1;
    _applyEffectiveAlerts(decoded);
    assert(gAlerts[0] == 3 && gRegionStateChangedAt[0] == clockMs);
    renderAlertClearState(false); const auto httpFirstFrame = strip.colors[0];
    clockMs += 600;
    renderAlertClearState(false); assert(strip.colors[0] != httpFirstFrame);

    // Night pulse-disabled mode still settles smoothly for extra states.
    gConfig.night.pulseOnAlert = false;
    const auto nightStarted = gRegionStateChangedAt[0];
    uint32_t previous = 0;
    for (unsigned elapsed = 0; elapsed <= ALERT_CLEAR_HOLD_MS; elapsed += 71) {
        clockMs = nightStarted + elapsed;
        renderAlertClearState(true);
        assert(strip.colors[0] >= previous);
        previous = strip.colors[0];
    }
    gConfig.stateColors[1].night.a = 0;
    renderAlertClearState(true); assert(strip.colors[0] == 0);
    std::puts("PASS multistate transitions: MQTT/HTTP, repeated packets, day/night pulses, 30s settle, retained caps, dark colors");
    std::printf("PASS runtime regressions: MQTT/DNS/snapshot (%d power cuts), UART, multistate MQTT/HTTP/rendering/legacy snapshot\n", snapshotOperations);
}
