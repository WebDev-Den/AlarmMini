#pragma once
#include <LittleFS.h>
#include <ArduinoJson.h>
#include "config.h"
#include "logger.h"

AppConfig gConfig;

constexpr size_t CONFIG_JSON_CAPACITY = 8192;
constexpr int DEFAULT_BUZZER_REGION_INDEX = 20;

int findRegionIndex(const char* query) {
    if (!query || strlen(query) == 0) return -1;
    for (int i = 0; i < REGIONS_COUNT; i++) {
        if (strstr(REGIONS[i], query) != nullptr) return i;
    }
    return -1;
}

int regionIndexFromVariant(JsonVariantConst value) {
    if (value.is<int>() || value.is<long>() || value.is<unsigned int>() || value.is<unsigned long>()) {
        int idx = value.as<int>();
        return (idx >= 0 && idx < REGIONS_COUNT) ? idx : -1;
    }

    const char* region = value.as<const char*>();
    return findRegionIndex(region);
}

uint8_t readU8(JsonVariantConst value, uint8_t fallback = 0) {
    if (value.isNull()) return fallback;
    return (uint8_t)value.as<int>();
}

uint16_t readU16(JsonVariantConst value, uint16_t fallback = 0) {
    if (value.isNull()) return fallback;
    return (uint16_t)value.as<unsigned int>();
}

bool readBool(JsonVariantConst value, bool fallback = false) {
    if (value.isNull()) return fallback;
    return value.as<bool>();
}

const char* readStr(JsonVariantConst value, const char* fallback = "") {
    if (value.isNull()) return fallback;
    const char* text = value.as<const char*>();
    return text ? text : fallback;
}

void copyBounded(char* dst, size_t size, const char* value) {
    strncpy(dst, value ? value : "", size - 1);
    dst[size - 1] = '\0';
}

Color readColor(JsonVariantConst compactValue,
                JsonVariantConst legacyR,
                JsonVariantConst legacyG,
                JsonVariantConst legacyB,
                JsonVariantConst legacyA)
{
    JsonArrayConst compact = compactValue.as<JsonArrayConst>();
    if (!compact.isNull() && compact.size() >= 4) {
        return {readU8(compact[0]), readU8(compact[1]), readU8(compact[2]), readU8(compact[3])};
    }

    return {readU8(legacyR), readU8(legacyG), readU8(legacyB), readU8(legacyA)};
}

