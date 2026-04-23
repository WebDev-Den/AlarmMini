#include "storage.h"
#include "reset_trace.h"
#include "platform_compat.h"

#include <LittleFS.h>

namespace
{
constexpr char CONFIG_PATH[] = "/amcfg.json";
constexpr char CONFIG_TMP_PATH[] = "/amcfg.tmp";
constexpr char CONFIG_BAK_PATH[] = "/amcfg.bak";
constexpr int DEFAULT_BUZZER_REGION_INDEX = 20;
constexpr uint32_t CONFIG_MAGIC = 0x414D4346UL; // AMCF
constexpr uint16_t LOG_MASK_DEFAULT_RUNTIME =
    LOG_CAT_SYSTEM | LOG_CAT_WIFI | LOG_CAT_INTERNET |
    LOG_CAT_MQTT | LOG_CAT_WEB | LOG_CAT_CONFIG;

uint32_t gLastSavedCrc = 0;
bool loadEnvelopeFromPath(const char *path, DynamicJsonDocument &root);

bool isNumber(JsonVariantConst v)
{
    return v.is<int>() || v.is<long>() || v.is<unsigned int>() || v.is<unsigned long>() ||
           v.is<float>() || v.is<double>();
}

bool readObject(JsonVariantConst root, const char *key, JsonObjectConst &out)
{
    out = root[key].as<JsonObjectConst>();
    return !out.isNull();
}

bool isStringWithin(JsonVariantConst value, size_t maxLen)
{
    if (value.isNull())
        return false;
    const char *text = value.as<const char *>();
    return text && strlen(text) < maxLen;
}

bool validateColorArray(JsonVariantConst value)
{
    JsonArrayConst arr = value.as<JsonArrayConst>();
    if (arr.isNull() || arr.size() != 4)
        return false;
    for (uint8_t i = 0; i < 4; i++)
    {
        if (!isNumber(arr[i]))
            return false;
    }
    return true;
}

bool validateFullConfigJson(JsonVariantConst cfg, char *error, size_t errorSize)
{
    auto setErr = [&](const char *code)
    {
        if (error && errorSize)
            snprintf(error, errorSize, "%s", code);
    };

    if (cfg.isNull() || !cfg.is<JsonObjectConst>())
    {
        setErr("cfg_invalid");
        return false;
    }

    JsonObjectConst c;
    if (!readObject(cfg, "c", c))
    {
        setErr("miss_c");
        return false;
    }
    JsonObjectConst cDay;
    JsonObjectConst cNight;
    if (!readObject(c, "d", cDay) || !readObject(c, "n", cNight) ||
        !validateColorArray(cDay["a"]) || !validateColorArray(cDay["c"]) ||
        !validateColorArray(cNight["a"]) || !validateColorArray(cNight["c"]))
    {
        setErr("bad_c");
        return false;
    }

    JsonObjectConst n;
    if (!readObject(cfg, "n", n))
    {
        setErr("miss_n");
        return false;
    }
    JsonArrayConst nStart = n["s"].as<JsonArrayConst>();
    JsonArrayConst nEnd = n["x"].as<JsonArrayConst>();
    JsonArrayConst nPulse = n["p"].as<JsonArrayConst>();
    if (n["e"].isNull() || nStart.isNull() || nEnd.isNull() || nPulse.isNull() ||
        nStart.size() != 2 || nEnd.size() != 2 || nPulse.size() != 2 ||
        !isNumber(n["b"]))
    {
        setErr("bad_n");
        return false;
    }

    JsonObjectConst z;
    if (!readObject(cfg, "z", z))
    {
        setErr("miss_z");
        return false;
    }
    JsonArrayConst zVol = z["v"].as<JsonArrayConst>();
    JsonArrayConst zReg = z["r"].as<JsonArrayConst>();
    if (z["e"].isNull() || zVol.isNull() || zVol.size() != 2 || zReg.isNull())
    {
        setErr("bad_z");
        return false;
    }

    JsonObjectConst k;
    if (!readObject(cfg, "k", k))
    {
        setErr("miss_k");
        return false;
    }
    JsonArrayConst kInt = k["i"].as<JsonArrayConst>();
    if (k["e"].isNull() || kInt.isNull() || kInt.size() != 2)
    {
        setErr("bad_k");
        return false;
    }

    JsonArrayConst leds = cfg["l"].as<JsonArrayConst>();
    if (leds.isNull() || leds.size() != MAX_LEDS)
    {
        setErr("bad_l");
        return false;
    }

    JsonObjectConst m;
    if (!readObject(cfg, "m", m) ||
        !isStringWithin(m["h"], MQTT_HOST_MAXLEN) ||
        !isNumber(m["p"]) ||
        !isStringWithin(m["t"], MQTT_TOPIC_MAXLEN) ||
        !isStringWithin(m["u"], MQTT_USER_MAXLEN) ||
        !isStringWithin(m["s"], MQTT_PASS_MAXLEN))
    {
        setErr("bad_m");
        return false;
    }
    const long mqttPort = m["p"].as<long>();
    if (mqttPort <= 0 || mqttPort > 65535)
    {
        setErr("bad_m_port");
        return false;
    }

    JsonObjectConst w;
    if (!readObject(cfg, "w", w) ||
        !isStringWithin(w["s"], WIFI_SSID_MAXLEN) ||
        !isStringWithin(w["p"], WIFI_PASS_MAXLEN))
    {
        setErr("bad_w");
        return false;
    }

    JsonArrayConst t = cfg["t"].as<JsonArrayConst>();
    if (t.isNull() || t.size() != 3 ||
        !isStringWithin(t[0], NTP_SERVER_MAXLEN) ||
        !isStringWithin(t[1], NTP_SERVER_MAXLEN) ||
        !isStringWithin(t[2], NTP_SERVER_MAXLEN))
    {
        setErr("bad_t");
        return false;
    }

    if (!isNumber(cfg["g"]))
    {
        setErr("bad_g");
        return false;
    }

    if (error && errorSize)
        error[0] = '\0';
    return true;
}

uint8_t clampU8(int value, int minValue, int maxValue)
{
    if (value < minValue)
        return (uint8_t)minValue;
    if (value > maxValue)
        return (uint8_t)maxValue;
    return (uint8_t)value;
}

uint16_t clampU16(int value, int minValue, int maxValue)
{
    if (value < minValue)
        return (uint16_t)minValue;
    if (value > maxValue)
        return (uint16_t)maxValue;
    return (uint16_t)value;
}

void copyBounded(char *dst, size_t size, const char *value)
{
    if (!dst || size == 0)
        return;

    strncpy(dst, value ? value : "", size - 1);
    dst[size - 1] = '\0';
}

int findRegionIndex(const char *query)
{
    if (!query || !query[0])
        return -1;

    for (int i = 0; i < REGIONS_COUNT; i++)
    {
        if (strstr(REGIONS[i], query) != nullptr)
            return i;
    }

    return -1;
}

int regionIndexFromVariant(JsonVariantConst value)
{
    if (value.is<int>() || value.is<long>() || value.is<unsigned int>() || value.is<unsigned long>())
    {
        int idx = value.as<int>();
        return (idx >= 0 && idx < REGIONS_COUNT) ? idx : -1;
    }

    return findRegionIndex(value.as<const char *>());
}

uint8_t readU8(JsonVariantConst value, uint8_t fallback = 0)
{
    return value.isNull() ? fallback : (uint8_t)value.as<int>();
}

uint16_t readU16(JsonVariantConst value, uint16_t fallback = 0)
{
    return value.isNull() ? fallback : (uint16_t)value.as<unsigned int>();
}

bool readBool(JsonVariantConst value, bool fallback = false)
{
    return value.isNull() ? fallback : value.as<bool>();
}

const char *readStr(JsonVariantConst value, const char *fallback = "")
{
    if (value.isNull())
        return fallback;

    const char *text = value.as<const char *>();
    return text ? text : fallback;
}

Color readColor(JsonVariantConst compactValue,
                JsonVariantConst legacyR,
                JsonVariantConst legacyG,
                JsonVariantConst legacyB,
                JsonVariantConst legacyA)
{
    JsonArrayConst compact = compactValue.as<JsonArrayConst>();
    if (!compact.isNull() && compact.size() >= 4)
    {
        return {
            clampU8(readU8(compact[0]), 0, 255),
            clampU8(readU8(compact[1]), 0, 255),
            clampU8(readU8(compact[2]), 0, 255),
            clampU8(readU8(compact[3]), 0, 255)};
    }

    return {
        clampU8(readU8(legacyR), 0, 255),
        clampU8(readU8(legacyG), 0, 255),
        clampU8(readU8(legacyB), 0, 255),
        clampU8(readU8(legacyA), 0, 255)};
}

void applyDefaults()
{
    memset(&gConfig, 0, sizeof(gConfig));

    gConfig.ledCount = MAX_LEDS;
    for (int i = 0; i < MAX_LEDS; i++)
        gConfig.ledRegion[i] = -1;

    gConfig.dayMode.alertColor = {255, 0, 0, 255};
    gConfig.dayMode.clearColor = {0, 80, 0, 255};
    gConfig.nightMode.alertColor = {80, 0, 0, 255};
    gConfig.nightMode.clearColor = {0, 15, 0, 255};

    gConfig.night.enabled = true;
    gConfig.night.startHour = 22;
    gConfig.night.startMinute = 0;
    gConfig.night.endHour = 7;
    gConfig.night.endMinute = 0;
    gConfig.night.maxBrightness = 150;
    gConfig.night.pulseOnAlert = false;
    gConfig.night.pulseOnClear = false;

    gConfig.buzzer.enabled = true;
    gConfig.buzzer.dayVolume = 80;
    gConfig.buzzer.nightVolume = 30;
    for (int i = 0; i < REGIONS_COUNT; i++)
        gConfig.buzzer.regions[i] = false;
    if (DEFAULT_BUZZER_REGION_INDEX >= 0 && DEFAULT_BUZZER_REGION_INDEX < REGIONS_COUNT)
        gConfig.buzzer.regions[DEFAULT_BUZZER_REGION_INDEX] = true;
    gConfig.offline.autonomousSeconds = 60;
    gConfig.offline.pulseAmplitudePct = 60;
    gConfig.offline.pulseDurationMs = 2400;

    gConfig.blink.enabled = true;
    gConfig.blink.dayIntensity = 75;
    gConfig.blink.nightIntensity = 30;

    gConfig.mqttPort = 1883;
    copyBounded(gConfig.mqttTopic, MQTT_TOPIC_MAXLEN, "alerts/status");
    gConfig.logMask = LOG_MASK_DEFAULT_RUNTIME;
}

uint32_t crc32Step(uint32_t crc, uint8_t byte)
{
    crc ^= byte;
    for (uint8_t i = 0; i < 8; i++)
    {
        const uint32_t mask = -(int32_t)(crc & 1U);
        crc = (crc >> 1) ^ (0xEDB88320UL & mask);
    }
    return crc;
}

class Crc32Writer : public Print
{
public:
    explicit Crc32Writer(uint32_t &target) : _target(target) {}

