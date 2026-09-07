#include "fallback_http.h"
#include "platform_compat.h"
#include <atomic>
#include <time.h>
#if defined(ESP32)
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#else
#include <ESP8266HTTPClient.h>
#include <WiFiClientSecureBearSSL.h>
#include <CertStoreBearSSL.h>
#endif

namespace {
std::atomic<uint8_t> state{0}; // idle, requested, completed
FallbackHttpResult result;
char requestToken[fallbackContract::TOKEN_CAPACITY] = {};

// Bound response header bytes and reads; SDK TLS handshake has its own timeout.
template<class Base> class LimitedClient : public Base {
    uint32_t started = millis();
    size_t received = 0;
    bool expired() {
#if defined(ESP32)
        constexpr uint32_t deadlineMs = 10000; // Worker does not block the main loop.
#else
        constexpr uint32_t deadlineMs = 4500;
#endif
        if (millis() - started <= deadlineMs && received < 4096) return false;
        Base::stop();
        return true;
    }
public:
#if defined(ESP8266)
    using Base::connect;
    int connect(const char *host, uint16_t port) override {
        IPAddress address;
        // Seed the SDK DNS cache with a bounded lookup, preserving the hostname
        // for TLS SNI and certificate validation in the subsequent connection.
        if (!WiFi.hostByName(host, address, 750)) return 0;
        const int ok = Base::connect(host, port);
        Base::setTimeout(1000);
        return ok;
    }
#endif
    int available() override { return expired() ? 0 : Base::available(); }
    uint8_t connected() override { return expired() ? 0 : Base::connected(); }
    int read() override {
        if (expired()) return -1;
        const int value = Base::read();
        if (value >= 0) ++received;
        return value;
    }
    int read(uint8_t *buffer, size_t length) override {
        if (expired()) return -1;
        const int count = Base::read(buffer, min(length, size_t(4096 - received)));
        if (count > 0) received += count;
        return count;
    }
};

class BodyBuffer : public Stream {
public:
    char *buffer;
    size_t used = 0;
    explicit BodyBuffer(char *out) : buffer(out) { buffer[0] = 0; }
    int available() override { return 0; }
    int read() override { return -1; }
    int peek() override { return -1; }
    void flush() override {}
    size_t write(uint8_t value) override {
        if (used >= fallbackContract::BODY_CAPACITY || value == 0) return 0;
        buffer[used++] = char(value);
        buffer[used] = 0;
        return 1;
    }
};

template<class ClientType> void request(ClientType &client) {
    HTTPClient http;
    http.setReuse(false);
    http.setTimeout(1000);
#if defined(ESP32)
    http.setConnectTimeout(2500);
#endif
    http.useHTTP10(true);
    if (!http.begin(client, result.url)) { result.status = -1001; return; }
    const char *headers[] = {"Content-Encoding"};
    http.collectHeaders(headers, 1);
    http.addHeader("Accept", "application/json");
    http.addHeader("Accept-Encoding", "identity");
    http.addHeader("Cache-Control", "no-cache");
    if (requestToken[0]) http.addHeader("Authorization", String("Bearer ") + requestToken);
    const int code = http.GET();
    result.status = code;
    if (code == 200) {
        const String encoding = http.header("Content-Encoding");
        if (http.getSize() > (int)fallbackContract::BODY_CAPACITY ||
            (encoding.length() && encoding != "identity")) result.status = -1003;
        else {
            BodyBuffer sink(result.body);
            const int count = http.writeToStream(&sink);
            if (count <= 0 || (http.getSize() >= 0 && count != http.getSize())) result.status = -1004;
        }
    }
    http.end();
    client.stop();
}

void fetch() {
    result.body[0] = 0;
    result.status = -1000;
    if (WiFi.status() != WL_CONNECTED || !fallbackContract::validUrl(result.url)) return;
    const bool secure = strncmp(result.url, "https://", 8) == 0;
    if (!secure) {
        LimitedClient<WiFiClient> client;
        request(client);
        return;
    }
    // Certificate validity must be checked using a synchronized clock.
    if (time(nullptr) < 1700000000) { result.status = -1005; return; }
    if (ESP.getFreeHeap() < 26000) { result.status = -1002; return; }
#if defined(ESP32)
    extern const uint8_t roots[] asm("_binary_certificates_roots_bundle_start");
    extern const char commonRoots[] asm("_binary_certificates_common_roots_pem_start");
    static bool preferFullRoots = true;
    for (int attempt = 0; attempt < 2; ++attempt) {
        const bool full = attempt == 0 ? preferFullRoots : !preferFullRoots;
        LimitedClient<WiFiClientSecure> client;
        if (full) client.setCACert(commonRoots);
        else client.setCACertBundle(roots);
        client.setHandshakeTimeout(5);
        request(client);
        if (result.status != -1) {
            if (result.status > 0 || result.status == -1003) preferFullRoots = full;
            return;
        }
        char detail[64];
        const int tlsError = client.lastError(detail, sizeof(detail));
        if (tlsError < -100) result.status = tlsError;
        // Retry only a trust-chain error, using the alternate verified store.
        if (tlsError != -0x3000 && tlsError != -0x2700) return;
    }
#else
    static BearSSL::CertStore store;
    static bool loaded = false;
    if (!loaded) loaded = store.initCertStore(LittleFS, "/certs.idx", "/certs.ar") > 0;
    if (!loaded) { result.status = -1006; return; }
    LimitedClient<BearSSL::WiFiClientSecure> client;
    client.setCertStore(&store);
    client.setTimeout(1500);
    request(client);
#endif
}

#if defined(ESP32)
TaskHandle_t worker = nullptr;
void work(void *) {
    for (;;) {
        ulTaskNotifyTake(pdTRUE, portMAX_DELAY);
        if (state.load(std::memory_order_acquire) != 1) continue;
        fetch();
        memset(requestToken, 0, sizeof(requestToken));
        state.store(2, std::memory_order_release);
    }
}
#endif
}

bool fallbackHttpBusy() { return state.load(std::memory_order_acquire) != 0; }

bool fallbackHttpStart(const char *url, const char *token, uint32_t generation) {
    if (fallbackHttpBusy() || !fallbackContract::validToken(token)) return false;
#if defined(ESP32)
    if (!worker && xTaskCreate(work, "fallback-http", 8192, nullptr, 1, &worker) != pdPASS) return false;
#endif
    snprintf(result.url, sizeof(result.url), "%s", url);
    snprintf(requestToken, sizeof(requestToken), "%s", token ? token : "");
    result.generation = generation;
    state.store(1, std::memory_order_release);
#if defined(ESP32)
    xTaskNotifyGive(worker);
#else
    // ESP8266 has no second task context; the bounded transport yields to Wi-Fi.
    fetch();
    memset(requestToken, 0, sizeof(requestToken));
    state.store(2, std::memory_order_release);
#endif
    return true;
}

bool fallbackHttpTakeResult(FallbackHttpResult &out) {
    if (state.load(std::memory_order_acquire) != 2) return false;
    out = result;
    state.store(0, std::memory_order_release);
    return true;
}