void storageApplyJson(DynamicJsonDocument& doc) {
    JsonObjectConst compactColors = doc["c"];
    JsonObjectConst compactDay = compactColors["d"];
    JsonObjectConst compactNightColors = compactColors["n"];
    JsonObjectConst compactNight = doc["n"];
    JsonObjectConst compactBuzzer = doc["z"];
    JsonObjectConst compactBlink = doc["k"];
    JsonObjectConst compactWifi = doc["w"];
    JsonObjectConst compactMqtt = doc["m"];

    gConfig.dayMode.alertColor = readColor(compactDay["a"], doc["dayAlertR"], doc["dayAlertG"], doc["dayAlertB"], doc["dayAlertA"]);
    gConfig.dayMode.clearColor = readColor(compactDay["c"], doc["dayClearR"], doc["dayClearG"], doc["dayClearB"], doc["dayClearA"]);
    gConfig.nightMode.alertColor = readColor(compactNightColors["a"], doc["nightAlertR"], doc["nightAlertG"], doc["nightAlertB"], doc["nightAlertA"]);
    gConfig.nightMode.clearColor = readColor(compactNightColors["c"], doc["nightClearR"], doc["nightClearG"], doc["nightClearB"], doc["nightClearA"]);

    JsonArrayConst nightStart = compactNight["s"];
    JsonArrayConst nightEnd = compactNight["x"];
    JsonArrayConst nightPulse = compactNight["p"];
    gConfig.night.enabled = compactNight.containsKey("e") ? readBool(compactNight["e"]) : readBool(doc["nightEnabled"]);
    gConfig.night.startHour = !nightStart.isNull() && nightStart.size() > 0 ? readU8(nightStart[0]) : readU8(doc["nightStartH"]);
    gConfig.night.startMinute = !nightStart.isNull() && nightStart.size() > 1 ? readU8(nightStart[1]) : readU8(doc["nightStartM"]);
    gConfig.night.endHour = !nightEnd.isNull() && nightEnd.size() > 0 ? readU8(nightEnd[0]) : readU8(doc["nightEndH"]);
    gConfig.night.endMinute = !nightEnd.isNull() && nightEnd.size() > 1 ? readU8(nightEnd[1]) : readU8(doc["nightEndM"]);
    gConfig.night.maxBrightness = compactNight.containsKey("b") ? readU8(compactNight["b"], 150) : readU8(doc["nightMaxBright"], 150);
    gConfig.night.pulseOnAlert = !nightPulse.isNull() && nightPulse.size() > 0 ? readBool(nightPulse[0]) : readBool(doc["nightPulseAlert"]);
    gConfig.night.pulseOnClear = !nightPulse.isNull() && nightPulse.size() > 1 ? readBool(nightPulse[1]) : readBool(doc["nightPulseClear"]);

    JsonArrayConst buzzerVolume = compactBuzzer["v"];
    gConfig.buzzer.enabled = compactBuzzer.containsKey("e") ? readBool(compactBuzzer["e"]) : readBool(doc["buzzerEnabled"]);
    gConfig.buzzer.dayVolume = !buzzerVolume.isNull() && buzzerVolume.size() > 0 ? readU8(buzzerVolume[0], 80) : readU8(doc["buzzerDayVol"], 80);
    gConfig.buzzer.nightVolume = !buzzerVolume.isNull() && buzzerVolume.size() > 1 ? readU8(buzzerVolume[1], 30) : readU8(doc["buzzerNightVol"], 30);

    JsonArrayConst blinkIntensity = compactBlink["i"];
    gConfig.blink.enabled = compactBlink.containsKey("e") ? readBool(compactBlink["e"], true) : readBool(doc["blinkEnabled"], true);
    gConfig.blink.dayIntensity = !blinkIntensity.isNull() && blinkIntensity.size() > 0 ? readU8(blinkIntensity[0], 75) : readU8(doc["blinkDayInt"], 75);
    gConfig.blink.nightIntensity = !blinkIntensity.isNull() && blinkIntensity.size() > 1 ? readU8(blinkIntensity[1], 30) : readU8(doc["blinkNightInt"], 30);

    copyBounded(gConfig.wifiSsid, WIFI_SSID_MAXLEN, compactWifi.containsKey("s") ? readStr(compactWifi["s"]) : readStr(doc["wifiSsid"]));
    copyBounded(gConfig.wifiPass, WIFI_PASS_MAXLEN, compactWifi.containsKey("p") ? readStr(compactWifi["p"]) : readStr(doc["wifiPass"]));
    copyBounded(gConfig.mqttHost, MQTT_HOST_MAXLEN, compactMqtt.containsKey("h") ? readStr(compactMqtt["h"]) : readStr(doc["mqttHost"]));
    copyBounded(gConfig.mqttTopic, MQTT_TOPIC_MAXLEN, compactMqtt.containsKey("t") ? readStr(compactMqtt["t"]) : readStr(doc["mqttTopic"]));
    copyBounded(gConfig.mqttUser, MQTT_USER_MAXLEN, compactMqtt.containsKey("u") ? readStr(compactMqtt["u"]) : readStr(doc["mqttUser"]));
    copyBounded(gConfig.mqttPass, MQTT_PASS_MAXLEN, compactMqtt.containsKey("s") ? readStr(compactMqtt["s"]) : readStr(doc["mqttPass"]));

    JsonArrayConst ntp = doc["t"];
    copyBounded(gConfig.ntpServer1, NTP_SERVER_MAXLEN, !ntp.isNull() && ntp.size() > 0 ? readStr(ntp[0]) : readStr(doc["ntpServer1"]));
    copyBounded(gConfig.ntpServer2, NTP_SERVER_MAXLEN, !ntp.isNull() && ntp.size() > 1 ? readStr(ntp[1]) : readStr(doc["ntpServer2"]));
    copyBounded(gConfig.ntpServer3, NTP_SERVER_MAXLEN, !ntp.isNull() && ntp.size() > 2 ? readStr(ntp[2]) : readStr(doc["ntpServer3"]));

    gConfig.mqttPort = compactMqtt.containsKey("p") ? readU16(compactMqtt["p"], 1883) : readU16(doc["mqttPort"], 1883);
    gConfig.logMask = doc.containsKey("g") ? readU16(doc["g"], LOG_MASK_ALL) : readU16(doc["logMask"], LOG_MASK_ALL);

    JsonArrayConst ledsCompact = doc["l"].as<JsonArrayConst>();
    JsonArrayConst ledsCurrent = doc["ledRegionIds"].as<JsonArrayConst>();
    JsonArrayConst ledsLegacy = doc["leds"].as<JsonArrayConst>();
    JsonArrayConst leds = !ledsCompact.isNull() ? ledsCompact : (!ledsCurrent.isNull() ? ledsCurrent : ledsLegacy);
    gConfig.ledCount = MAX_LEDS;
    for (int i = 0; i < MAX_LEDS; i++) {
        gConfig.ledRegion[i] = -1;
        if (i < (int)leds.size()) {
            gConfig.ledRegion[i] = regionIndexFromVariant(leds[i]);
        }
    }

    for (int i = 0; i < REGIONS_COUNT; i++) gConfig.buzzer.regions[i] = false;
    JsonArrayConst buzCompact = compactBuzzer["r"].as<JsonArrayConst>();
    JsonArrayConst buzCurrent = doc["buzzerRegionIds"].as<JsonArrayConst>();
    JsonArrayConst buzLegacy = doc["buzzerRegions"].as<JsonArrayConst>();
    JsonArrayConst buzRegions = !buzCompact.isNull() ? buzCompact : (!buzCurrent.isNull() ? buzCurrent : buzLegacy);
    for (JsonVariantConst v : buzRegions) {
        int idx = regionIndexFromVariant(v);
        if (idx >= 0) gConfig.buzzer.regions[idx] = true;
    }
}

