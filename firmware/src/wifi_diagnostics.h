#pragma once
#include "platform_compat.h"
#include <ArduinoJson.h>
#if defined(ESP32)
#include <atomic>

namespace wifiDiagnostics {
static std::atomic<uint32_t> lastReason{0};
static std::atomic<uint32_t> failureReason{0};
static std::atomic<uint32_t> disconnects{0};

inline void init()
{
    WiFi.onEvent([](WiFiEvent_t, WiFiEventInfo_t info) {
        const uint32_t reason = info.wifi_sta_disconnected.reason;
        lastReason.store(reason, std::memory_order_relaxed);
        disconnects.fetch_add(1, std::memory_order_relaxed);
        // A deliberate retry disconnect must not hide the radio failure.
        if (reason != WIFI_REASON_ASSOC_LEAVE)
            failureReason.store(reason, std::memory_order_relaxed);
    }, ARDUINO_EVENT_WIFI_STA_DISCONNECTED);
}

inline void append(JsonObject out)
{
    out["wifiDisconnectReason"] = lastReason.load(std::memory_order_relaxed);
    out["wifiFailureReason"] = failureReason.load(std::memory_order_relaxed);
    out["wifiDisconnectEvents"] = disconnects.load(std::memory_order_relaxed);
    out["wifiMode"] = static_cast<int>(WiFi.getMode());
    out["wifiTxPowerQuarterDbm"] = static_cast<int>(WiFi.getTxPower());
    wifi_config_t station = {};
    const esp_err_t result = esp_wifi_get_config(WIFI_IF_STA, &station);
    out["wifiDriverConfigResult"] = static_cast<int>(result);
    if (result == ESP_OK) {
        char ssid[33] = {};
        memcpy(ssid, station.sta.ssid, 32);
        out["wifiDriverSsid"] = ssid;
    }
}
}
#else
namespace wifiDiagnostics {
inline void init() {}
inline void append(JsonObject out) { out["wifiMode"] = static_cast<int>(WiFi.getMode()); }
}
#endif
