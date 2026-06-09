#pragma once

#include <Arduino.h>
#include <LittleFS.h>

#if defined(ESP32)
#include <WiFi.h>
#include <WebServer.h>
#include <ESPmDNS.h>
#include <esp_system.h>
#if !CONFIG_IDF_TARGET_ESP32C3
#error "AlarmMini commercial firmware is validated only for ESP32-C3."
#endif
#if CONFIG_IDF_TARGET_ESP32C3
#include <HWCDC.h>
extern HWCDC USBSerial;
#endif

using AlarmWebServer = WebServer;

inline uint32_t platformChipId()
{
    return (uint32_t)(ESP.getEfuseMac() & 0xFFFFFFFFULL);
}

inline const char *platformResetReasonText()
{
    switch (esp_reset_reason())
    {
    case ESP_RST_UNKNOWN:
        return "unknown";
    case ESP_RST_POWERON:
        return "power_on";
    case ESP_RST_EXT:
        return "external";
    case ESP_RST_SW:
        return "software";
    case ESP_RST_PANIC:
        return "panic";
    case ESP_RST_INT_WDT:
        return "interrupt_watchdog";
    case ESP_RST_TASK_WDT:
        return "task_watchdog";
    case ESP_RST_WDT:
        return "watchdog";
    case ESP_RST_DEEPSLEEP:
        return "deepsleep";
    case ESP_RST_BROWNOUT:
        return "brownout";
    case ESP_RST_SDIO:
        return "sdio";
    default:
        return "other";
    }
}

inline String platformResetReason()
{
    return String(platformResetReasonText());
}

inline String platformResetInfo()
{
    return String("n/a");
}

inline uint32_t platformMaxFreeBlock()
{
    return ESP.getMaxAllocHeap();
}

inline uint8_t platformHeapFragmentationPct()
{
    return 0;
}

inline void platformSetHostname(const char *hostname)
{
    WiFi.setHostname(hostname);
}

inline void collectCookieHeader(AlarmWebServer &server)
{
    const char *headerKeys[] = {"Cookie"};
    server.collectHeaders(headerKeys, 1);
}

#if CONFIG_IDF_TARGET_ESP32C3
// ESP32-C3 SuperMini uses USB-Serial/JTAG as the practical console path.
#define CONSOLE_PORT USBSerial
#else
#define CONSOLE_PORT Serial
#endif

#else
#error "Unsupported platform. AlarmMini commercial firmware targets ESP32-C3."
#endif