    size_t write(uint8_t ch) override
    {
        _target = crc32Step(_target, ch);
        return 1;
    }

private:
    uint32_t &_target;
};

uint32_t computeConfigCrc(JsonVariantConst cfg)
{
    uint32_t crc = 0xFFFFFFFFUL;
    Crc32Writer writer(crc);
    serializeJson(cfg, writer);
    return crc ^ 0xFFFFFFFFUL;
}

bool writeEnvelopeAtomically(JsonVariantConst config, uint32_t crc)
{
    resetTraceSetStage("cfg_write_begin");
    File tmp = LittleFS.open(CONFIG_TMP_PATH, "w");
    if (!tmp)
    {
        LOG_ERROR(LOG_CAT_CONFIG, "Cannot open %s", CONFIG_TMP_PATH);
        return false;
    }

    char header[96];
    const int headerLen = snprintf(header, sizeof(header),
                                   "{\"magic\":%lu,\"v\":%u,\"crc\":%lu,\"cfg\":",
                                   (unsigned long)CONFIG_MAGIC,
                                   (unsigned int)CONFIG_SCHEMA_VERSION,
                                   (unsigned long)crc);
    const size_t b0 = (headerLen > 0 && (size_t)headerLen < sizeof(header))
                          ? tmp.write((const uint8_t *)header, (size_t)headerLen)
                          : 0;
    const size_t cfgBytes = serializeJson(config, tmp);
    const size_t b1 = tmp.write((const uint8_t *)"}", 1);

    if (b0 == 0 || cfgBytes == 0 || b1 == 0 || tmp.getWriteError())
    {
        tmp.close();
        LittleFS.remove(CONFIG_TMP_PATH);
        LOG_ERROR(LOG_CAT_CONFIG, "Serialize config failed");
        return false;
    }

    tmp.flush();
    tmp.close();

    LittleFS.remove(CONFIG_BAK_PATH);
    if (LittleFS.exists(CONFIG_PATH))
        LittleFS.rename(CONFIG_PATH, CONFIG_BAK_PATH);

    if (!LittleFS.rename(CONFIG_TMP_PATH, CONFIG_PATH))
    {
        LOG_ERROR(LOG_CAT_CONFIG, "Atomic rename failed");
        if (LittleFS.exists(CONFIG_BAK_PATH))
            LittleFS.rename(CONFIG_BAK_PATH, CONFIG_PATH);
        LittleFS.remove(CONFIG_TMP_PATH);
        return false;
    }

    resetTraceSetStage("cfg_write_done");
    return true;
}

bool loadEnvelopeFromPath(const char *path, DynamicJsonDocument &root)
{
    File f = LittleFS.open(path, "r");
    if (!f)
        return false;

    const auto err = deserializeJson(root, f);
    f.close();
    if (err != DeserializationError::Ok)
        LOG_WARN(LOG_CAT_CONFIG, "JSON parse error in %s: %s", path, err.c_str());
    return err == DeserializationError::Ok;
}

void sanitizeConfig()
{
    gConfig.ledCount = clampU8(gConfig.ledCount, 1, MAX_LEDS);

    for (int i = 0; i < MAX_LEDS; i++)
    {
        if (gConfig.ledRegion[i] < 0 || gConfig.ledRegion[i] >= REGIONS_COUNT)
            gConfig.ledRegion[i] = -1;
    }

    gConfig.night.startHour = clampU8(gConfig.night.startHour, 0, 23);
    gConfig.night.endHour = clampU8(gConfig.night.endHour, 0, 23);
    gConfig.night.startMinute = clampU8(gConfig.night.startMinute, 0, 59);
    gConfig.night.endMinute = clampU8(gConfig.night.endMinute, 0, 59);
    gConfig.night.maxBrightness = clampU8(gConfig.night.maxBrightness, 0, 255);

    gConfig.buzzer.dayVolume = clampU8(gConfig.buzzer.dayVolume, 0, 100);
    gConfig.buzzer.nightVolume = clampU8(gConfig.buzzer.nightVolume, 0, 100);

    gConfig.blink.dayIntensity = clampU8(gConfig.blink.dayIntensity, 0, 100);
    gConfig.blink.nightIntensity = clampU8(gConfig.blink.nightIntensity, 0, 100);

    gConfig.mqttPort = clampU16(gConfig.mqttPort == 0 ? 1883 : gConfig.mqttPort, 1, 65535);
    gConfig.offline.autonomousSeconds = clampU16(gConfig.offline.autonomousSeconds == 0 ? 60 : gConfig.offline.autonomousSeconds, 5, 600);
    gConfig.offline.pulseAmplitudePct = clampU8(gConfig.offline.pulseAmplitudePct, 0, 100);
    gConfig.offline.pulseDurationMs = clampU16(gConfig.offline.pulseDurationMs == 0 ? 2400 : gConfig.offline.pulseDurationMs, 400, 10000);
    gConfig.logMask &= LOG_MASK_ALL;
}

} // namespace

