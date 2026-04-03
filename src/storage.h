#pragma once
#include <LittleFS.h>
#include <ArduinoJson.h>
#include "config.h"
#include "logger.h"

AppConfig gConfig;

constexpr size_t CONFIG_JSON_CAPACITY = 8192;

int findRegionIndex(const char* query) {
    if (!query || strlen(query) == 0) return -1;
    for (int i = 0; i < REGIONS_COUNT; i++) {
        if (strstr(REGIONS[i], query) != nullptr) return i;
    }
    return -1;
}

void storageApplyJson(DynamicJsonDocument& doc) {
    auto u8  = [&](const char* k) -> uint8_t { return (uint8_t)doc[k].as<int>(); };
    auto str = [&](const char* k, char* dst, size_t n) {
        const char* v = doc[k] | "";
        strncpy(dst, v, n - 1);
        dst[n - 1] = '\0';
    };

    gConfig.dayMode.alertColor   = {u8("dayAlertR"),   u8("dayAlertG"),   u8("dayAlertB"),   u8("dayAlertA")};
    gConfig.dayMode.clearColor   = {u8("dayClearR"),   u8("dayClearG"),   u8("dayClearB"),   u8("dayClearA")};
    gConfig.nightMode.alertColor = {u8("nightAlertR"), u8("nightAlertG"), u8("nightAlertB"), u8("nightAlertA")};
    gConfig.nightMode.clearColor = {u8("nightClearR"), u8("nightClearG"), u8("nightClearB"), u8("nightClearA")};

    gConfig.night.enabled       = doc["nightEnabled"].as<bool>();
    gConfig.night.startHour     = u8("nightStartH");
    gConfig.night.startMinute   = u8("nightStartM");
    gConfig.night.endHour       = u8("nightEndH");
    gConfig.night.endMinute     = u8("nightEndM");
    gConfig.night.maxBrightness = u8("nightMaxBright");
    gConfig.night.pulseOnAlert  = doc["nightPulseAlert"].as<bool>();
    gConfig.night.pulseOnClear  = doc["nightPulseClear"].as<bool>();

    gConfig.buzzer.enabled     = doc["buzzerEnabled"].as<bool>();
    gConfig.buzzer.dayVolume   = u8("buzzerDayVol");
    gConfig.buzzer.nightVolume = u8("buzzerNightVol");

    gConfig.blink.enabled        = doc["blinkEnabled"].as<bool>();
    gConfig.blink.dayIntensity   = u8("blinkDayInt");
    gConfig.blink.nightIntensity = u8("blinkNightInt");

    str("mqttHost",  gConfig.mqttHost,  MQTT_HOST_MAXLEN);
    str("mqttTopic", gConfig.mqttTopic, MQTT_TOPIC_MAXLEN);
    str("mqttUser",  gConfig.mqttUser,  MQTT_USER_MAXLEN);
    str("mqttPass",  gConfig.mqttPass,  MQTT_PASS_MAXLEN);
    str("ntpServer1", gConfig.ntpServer1, NTP_SERVER_MAXLEN);
    str("ntpServer2", gConfig.ntpServer2, NTP_SERVER_MAXLEN);
    str("ntpServer3", gConfig.ntpServer3, NTP_SERVER_MAXLEN);
    gConfig.mqttPort = (uint16_t)(doc["mqttPort"] | 1883);
    gConfig.logMask = (uint16_t)(doc["logMask"] | LOG_MASK_ALL);

    JsonArray leds = doc["leds"];
    gConfig.ledCount = MAX_LEDS;
    for (int i = 0; i < MAX_LEDS; i++) {
        gConfig.ledRegion[i] = -1;
        if (i < (int)leds.size())
            gConfig.ledRegion[i] = findRegionIndex(leds[i].as<const char*>());
    }

    for (int i = 0; i < REGIONS_COUNT; i++) gConfig.buzzer.regions[i] = false;
    JsonArray buzRegions = doc["buzzerRegions"];
    for (JsonVariant v : buzRegions) {
        int idx = findRegionIndex(v.as<const char*>());
        if (idx >= 0) gConfig.buzzer.regions[idx] = true;
    }
}

void createDefaultConfig() {
    DynamicJsonDocument doc(CONFIG_JSON_CAPACITY);
    doc["dayAlertR"]  = 255; doc["dayAlertG"]  = 0;  doc["dayAlertB"]  = 0;  doc["dayAlertA"]  = 255;
    doc["dayClearR"]  = 0;   doc["dayClearG"]  = 80; doc["dayClearB"]  = 0;  doc["dayClearA"]  = 255;
    doc["nightAlertR"]= 80;  doc["nightAlertG"]= 0;  doc["nightAlertB"]= 0;  doc["nightAlertA"]= 255;
    doc["nightClearR"]= 0;   doc["nightClearG"]= 15; doc["nightClearB"]= 0;  doc["nightClearA"]= 255;
    doc["nightEnabled"]= true; doc["nightStartH"]= 22; doc["nightStartM"]= 0;
    doc["nightEndH"]= 7; doc["nightEndM"]= 0;
    doc["nightMaxBright"]= 150;
    doc["nightPulseAlert"]= false;
    doc["nightPulseClear"]= false;
    doc["buzzerEnabled"]= true; doc["buzzerDayVol"]= 80; doc["buzzerNightVol"]= 30;

    doc["blinkEnabled"]= true; doc["blinkDayInt"]= 75; doc["blinkNightInt"]= 30;

    doc["mqttHost"]  = "";
    doc["mqttPort"]  = 1883;
    doc["mqttTopic"] = "alerts/status";
    doc["mqttUser"]  = "";
    doc["mqttPass"]  = "";
    doc["ntpServer1"] = "";
    doc["ntpServer2"] = "";
    doc["ntpServer3"] = "";
    doc["logMask"] = LOG_MASK_ALL;

    JsonArray buz = doc.createNestedArray("buzzerRegions");
    buz.add("Хмельницька область");

    JsonArray leds = doc.createNestedArray("leds");
    for (int i = 0; i < MAX_LEDS; i++) leds.add("");

    File f = LittleFS.open("/config.json", "w");
    serializeJson(doc, f);
    f.close();
    storageApplyJson(doc);
    LOG_INFO(LOG_CAT_CONFIG, "Default config.json created");
}

void storageInit() {
    if (!LittleFS.exists("/config.json")) {
        createDefaultConfig();
        return;
    }

    File f = LittleFS.open("/config.json", "r");
    DynamicJsonDocument doc(CONFIG_JSON_CAPACITY);
    DeserializationError err = deserializeJson(doc, f);
    f.close();

    if (err) {
        LOG_ERROR(LOG_CAT_CONFIG, "Storage JSON error: %s", err.c_str());
        createDefaultConfig();
    } else {
        storageApplyJson(doc);
        LOG_INFO(LOG_CAT_CONFIG, "Config loaded");
    }
}
