#include <cassert>
#include <sstream>
#include <vector>
#include "storage_test_platform.h"
#include <ArduinoJson.h>
#include <cstdlib>

static size_t liveJsonBytes = 0, peakJsonBytes = 0;
struct TrackedAllocator {
    void* allocate(size_t bytes) {
        auto* block = static_cast<size_t*>(std::malloc(bytes + sizeof(size_t)));
        if (!block) return nullptr;
        *block = bytes;
        liveJsonBytes += bytes;
        peakJsonBytes = std::max(peakJsonBytes, liveJsonBytes);
        return block + 1;
    }
    void deallocate(void* ptr) {
        if (!ptr) return;
        auto* block = static_cast<size_t*>(ptr) - 1;
        liveJsonBytes -= *block;
        std::free(block);
    }
    void* reallocate(void* ptr, size_t bytes) {
        if (!ptr) return allocate(bytes);
        auto* old = static_cast<size_t*>(ptr) - 1;
        const size_t oldSize = *old;
        auto* block = static_cast<size_t*>(std::realloc(old, bytes + sizeof(size_t)));
        if (!block) return nullptr;
        *block = bytes;
        liveJsonBytes = liveJsonBytes - oldSize + bytes;
        peakJsonBytes = std::max(peakJsonBytes, liveJsonBytes);
        return block + 1;
    }
};
using TrackedJsonDocument = ArduinoJson::BasicJsonDocument<TrackedAllocator>;
#define DynamicJsonDocument TrackedJsonDocument
#include "storage_under_test.cpp"
#include "buffered_writer.h"
#include "led_frame_cache.h"

void loggerWritef(uint8_t, uint16_t, const char*, ...) {}
void resetTraceSetStage(const char*, bool) {}

struct Console : Print {
    std::string output;
    using Print::write;
    size_t write(uint8_t value) override { output += char(value); return 1; }
    void println() { output += '\n'; }
} console;
#define CONSOLE_PORT console

struct Network {
    std::string output;
    size_t calls = 0, maxWrite = 256, failAfter = size_t(-1);
    bool stopped = false;
} network;
struct WiFiClient {
    size_t write(const uint8_t* bytes, size_t count) {
        ++network.calls;
        const size_t n = min(count, min(network.maxWrite, network.failAfter - network.output.size()));
        network.output.append(reinterpret_cast<const char*>(bytes), n);
        return n;
    }
    void stop() { network.stopped = true; }
};
struct Server {
    size_t length = 0;
    int status = 0;
    void setContentLength(size_t value) { length = value; }
    void send(int code, const char*, const char*) { status = code; }
    WiFiClient client() { return {}; }
} gServer;
void addCors() {}
struct Pixels {
    uint8_t data[MAX_LEDS * 3U]{};
    unsigned shows = 0;
    uint8_t* getPixels() { return data; }
    void show() { ++shows; }
} strip;
static LedFrameCache<MAX_LEDS * 3U> gLedFrameCache;
#include "optimization_under_test.h"

static std::string currentJson() {
    DynamicJsonDocument doc(CONFIG_JSON_CAPACITY);
    storagePopulateJson(doc);
    assert(!doc.overflowed());
    std::string json;
    serializeJson(doc, json);
    return json;
}

static void checkWireFormat() {
    console.output.clear();
    const std::string expected = currentJson();
    uartcfg::sendCurrentConfig();
    std::istringstream lines(console.output);
    std::string line, received;
    size_t seq = 0;
    assert(std::getline(lines, line));
    DynamicJsonDocument packet(512);
    assert(!deserializeJson(packet, line));
    assert(packet["event"] == "config_begin");
    assert(packet["bytes"].as<size_t>() == expected.size());
    assert(packet["crc"].as<uint32_t>() == uartcfg::calcCrc(reinterpret_cast<const uint8_t*>(expected.data()), expected.size()));
    bool ended = false;
    while (std::getline(lines, line)) {
        assert(!deserializeJson(packet, line));
        if (packet["event"] == "config_end") { ended = true; break; }
        assert(packet["event"] == "config_data");
        assert(packet["seq"].as<size_t>() == seq++);
        const std::string hex = packet["data"].as<std::string>();
        assert(!hex.empty() && hex.size() <= 128 && hex.size() % 2 == 0);
        for (size_t i = 0; i < hex.size(); i += 2)
            received += char(std::stoul(hex.substr(i, 2), nullptr, 16));
    }
    assert(ended && received == expected && !std::getline(lines, line));
    assert(seq == (expected.size() + 63) / 64);
}