AppConfig gConfig;

void storageApplyJson(JsonVariantConst doc)
{
    JsonObjectConst compactColors = doc["c"];
    JsonObjectConst compactDay = compactColors["d"];
    JsonObjectConst compactNightColors = compactColors["n"];
    JsonObjectConst compactNight = doc["n"];
    JsonObjectConst compactBuzzer = doc["z"];
    JsonObjectConst compactBlink = doc["k"];
    JsonObjectConst compactOffline = doc["o"];
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
    gConfig.night.startHour = !nightStart.isNull() && nightStart.size() > 0 ? readU8(nightStart[0]) : readU8(doc["nightStartH"], 22);
    gConfig.night.startMinute = !nightStart.isNull() && nightStart.size() > 1 ? readU8(nightStart[1]) : readU8(doc["nightStartM"], 0);
    gConfig.night.endHour = !nightEnd.isNull() && nightEnd.size() > 0 ? readU8(nightEnd[0]) : readU8(doc["nightEndH"], 7);
    gConfig.night.endMinute = !nightEnd.isNull() && nightEnd.size() > 1 ? readU8(nightEnd[1]) : readU8(doc["nightEndM"], 0);
    gConfig.night.maxBrightness = compactNight.containsKey("b") ? readU8(compactNight["b"], 150) : readU8(doc["nightMaxBright"], 150);
    gConfig.night.pulseOnAlert = !nightPulse.isNull() && nightPulse.size() > 0 ? readBool(nightPulse[0]) : readBool(doc["nightPulseAlert"]);
    gConfig.night.pulseOnClear = !nightPulse.isNull() && nightPulse.size() > 1 ? readBool(nightPulse[1]) : readBool(doc["nightPulseClear"]);

    JsonArrayConst buzzerVolume = compactBuzzer["v"];
    gConfig.buzzer.enabled = compactBuzzer.containsKey("e") ? readBool(compactBuzzer["e"], true) : readBool(doc["buzzerEnabled"], true);
    gConfig.buzzer.dayVolume = !buzzerVolume.isNull() && buzzerVolume.size() > 0 ? readU8(buzzerVolume[0], 80) : readU8(doc["buzzerDayVol"], 80);
    gConfig.buzzer.nightVolume = !buzzerVolume.isNull() && buzzerVolume.size() > 1 ? readU8(buzzerVolume[1], 30) : readU8(doc["buzzerNightVol"], 30);

    JsonArrayConst blinkIntensity = compactBlink["i"];
    gConfig.blink.enabled = compactBlink.containsKey("e") ? readBool(compactBlink["e"], true) : readBool(doc["blinkEnabled"], true);
    gConfig.blink.dayIntensity = !blinkIntensity.isNull() && blinkIntensity.size() > 0 ? readU8(blinkIntensity[0], 75) : readU8(doc["blinkDayInt"], 75);
    gConfig.blink.nightIntensity = !blinkIntensity.isNull() && blinkIntensity.size() > 1 ? readU8(blinkIntensity[1], 30) : readU8(doc["blinkNightInt"], 30);
    gConfig.offline.autonomousSeconds = compactOffline.containsKey("a")
                                            ? readU16(compactOffline["a"], 60)
                                            : readU16(doc["offlineAutonomousSeconds"], 60);
    gConfig.offline.pulseAmplitudePct = compactOffline.containsKey("p")
                                            ? readU8(compactOffline["p"], 60)
                                            : readU8(doc["pulseAmplitudePct"], 60);
    gConfig.offline.pulseDurationMs = compactOffline.containsKey("d")
                                          ? readU16(compactOffline["d"], 2400)
                                          : readU16(doc["pulseDurationMs"], 2400);

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
    for (int i = 0; i < MAX_LEDS; i++)
    {
        gConfig.ledRegion[i] = -1;
        if (i < (int)leds.size())
            gConfig.ledRegion[i] = regionIndexFromVariant(leds[i]);
    }

    for (int i = 0; i < REGIONS_COUNT; i++)
        gConfig.buzzer.regions[i] = false;

    JsonArrayConst buzCompact = compactBuzzer["r"].as<JsonArrayConst>();
    JsonArrayConst buzCurrent = doc["buzzerRegionIds"].as<JsonArrayConst>();
    JsonArrayConst buzLegacy = doc["buzzerRegions"].as<JsonArrayConst>();
    JsonArrayConst buzRegions = !buzCompact.isNull() ? buzCompact : (!buzCurrent.isNull() ? buzCurrent : buzLegacy);

    for (JsonVariantConst v : buzRegions)
    {
        const int idx = regionIndexFromVariant(v);
        if (idx >= 0)
            gConfig.buzzer.regions[idx] = true;
    }

    sanitizeConfig();
}