void storagePopulateJson(DynamicJsonDocument& doc) {
    JsonObject colors = doc.createNestedObject("c");
    JsonObject day = colors.createNestedObject("d");
    JsonArray dayAlert = day.createNestedArray("a");
    dayAlert.add(gConfig.dayMode.alertColor.r);
    dayAlert.add(gConfig.dayMode.alertColor.g);
    dayAlert.add(gConfig.dayMode.alertColor.b);
    dayAlert.add(gConfig.dayMode.alertColor.a);
    JsonArray dayClear = day.createNestedArray("c");
    dayClear.add(gConfig.dayMode.clearColor.r);
    dayClear.add(gConfig.dayMode.clearColor.g);
    dayClear.add(gConfig.dayMode.clearColor.b);
    dayClear.add(gConfig.dayMode.clearColor.a);

    JsonObject nightColors = colors.createNestedObject("n");
    JsonArray nightAlert = nightColors.createNestedArray("a");
    nightAlert.add(gConfig.nightMode.alertColor.r);
    nightAlert.add(gConfig.nightMode.alertColor.g);
    nightAlert.add(gConfig.nightMode.alertColor.b);
    nightAlert.add(gConfig.nightMode.alertColor.a);
    JsonArray nightClear = nightColors.createNestedArray("c");
    nightClear.add(gConfig.nightMode.clearColor.r);
    nightClear.add(gConfig.nightMode.clearColor.g);
    nightClear.add(gConfig.nightMode.clearColor.b);
    nightClear.add(gConfig.nightMode.clearColor.a);

    JsonObject night = doc.createNestedObject("n");
    night["e"] = gConfig.night.enabled;
    JsonArray nightStart = night.createNestedArray("s");
    nightStart.add(gConfig.night.startHour);
    nightStart.add(gConfig.night.startMinute);
    JsonArray nightEnd = night.createNestedArray("x");
    nightEnd.add(gConfig.night.endHour);
    nightEnd.add(gConfig.night.endMinute);
    night["b"] = gConfig.night.maxBrightness;
    JsonArray nightPulse = night.createNestedArray("p");
    nightPulse.add(gConfig.night.pulseOnAlert);
    nightPulse.add(gConfig.night.pulseOnClear);

    JsonObject buzzer = doc.createNestedObject("z");
    buzzer["e"] = gConfig.buzzer.enabled;
    JsonArray buzzerVolume = buzzer.createNestedArray("v");
    buzzerVolume.add(gConfig.buzzer.dayVolume);
    buzzerVolume.add(gConfig.buzzer.nightVolume);
    JsonArray buzzerRegions = buzzer.createNestedArray("r");
    for (int i = 0; i < REGIONS_COUNT; i++) {
        if (gConfig.buzzer.regions[i]) buzzerRegions.add(i);
    }

    JsonObject blink = doc.createNestedObject("k");
    blink["e"] = gConfig.blink.enabled;
    JsonArray blinkIntensity = blink.createNestedArray("i");
    blinkIntensity.add(gConfig.blink.dayIntensity);
    blinkIntensity.add(gConfig.blink.nightIntensity);

    JsonArray leds = doc.createNestedArray("l");
    for (int i = 0; i < MAX_LEDS; i++) {
        int8_t regionIndex = gConfig.ledRegion[i];
        leds.add((regionIndex >= 0 && regionIndex < REGIONS_COUNT) ? regionIndex : -1);
    }

    JsonObject mqtt = doc.createNestedObject("m");
    mqtt["h"] = gConfig.mqttHost;
    mqtt["p"] = gConfig.mqttPort;
    mqtt["t"] = gConfig.mqttTopic;
    mqtt["u"] = gConfig.mqttUser;
    mqtt["s"] = gConfig.mqttPass;

    JsonObject wifi = doc.createNestedObject("w");
    wifi["s"] = gConfig.wifiSsid;
    wifi["p"] = gConfig.wifiPass;

    JsonArray ntp = doc.createNestedArray("t");
    ntp.add(gConfig.ntpServer1);
    ntp.add(gConfig.ntpServer2);
    ntp.add(gConfig.ntpServer3);

    doc["g"] = gConfig.logMask;
}