int main() {
    static_assert(sizeof(void*) == 4, "Use MCU-sized JSON slots");
    assert(storageInit());
    checkWireFormat();
    std::strcpy(gConfig.wifiSsid, "test-\xD0\xA3\"\\");
    std::strcpy(gConfig.wifiPass, "quote\" slash\\ newline\n");
    std::memset(gConfig.mqttHost, 'h', sizeof(gConfig.mqttHost) - 1);
    std::memset(gConfig.mqttTopic, 't', sizeof(gConfig.mqttTopic) - 1);
    std::memset(gConfig.mqttUser, 'u', sizeof(gConfig.mqttUser) - 1);
    std::memset(gConfig.mqttPass, 'p', sizeof(gConfig.mqttPass) - 1);
    gConfig.stateColorCount = MAX_CUSTOM_STATES;
    for (uint8_t i = 0; i < MAX_CUSTOM_STATES; ++i)
        gConfig.stateColors[i] = {uint8_t(240 + i), {255,i,100,255}, {0,0,i,24}};
    sanitizeConfig();
    checkWireFormat();
    assert(uartcfg::calcCrc(reinterpret_cast<const uint8_t*>("123456789"), 9) == 0xCBF43926UL);

    // Exhaust all packet boundaries and byte values, including embedded NULs.
    for (size_t size = 0; size <= 193; ++size) {
        console.output.clear();
        uartcfg::ConfigChunkWriter writer;
        std::string payload(size, '\0');
        for (size_t i = 0; i < size; ++i) payload[i] = char(i);
        assert(writer.write(reinterpret_cast<const uint8_t*>(payload.data()), size) == size);
        writer.flush(); writer.flush();
        std::istringstream lines(console.output);
        std::string line, decoded;
        while (std::getline(lines, line)) {
            StaticJsonDocument<512> packet;
            assert(!deserializeJson(packet, line));
            const std::string hex = packet["data"].as<std::string>();
            for (size_t i = 0; i < hex.size(); i += 2) decoded += char(std::stoul(hex.substr(i, 2), nullptr, 16));
        }
        assert(decoded == payload);
    }

    const std::string expected = currentJson();
    DynamicJsonDocument doc(CONFIG_JSON_CAPACITY);
    assert(!deserializeJson(doc, expected));
    sendJson(doc);
    assert(gServer.status == 200 && gServer.length == expected.size() && network.output == expected);
    assert(network.calls == (expected.size() + 255) / 256 && !network.stopped);
    const size_t normalCalls = network.calls;
    network = {}; network.maxWrite = 7;
    sendJson(doc);
    assert(network.output == expected && !network.stopped);
    network = {}; network.failAfter = 13;
    sendJson(doc);
    assert(network.output == expected.substr(0, 13) && network.stopped && network.calls == 2);
    network = {}; network.failAfter = 0;
    sendJson(doc);
    assert(network.output.empty() && network.stopped && network.calls == 1);
    DynamicJsonDocument tiny(16); tiny["array"].to<JsonArray>().add(1);
    sendJson(tiny); assert(gServer.status == 503);

    // Reusing the legacy parsing pool must preserve every field and migrate CRC.
    files = {{"/amcfg.json", expected}}; faults = {};
    const size_t beforeMigration = liveJsonBytes;
    peakJsonBytes = liveJsonBytes;
    assert(storageInit());
    const size_t migrationPeak = peakJsonBytes - beforeMigration;
    assert(liveJsonBytes == beforeMigration);
    assert(migrationPeak <= CONFIG_JSON_CAPACITY + 2048);
    assert(currentJson() == expected);
    assert(storageInit() && currentJson() == expected);

    fakeMillis = 0xFFFFFF00UL;
    ledsShowIfChanged(); assert(strip.shows == 1);
    for (unsigned i = 1; i < 250; ++i) { ++fakeMillis; ledsShowIfChanged(); }
    assert(strip.shows == 1);
    ++fakeMillis; ledsShowIfChanged(); assert(strip.shows == 2);
    for (unsigned i = 0; i < 1000; ++i) {
        ++fakeMillis; strip.data[i % sizeof(strip.data)] ^= 1;
        ledsShowIfChanged(); assert(strip.shows == i + 3);
    }
    ledsShowIfChanged(true); assert(strip.shows == 1003);
    std::printf("PASS optimization: UART byte/CRC/chunk parity, HTTP %zu bytes / %zu writes + short/failing clients, legacy migration peak %zu bytes, LED changed/steady/rollover\n", expected.size(), normalCalls, migrationPeak);
}