void storagePopulateJson(JsonDocument &doc)
{
    doc.clear();

    JsonObject colors = doc["c"].to<JsonObject>();
    JsonObject day = colors["d"].to<JsonObject>();
    JsonArray dayAlert = day["a"].to<JsonArray>();
    dayAlert.add(gConfig.dayMode.alertColor.r);
    dayAlert.add(gConfig.dayMode.alertColor.g);
    dayAlert.add(gConfig.dayMode.alertColor.b);
    dayAlert.add(gConfig.dayMode.alertColor.a);

    JsonArray dayClear = day["c"].to<JsonArray>();
    dayClear.add(gConfig.dayMode.clearColor.r);
    dayClear.add(gConfig.dayMode.clearColor.g);
    dayClear.add(gConfig.dayMode.clearColor.b);
    dayClear.add(gConfig.dayMode.clearColor.a);

    JsonObject nightColors = colors["n"].to<JsonObject>();
    JsonArray nightAlert = nightColors["a"].to<JsonArray>();
    nightAlert.add(gConfig.nightMode.alertColor.r);
    nightAlert.add(gConfig.nightMode.alertColor.g);
    nightAlert.add(gConfig.nightMode.alertColor.b);
    nightAlert.add(gConfig.nightMode.alertColor.a);

    JsonArray nightClear = nightColors["c"].to<JsonArray>();
    nightClear.add(gConfig.nightMode.clearColor.r);
    nightClear.add(gConfig.nightMode.clearColor.g);
    nightClear.add(gConfig.nightMode.clearColor.b);
    nightClear.add(gConfig.nightMode.clearColor.a);

    JsonObject night = doc["n"].to<JsonObject>();
    night["e"] = gConfig.night.enabled;
    JsonArray nightStart = night["s"].to<JsonArray>();
    nightStart.add(gConfig.night.startHour);
    nightStart.add(gConfig.night.startMinute);
    JsonArray nightEnd = night["x"].to<JsonArray>();
    nightEnd.add(gConfig.night.endHour);
    nightEnd.add(gConfig.night.endMinute);
    night["b"] = gConfig.night.maxBrightness;
    JsonArray nightPulse = night["p"].to<JsonArray>();
    nightPulse.add(gConfig.night.pulseOnAlert);
    nightPulse.add(gConfig.night.pulseOnClear);

    JsonObject buzzer = doc["z"].to<JsonObject>();
    buzzer["e"] = gConfig.buzzer.enabled;
    JsonArray buzzerVolume = buzzer["v"].to<JsonArray>();
    buzzerVolume.add(gConfig.buzzer.dayVolume);
    buzzerVolume.add(gConfig.buzzer.nightVolume);
    JsonArray buzzerRegions = buzzer["r"].to<JsonArray>();
    for (int i = 0; i < REGIONS_COUNT; i++)
    {
        if (gConfig.buzzer.regions[i])
            buzzerRegions.add(i);
    }

    JsonObject blink = doc["k"].to<JsonObject>();
    blink["e"] = gConfig.blink.enabled;
    JsonArray blinkIntensity = blink["i"].to<JsonArray>();
    blinkIntensity.add(gConfig.blink.dayIntensity);
    blinkIntensity.add(gConfig.blink.nightIntensity);
    JsonObject offline = doc["o"].to<JsonObject>();
    offline["a"] = gConfig.offline.autonomousSeconds;
    offline["p"] = gConfig.offline.pulseAmplitudePct;
    offline["d"] = gConfig.offline.pulseDurationMs;

    JsonArray leds = doc["l"].to<JsonArray>();
    for (int i = 0; i < MAX_LEDS; i++)
    {
        const int8_t regionIndex = gConfig.ledRegion[i];
        leds.add((regionIndex >= 0 && regionIndex < REGIONS_COUNT) ? regionIndex : -1);
    }

    JsonObject mqtt = doc["m"].to<JsonObject>();
    mqtt["h"] = gConfig.mqttHost;
    mqtt["p"] = gConfig.mqttPort;
    mqtt["t"] = gConfig.mqttTopic;
    mqtt["u"] = gConfig.mqttUser;
    mqtt["s"] = gConfig.mqttPass;

    JsonObject wifi = doc["w"].to<JsonObject>();
    wifi["s"] = gConfig.wifiSsid;
    wifi["p"] = gConfig.wifiPass;

    JsonArray ntp = doc["t"].to<JsonArray>();
    ntp.add(gConfig.ntpServer1);
    ntp.add(gConfig.ntpServer2);
    ntp.add(gConfig.ntpServer3);

    doc["g"] = gConfig.logMask;
}

