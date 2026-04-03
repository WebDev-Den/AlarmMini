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

static void serialSendJsonStatus(const char *eventName, const char *extraKey = nullptr, const char *extraValue = nullptr)
{
    DynamicJsonDocument doc(256);
    doc["event"] = eventName;
    if (extraKey && extraValue)
        doc[extraKey] = extraValue;
    serializeJson(doc, Serial);
    Serial.println();
}

static void serialConfigSendCurrent()
{
    File configFile = LittleFS.open("/config.json", "r");
    if (!configFile)
    {
        serialSendJsonStatus("error", "reason", "read_failed");
        return;
    }

    String json = configFile.readString();
    configFile.close();
    json.trim();

    if (!json.length())
    {
        serialSendJsonStatus("error", "reason", "empty");
        return;
    }

    {
        DynamicJsonDocument beginDoc(128);
        beginDoc["event"] = "config_begin";
        beginDoc["length"] = json.length();
        serializeJson(beginDoc, Serial);
        Serial.println();
    }

    constexpr size_t chunkSize = 160;
    for (size_t offset = 0; offset < json.length(); offset += chunkSize)
    {
        String chunk = json.substring(offset, offset + chunkSize);
        DynamicJsonDocument dataDoc(256);
        dataDoc["event"] = "config_data";
        dataDoc["data"] = chunk;
        serializeJson(dataDoc, Serial);
        Serial.println();
        yield();
    }
    serialSendJsonStatus("config_end");
}

static void serialConfigApplyIncoming()
{
    if (!gIncomingConfigJson.length())
    {
        serialSendJsonStatus("error", "reason", "empty_payload");
        return;
    }

    DynamicJsonDocument doc(CONFIG_JSON_CAPACITY);
    DeserializationError err = deserializeJson(doc, gIncomingConfigJson);
    if (err)
    {
        char reason[64];
        snprintf(reason, sizeof(reason), "json_%s", err.c_str());
        serialSendJsonStatus("error", "reason", reason);
        return;
    }

    doc.remove("adminPassword");
    doc.remove("animations");

    File configFile = LittleFS.open("/config.json", "w");
    if (!configFile)
    {
        serialSendJsonStatus("error", "reason", "write_failed");
        return;
    }

    serializeJson(doc, configFile);
    configFile.close();

    storageApplyJson(doc);
    loggerSetMask(gConfig.logMask);
    serialSendJsonStatus("ok");
    Serial.flush();
    LOG_INFO(LOG_CAT_CONFIG, "Config restored from serial");
    scheduleRestart(1200);
}

static void serialSendReady()
{
    DynamicJsonDocument doc(192);
    doc["event"] = "ready";
    doc["protocol"] = "json-config-v1";
    doc["version"] = FIRMWARE_VERSION;
    serializeJson(doc, Serial);
    Serial.println();
}

static bool handleSerialJsonMessage(const String &line)
{
    const int jsonStart = line.indexOf('{');
    if (jsonStart < 0)
        return false;
    String jsonLine = line.substring(jsonStart);
    jsonLine.trim();
    if (!jsonLine.endsWith("}"))
        return false;

    if (jsonLine.indexOf("\"cmd\":\"hello\"") >= 0 ||
        jsonLine.indexOf("\"cmd\": \"hello\"") >= 0 ||
        jsonLine.indexOf("\"cmd\":\"ping\"") >= 0 ||
        jsonLine.indexOf("\"cmd\": \"ping\"") >= 0)
    {
        serialSendReady();
        return true;
    }

    if (jsonLine.indexOf("\"cmd\":\"get_config\"") >= 0 ||
        jsonLine.indexOf("\"cmd\": \"get_config\"") >= 0)
    {
        serialSendReady();
        serialConfigSendCurrent();
        return true;
    }

    if (jsonLine.indexOf("\"cmd\":\"set_begin\"") >= 0 ||
        jsonLine.indexOf("\"cmd\": \"set_begin\"") >= 0)
    {
        gIncomingConfigJson = "";
        gIncomingConfigJson.reserve(CONFIG_JSON_CAPACITY);
        gReceivingConfig = true;
        serialSendReady();
        return true;
    }

    if (jsonLine.indexOf("\"cmd\":\"set_end\"") >= 0 ||
        jsonLine.indexOf("\"cmd\": \"set_end\"") >= 0)
    {
        bool hadPayload = gReceivingConfig;
        gReceivingConfig = false;
        if (!hadPayload)
        {
            serialSendJsonStatus("error", "reason", "not_receiving");
            return true;
        }
        serialConfigApplyIncoming();
        return true;
    }

    if (jsonLine.indexOf("\"cmd\":\"set_data\"") >= 0 ||
        jsonLine.indexOf("\"cmd\": \"set_data\"") >= 0)
    {
        DynamicJsonDocument doc(512);
        DeserializationError err = deserializeJson(doc, jsonLine);
        if (err)
        {
            serialSendJsonStatus("error", "reason", "json_invalid");
            return true;
        }

        if (!gReceivingConfig)
        {
            serialSendJsonStatus("error", "reason", "not_receiving");
            return true;
        }

        String chunk = doc["data"] | "";
        if (gIncomingConfigJson.length() + chunk.length() > CONFIG_JSON_CAPACITY - 1)
        {
            gReceivingConfig = false;
            gIncomingConfigJson = "";
            serialSendJsonStatus("error", "reason", "too_large");
            return true;
        }

        gIncomingConfigJson += chunk;
        return true;
    }

    return false;
}

static void handleSerialProtocolLine(const String &line)
{
    if (handleSerialJsonMessage(line))
        return;

    if (line == "AMCFG GET")
    {
        serialSendReady();
        serialConfigSendCurrent();
        return;
    }

    if (line == "AMCFG SET BEGIN")
    {
        gIncomingConfigJson = "";
        gIncomingConfigJson.reserve(CONFIG_JSON_CAPACITY);
        gReceivingConfig = true;
        serialSendReady();
        return;
    }

    if (line == "AMCFG SET END")
    {
        bool hadPayload = gReceivingConfig;
        gReceivingConfig = false;
        if (!hadPayload)
        {
            serialSendJsonStatus("error", "reason", "not_receiving");
            return;
        }
        serialConfigApplyIncoming();
        return;
    }

    if (line.startsWith("AMCFG SET DATA "))
    {
        if (!gReceivingConfig)
        {
            serialSendJsonStatus("error", "reason", "not_receiving");
            return;
        }

        String chunk = line.substring(strlen("AMCFG SET DATA "));
        if (gIncomingConfigJson.length() + chunk.length() > CONFIG_JSON_CAPACITY - 1)
        {
            gReceivingConfig = false;
            gIncomingConfigJson = "";
            serialSendJsonStatus("error", "reason", "too_large");
            return;
        }

        gIncomingConfigJson += chunk;
        return;
    }
}

void serialProtocolHandle()
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
