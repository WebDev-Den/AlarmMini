#include <Arduino.h>
#include <LittleFS.h>
#include <time.h>
#include <ESP8266mDNS.h>
#include "logger.h"
#include "storage.h"
#include "alerts.h"
#include "leds.h"
#include "buzzer.h"
#include "startup.h"
#include "webserver.h"

char gHostname[32];
static String gSerialLineBuffer;
static String gIncomingConfigJson;
static bool gReceivingConfig = false;

static void serialConfigSendCurrent()
{
    File configFile = LittleFS.open("/config.json", "r");
    if (!configFile)
    {
        Serial.println("AMCFG ERROR read_failed");
        return;
    }

    String json = configFile.readString();
    configFile.close();
    json.trim();

    if (!json.length())
    {
        Serial.println("AMCFG ERROR empty");
        return;
    }

    Serial.printf("AMCFG BEGIN %u\n", json.length());
    constexpr size_t chunkSize = 192;
    for (size_t offset = 0; offset < json.length(); offset += chunkSize)
    {
        String chunk = json.substring(offset, offset + chunkSize);
        Serial.print("AMCFG DATA ");
        Serial.println(chunk);
        yield();
    }
    Serial.println("AMCFG END");
}

static void serialConfigApplyIncoming()
{
    if (!gIncomingConfigJson.length())
    {
        Serial.println("AMCFG ERROR empty_payload");
        return;
    }

    DynamicJsonDocument doc(CONFIG_JSON_CAPACITY);
    DeserializationError err = deserializeJson(doc, gIncomingConfigJson);
    if (err)
    {
        Serial.printf("AMCFG ERROR json_%s\n", err.c_str());
        return;
    }

    doc.remove("adminPassword");
    doc.remove("animations");

    File configFile = LittleFS.open("/config.json", "w");
    if (!configFile)
    {
        Serial.println("AMCFG ERROR write_failed");
        return;
    }

    serializeJson(doc, configFile);
    configFile.close();

    storageApplyJson(doc);
    loggerSetMask(gConfig.logMask);
    Serial.println("AMCFG OK");
    LOG_INFO(LOG_CAT_CONFIG, "Config restored from serial");
    scheduleRestart();
}

static void handleSerialProtocolLine(const String &line)
{
    if (line == "AMCFG GET")
    {
        serialConfigSendCurrent();
        return;
    }

    if (line == "AMCFG SET BEGIN")
    {
        gIncomingConfigJson = "";
        gIncomingConfigJson.reserve(CONFIG_JSON_CAPACITY);
        gReceivingConfig = true;
        Serial.println("AMCFG READY");
        return;
    }

    if (line == "AMCFG SET END")
    {
        bool hadPayload = gReceivingConfig;
        gReceivingConfig = false;
        if (!hadPayload)
        {
            Serial.println("AMCFG ERROR not_receiving");
            return;
        }
        serialConfigApplyIncoming();
        return;
    }

    if (line.startsWith("AMCFG SET DATA "))
    {
        if (!gReceivingConfig)
        {
            Serial.println("AMCFG ERROR not_receiving");
            return;
        }

        String chunk = line.substring(strlen("AMCFG SET DATA "));
        if (gIncomingConfigJson.length() + chunk.length() > CONFIG_JSON_CAPACITY - 1)
        {
            gReceivingConfig = false;
            gIncomingConfigJson = "";
            Serial.println("AMCFG ERROR too_large");
            return;
        }

        gIncomingConfigJson += chunk;
        return;
    }
}

static void serialProtocolHandle()
{
    while (Serial.available())
    {
        const char ch = (char)Serial.read();
        if (ch == '\r')
            continue;

        if (ch == '\n')
        {
            String line = gSerialLineBuffer;
            gSerialLineBuffer = "";
            line.trim();
            if (line.startsWith("AMCFG "))
            {
                handleSerialProtocolLine(line);
            }
            continue;
        }

        if (gSerialLineBuffer.length() < CONFIG_JSON_CAPACITY)
            gSerialLineBuffer += ch;
    }
}

static const char* ntpServerOrDefault(const char* configured, const char* fallback)
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

    uint32_t chipId = ESP.getChipId();
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

void setup()
{
    Serial.begin(115200);
    yield();
    loggerInit();
    LOG_INFO(LOG_CAT_SYSTEM, "AlarmMini firmware %s", FIRMWARE_VERSION);

    if (!LittleFS.begin())
    {
        LOG_ERROR(LOG_CAT_CONFIG, "FS init error. Try: pio run -t uploadfs");
    }
    else
    {
        LOG_INFO(LOG_CAT_CONFIG, "LittleFS ready");
    }

    storageInit();
    loggerSetMask(gConfig.logMask);
    ledsInit();
    buzzerInit();

    uint8_t ledCount = max((int)gConfig.ledCount, 1);
    startupWifiWithEffect(ledCount);

    snprintf(gHostname, sizeof(gHostname), "alarm-%04X", ESP.getChipId() & 0xFFFF);
    WiFi.hostname(gHostname);
    generateHardwareAdminPassword();
    LOG_INFO(LOG_CAT_SYSTEM, "Admin password: %s", gConfig.adminPassword);

    if (MDNS.begin(gHostname))
    {
        MDNS.addService("http", "tcp", 80);
        LOG_INFO(LOG_CAT_SYSTEM, "mDNS http://%s.local", gHostname);
    }

    const char* ntp1 = ntpServerOrDefault(gConfig.ntpServer1, "pool.ntp.org");
    const char* ntp2 = ntpServerOrDefault(gConfig.ntpServer2, "time.nist.gov");
    const char* ntp3 = ntpServerOrDefault(gConfig.ntpServer3, "time.google.com");
    configTime(0, 0, ntp1, ntp2, ntp3);
    setenv("TZ", "EET-2EEST,M3.5.0/3,M10.5.0/4", 1);
    tzset();
    LOG_INFO(LOG_CAT_SYSTEM, "NTP sync started: %s | %s | %s", ntp1, ntp2, ntp3);

    alertsFetch();
    webserverInit();
    LOG_INFO(LOG_CAT_SYSTEM, "Ready at http://%s", WiFi.localIP().toString().c_str());
    LOG_INFO(LOG_CAT_SYSTEM, "Version %s", FIRMWARE_VERSION);
}

void loop()
{
    serialProtocolHandle();
    MDNS.update();
    webserverHandle();
    alertsHandle();
    buzzerHandle();
    ledsHandle();
    yield();
}