bool storageLoadConfigFromJson(JsonVariantConst configJson, char *error, size_t errorSize)
{
    if (!validateFullConfigJson(configJson, error, errorSize))
        return false;

    storageApplyJson(configJson);

    if (error && errorSize)
        error[0] = '\0';
    return true;
}

bool storageSaveConfigFromJson(JsonVariantConst configJson, bool forceWrite, char *error, size_t errorSize)
{
    if (!storageLoadConfigFromJson(configJson, error, errorSize))
        return false;

    return storageSaveCurrentConfig(forceWrite);
}

bool storageSaveCurrentConfig(bool forceWrite)
{
    DynamicJsonDocument cfgDoc(CONFIG_JSON_CAPACITY);
    if (cfgDoc.capacity() == 0)
    {
        LOG_ERROR(LOG_CAT_CONFIG, "Config JSON alloc failed while saving");
        return false;
    }
    storagePopulateJson(cfgDoc);
    if (cfgDoc.overflowed())
    {
        LOG_ERROR(LOG_CAT_CONFIG, "Config JSON overflow while saving");
        return false;
    }

    const uint32_t crc = computeConfigCrc(cfgDoc.as<JsonVariantConst>());
    if (!forceWrite && crc == gLastSavedCrc)
        return true;

    if (!writeEnvelopeAtomically(cfgDoc.as<JsonVariantConst>(), crc))
        return false;

    gLastSavedCrc = crc;
    return true;
}

