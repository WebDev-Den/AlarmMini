#include <Arduino.h>
#include <time.h>
#include "platform_compat.h"

#include "logger.h"
#include "storage.h"
#include "alerts.h"
#include "leds.h"
#include "buzzer.h"
#include "startup.h"
#include "app_webserver.h"
#include "uart_config.h"
#include "reset_trace.h"
#include "runtime_stats.h"
#if defined(ESP32)
#include <esp_log.h>
#endif

char gHostname[32];
unsigned long gLoopMaxDurationMs = 0;
unsigned long gLoopSlowCount = 0;
unsigned long gLoopIterationCount = 0;
#if defined(ESP8266)
static WiFiEventHandler gWifiConnectedHandler;
static WiFiEventHandler gWifiDisconnectedHandler;
static WiFiEventHandler gWifiGotIpHandler;
#endif

static const char *ntpServerOrDefault(const char *configured, const char *fallback)
{
    return (configured && configured[0]) ? configured : fallback;
}

static void generateHardwareAdminPassword()
{
    static const char alphabet[] = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    uint8_t mac[6] = {0};
    WiFi.macAddress(mac);

    uint32_t hash = 2166136261UL;
    auto mix = [&](uint8_t value)
    {
        hash ^= value;
        hash *= 16777619UL;
    };

    for (uint8_t value : mac)
        mix(value);

    uint32_t chipId = platformChipId();
    mix((chipId >> 0) & 0xFF);
    mix((chipId >> 8) & 0xFF);
    mix((chipId >> 16) & 0xFF);

    const char *salt = "AlarmMini";
    while (*salt)
        mix((uint8_t)*salt++);

    uint32_t state = hash ^ 0x9E3779B9UL;
    for (int i = 0; i < 8; i++)
    {
        state ^= state << 13;
        state ^= state >> 17;
        state ^= state << 5;
        gConfig.adminPassword[i] = alphabet[state & 31];
    }
    gConfig.adminPassword[8] = '\0';
}

void serialProtocolHandle()
{
    uartcfg::handle();
}

void setup()
{
#if defined(ESP32)
    CONSOLE_PORT.setRxBufferSize(2048);
#endif
    CONSOLE_PORT.begin(115200);
    yield();
#if defined(ESP32)
    // Keep COM protocol clean: suppress ESP-IDF runtime logs in normal operation.
    esp_log_level_set("*", ESP_LOG_NONE);
#endif

    loggerInit();
    uartcfg::init();

    LOG_INFO(LOG_CAT_SYSTEM, "AlarmMini firmware %s", FIRMWARE_VERSION);
    LOG_INFO(LOG_CAT_SYSTEM, "Reset reason: %s", platformResetReason().c_str());
    LOG_INFO(LOG_CAT_SYSTEM, "Reset info: %s", platformResetInfo().c_str());

    if (!LittleFS.begin())
    {
        LOG_ERROR(LOG_CAT_CONFIG, "FS init error. Try: pio run -t uploadfs");
    }
    else
    {
        LOG_INFO(LOG_CAT_CONFIG, "LittleFS ready");
    }
#if defined(ESP8266)
    resetTraceInit();
    resetTraceSetStage("storage_init");
#endif

    storageInit();
    loggerSetMask(gConfig.logMask);
    WiFi.persistent(false);
    WiFi.setAutoReconnect(true);

    snprintf(gHostname, sizeof(gHostname), "alarm-%04X", platformChipId() & 0xFFFF);
    platformSetHostname(gHostname);
    generateHardwareAdminPassword();
#if defined(ESP8266)
    gWifiConnectedHandler = WiFi.onStationModeConnected([](const WiFiEventStationModeConnected &event)
                                                        { LOG_INFO(LOG_CAT_WIFI, "STA connected to '%s' (channel %d)", event.ssid.c_str(), event.channel); });
    gWifiDisconnectedHandler = WiFi.onStationModeDisconnected([](const WiFiEventStationModeDisconnected &event)
                                                              { LOG_WARN(LOG_CAT_WIFI, "STA disconnected, reason=%d", event.reason); });
    gWifiGotIpHandler = WiFi.onStationModeGotIP([](const WiFiEventStationModeGotIP &event)
                                                { LOG_INFO(LOG_CAT_WIFI, "STA got IP %s mask %s gw %s", event.ip.toString().c_str(), event.mask.toString().c_str(), event.gw.toString().c_str()); });
#endif

    ledsInit();
    buzzerInit();
#if defined(ESP8266)
    resetTraceSetStage("wifi_start");
#endif

    uint8_t ledCount = max((int)gConfig.ledCount, 1);
    startupWifiWithEffect(ledCount);
#if defined(ESP8266)
    resetTraceSetStage("wifi_ready");
#endif

    if (MDNS.begin(gHostname))
    {
        MDNS.addService("http", "tcp", 80);
        LOG_INFO(LOG_CAT_SYSTEM, "mDNS http://%s.local", gHostname);
    }

    const char *ntp1 = ntpServerOrDefault(gConfig.ntpServer1, "pool.ntp.org");
    const char *ntp2 = ntpServerOrDefault(gConfig.ntpServer2, "time.nist.gov");
    const char *ntp3 = ntpServerOrDefault(gConfig.ntpServer3, "time.google.com");
    configTime(0, 0, ntp1, ntp2, ntp3);
    setenv("TZ", "EET-2EEST,M3.5.0/3,M10.5.0/4", 1);
    tzset();

    LOG_INFO(LOG_CAT_SYSTEM, "NTP sync started: %s | %s | %s", ntp1, ntp2, ntp3);

    alertsFetch();
    webserverInit();
#if defined(ESP8266)
    resetTraceSetStage("runtime");
#endif
    uartcfg::sendDeviceInfo();

    LOG_INFO(LOG_CAT_SYSTEM, "Ready at http://%s", WiFi.localIP().toString().c_str());
    LOG_INFO(LOG_CAT_SYSTEM, "Version %s", FIRMWARE_VERSION);
}

void loop()
{
    const unsigned long loopStartedAt = millis();
    uartcfg::handle();
    if (WiFi.status() == WL_CONNECTED)
    {
#if defined(ESP8266)
        MDNS.update();
#endif
    }
    webserverHandle();
    alertsHandle();
    buzzerHandle();
    ledsHandle();
    yield();
    const unsigned long loopElapsed = millis() - loopStartedAt;
    gLoopIterationCount++;
    if (loopElapsed > gLoopMaxDurationMs)
        gLoopMaxDurationMs = loopElapsed;
    if (loopElapsed > 30UL)
        gLoopSlowCount++;
}
