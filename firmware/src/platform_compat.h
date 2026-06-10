#pragma once

#include <Arduino.h>
#include <LittleFS.h>

#if defined(ESP32)
#include <WiFi.h>
#include <WebServer.h>
#include <ESPmDNS.h>
#include <esp_mac.h>
#include <esp_system.h>
#include <esp_wifi.h>
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
    uint8_t mac[6] = {0};
    esp_efuse_mac_get_default(mac);

    const bool macLooksValid =
        (mac[0] | mac[1] | mac[2] | mac[3] | mac[4] | mac[5]) != 0 &&
        (mac[0] & mac[1] & mac[2] & mac[3] & mac[4] & mac[5]) != 0xFF;

    if (macLooksValid)
        return ((uint32_t)mac[3] << 16) | ((uint32_t)mac[4] << 8) | mac[5];

    return (uint32_t)(ESP.getEfuseMac() & 0x00FFFFFFULL);
}

inline void platformWifiDisconnect()
{
    WiFi.disconnect(false, false);
}

inline void platformWifiDisableSleep()
{
    WiFi.setSleep(false);
}

inline void platformWifiSetMaxTxPower()
{
    WiFi.setTxPower(WIFI_POWER_19_5dBm);
}

inline void platformWifiConfigureApRadio()
{
    wifi_country_t country = {
        .cc = "UA",
        .schan = 1,
        .nchan = 11,
        .policy = WIFI_COUNTRY_POLICY_MANUAL,
    };
    esp_wifi_set_country(&country);
    esp_wifi_set_bandwidth(WIFI_IF_AP, WIFI_BW_HT20);
}

inline uint32_t platformUniqueId24()
{
    return platformChipId() & 0x00FFFFFFUL;
}

inline void platformUniqueSuffix(char *out, size_t outSize)
{
    if (!out || outSize == 0)
        return;
    snprintf(out, outSize, "%06lX", (unsigned long)platformUniqueId24());
}

inline void platformDeviceHostname(char *out, size_t outSize)
{
    char suffix[7] = {0};
    platformUniqueSuffix(suffix, sizeof(suffix));
    snprintf(out, outSize, "alarm-%s", suffix);
}

inline String platformProvisioningApSsid(const char *prefix)
{
    char suffix[7] = {0};
    platformUniqueSuffix(suffix, sizeof(suffix));
    return String(prefix ? prefix : "AlarmMini") + "-" + suffix;
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

#elif defined(ESP8266)
#include <ESP8266WiFi.h>
#include <ESP8266WebServer.h>
#include <ESP8266mDNS.h>

using AlarmWebServer = ESP8266WebServer;

inline uint32_t platformChipId()
{
    uint8_t mac[6] = {0};
    WiFi.macAddress(mac);

    const bool macLooksValid =
        (mac[0] | mac[1] | mac[2] | mac[3] | mac[4] | mac[5]) != 0 &&
        (mac[0] & mac[1] & mac[2] & mac[3] & mac[4] & mac[5]) != 0xFF;

    if (macLooksValid)
        return ((uint32_t)mac[3] << 16) | ((uint32_t)mac[4] << 8) | mac[5];

    return ESP.getChipId() & 0x00FFFFFFUL;
}

inline uint32_t platformUniqueId24()
{
    return platformChipId() & 0x00FFFFFFUL;
}

inline void platformUniqueSuffix(char *out, size_t outSize)
{
    if (!out || outSize == 0)
        return;
    snprintf(out, outSize, "%06lX", (unsigned long)platformUniqueId24());
}

inline void platformDeviceHostname(char *out, size_t outSize)
{
    char suffix[7] = {0};
    platformUniqueSuffix(suffix, sizeof(suffix));
    snprintf(out, outSize, "alarm-%s", suffix);
}

inline String platformProvisioningApSsid(const char *prefix)
{
    char suffix[7] = {0};
    platformUniqueSuffix(suffix, sizeof(suffix));
    return String(prefix ? prefix : "AlarmMini") + "-" + suffix;
}

inline String platformResetReason()
{
    return ESP.getResetReason();
}

inline String platformResetInfo()
{
    return ESP.getResetInfo();
}

inline uint32_t platformMaxFreeBlock()
{
    return ESP.getMaxFreeBlockSize();
}

inline uint8_t platformHeapFragmentationPct()
{
    return ESP.getHeapFragmentation();
}

inline void platformSetHostname(const char *hostname)
{
    WiFi.hostname(hostname);
}

inline void collectCookieHeader(AlarmWebServer &server)
{
    server.collectHeaders("Cookie");
}

inline void platformWifiDisconnect()
{
    WiFi.disconnect(false);
}

inline void platformWifiDisableSleep()
{
    WiFi.setSleepMode(WIFI_NONE_SLEEP);
}

inline void platformWifiSetMaxTxPower()
{
    WiFi.setOutputPower(20.5f);
}

inline void platformWifiConfigureApRadio()
{
}

#define CONSOLE_PORT Serial

#else
#error "Unsupported platform. AlarmMini commercial firmware targets ESP32-C3 and ESP8266."
#endif