bool storageSyncWifiCredentials()
{
    const String currentSsid = WiFi.SSID();
    const String currentPass = WiFi.psk();

    const bool ssidChanged = strncmp(gConfig.wifiSsid, currentSsid.c_str(), WIFI_SSID_MAXLEN) != 0;
    const bool passChanged = strncmp(gConfig.wifiPass, currentPass.c_str(), WIFI_PASS_MAXLEN) != 0;
    if (!ssidChanged && !passChanged)
        return false;

    copyBounded(gConfig.wifiSsid, WIFI_SSID_MAXLEN, currentSsid.c_str());
    copyBounded(gConfig.wifiPass, WIFI_PASS_MAXLEN, currentPass.c_str());

    if (!storageSaveCurrentConfig())
    {
        LOG_ERROR(LOG_CAT_CONFIG, "Failed to persist synced WiFi credentials");
        return false;
    }

    LOG_INFO(LOG_CAT_CONFIG, "WiFi credentials synced to config");
    return true;
}

bool storageInit()
{
    applyDefaults();

    bool loadedConfig = false;
    bool needsRewrite = false;
    const char *loadedFrom = nullptr;

    auto tryLoadFromPath = [&](const char *path, bool allowPlainPayload) -> bool
    {
        DynamicJsonDocument root(CONFIG_JSON_CAPACITY + 2048);
        if (!loadEnvelopeFromPath(path, root))
            return false;

        const uint32_t magic = root["magic"] | 0U;
        const uint8_t version = root["v"] | 0U;
        const uint32_t storedCrc = root["crc"] | 0U;
        JsonVariantConst cfg = root["cfg"].as<JsonVariantConst>();

        // Current/older envelope format
        if (magic == CONFIG_MAGIC && !cfg.isNull())
        {
            const uint32_t actualCrc = computeConfigCrc(cfg);
            if (storedCrc != 0U && actualCrc != storedCrc)
            {
                LOG_ERROR(LOG_CAT_CONFIG, "Config CRC mismatch in %s", path);
                return false;
            }

            char error[24] = {0};
            if (!storageLoadConfigFromJson(cfg, error, sizeof(error)))
            {
                LOG_ERROR(LOG_CAT_CONFIG, "Config parse error in %s: %s", path, error);
                return false;
            }

            gLastSavedCrc = actualCrc;
            loadedConfig = true;
            loadedFrom = path;
            needsRewrite = (version != CONFIG_SCHEMA_VERSION) || (storedCrc == 0U);
            LOG_INFO(LOG_CAT_CONFIG, "Config loaded from %s (v%d%s)", path, version,
                     needsRewrite ? ", migration pending" : "");
            return true;
        }

        // Plain JSON payload (without envelope), allowed only for dedicated config files.
        if (allowPlainPayload && root.is<JsonObject>() && root.size() > 0)
        {
            char error[24] = {0};
            if (!storageLoadConfigFromJson(root.as<JsonVariantConst>(), error, sizeof(error)))
            {
                LOG_ERROR(LOG_CAT_CONFIG, "Legacy config parse error in %s: %s", path, error);
                return false;
            }

            DynamicJsonDocument cfgDoc(CONFIG_JSON_CAPACITY);
            storagePopulateJson(cfgDoc);
            gLastSavedCrc = computeConfigCrc(cfgDoc.as<JsonVariantConst>());
            loadedConfig = true;
            loadedFrom = path;
            needsRewrite = true;
            LOG_WARN(LOG_CAT_CONFIG, "Legacy config loaded from %s, migration pending", path);
            return true;
        }

        LOG_WARN(LOG_CAT_CONFIG, "Invalid config payload in %s", path);
        return false;
    };

    if (!tryLoadFromPath(CONFIG_PATH, true))
    {
        tryLoadFromPath(CONFIG_BAK_PATH, true);
    }

    if (loadedConfig)
    {
        if (needsRewrite)
        {
            if (!storageSaveCurrentConfig(true))
            {
                LOG_ERROR(LOG_CAT_CONFIG, "Failed to migrate config loaded from %s", loadedFrom ? loadedFrom : "unknown");
                return false;
            }
            LOG_INFO(LOG_CAT_CONFIG, "Config migrated to schema v%d", CONFIG_SCHEMA_VERSION);
        }
        return true;
    }

    LOG_WARN(LOG_CAT_CONFIG, "Config not found or invalid, creating defaults");

    if (!storageSaveCurrentConfig(true))
    {
        LOG_ERROR(LOG_CAT_CONFIG, "Failed to store default config");
        return false;
    }

    return true;
}