void storageSaveCurrentConfig() {
    DynamicJsonDocument doc(CONFIG_JSON_CAPACITY);
    storagePopulateJson(doc);

    File f = LittleFS.open("/config.json", "w");
    if (!f) {
        LOG_ERROR(LOG_CAT_CONFIG, "Failed to open config.json for write");
        return;
    }
    serializeJson(doc, f);
    f.close();
}

bool storageSyncWifiCredentials() {
    String currentSsid = WiFi.SSID();
    String currentPass = WiFi.psk();
    currentSsid.trim();
    currentPass.trim();

    bool changed = currentSsid != String(gConfig.wifiSsid) || currentPass != String(gConfig.wifiPass);
    if (!changed) return false;

    copyBounded(gConfig.wifiSsid, WIFI_SSID_MAXLEN, currentSsid.c_str());
    copyBounded(gConfig.wifiPass, WIFI_PASS_MAXLEN, currentPass.c_str());
    storageSaveCurrentConfig();
    LOG_INFO(LOG_CAT_CONFIG, "WiFi credentials synced to config");
    return true;
}

void createDefaultConfig() {
    DynamicJsonDocument doc(CONFIG_JSON_CAPACITY);

    JsonObject colors = doc.createNestedObject("c");
    JsonObject day = colors.createNestedObject("d");
    JsonArray dayAlert = day.createNestedArray("a");
    dayAlert.add(255); dayAlert.add(0); dayAlert.add(0); dayAlert.add(255);
    JsonArray dayClear = day.createNestedArray("c");
    dayClear.add(0); dayClear.add(80); dayClear.add(0); dayClear.add(255);

    JsonObject nightColors = colors.createNestedObject("n");
    JsonArray nightAlert = nightColors.createNestedArray("a");
    nightAlert.add(80); nightAlert.add(0); nightAlert.add(0); nightAlert.add(255);
    JsonArray nightClear = nightColors.createNestedArray("c");
    nightClear.add(0); nightClear.add(15); nightClear.add(0); nightClear.add(255);

    JsonObject night = doc.createNestedObject("n");
    night["e"] = true;
    JsonArray nightStart = night.createNestedArray("s");
    nightStart.add(22); nightStart.add(0);
    JsonArray nightEnd = night.createNestedArray("x");
    nightEnd.add(7); nightEnd.add(0);
    night["b"] = 150;
    JsonArray nightPulse = night.createNestedArray("p");
    nightPulse.add(false); nightPulse.add(false);

    JsonObject buzzer = doc.createNestedObject("z");
    buzzer["e"] = true;
    JsonArray buzzerVolume = buzzer.createNestedArray("v");
    buzzerVolume.add(80); buzzerVolume.add(30);
    JsonArray buzzerRegions = buzzer.createNestedArray("r");
    buzzerRegions.add(DEFAULT_BUZZER_REGION_INDEX);

    JsonObject blink = doc.createNestedObject("k");
    blink["e"] = true;
    JsonArray blinkIntensity = blink.createNestedArray("i");
    blinkIntensity.add(75); blinkIntensity.add(30);

    JsonArray leds = doc.createNestedArray("l");
    for (int i = 0; i < MAX_LEDS; i++) leds.add(-1);

    JsonObject mqtt = doc.createNestedObject("m");
    mqtt["h"] = "";
    mqtt["p"] = 1883;
    mqtt["t"] = "alerts/status";
    mqtt["u"] = "";
    mqtt["s"] = "";

    JsonObject wifi = doc.createNestedObject("w");
    wifi["s"] = "";
    wifi["p"] = "";

    JsonArray ntp = doc.createNestedArray("t");
    ntp.add("");
    ntp.add("");
    ntp.add("");

    doc["g"] = LOG_MASK_ALL;

    storageApplyJson(doc);
    storageSaveCurrentConfig();
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
