#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>
#include "platform_compat.h"

#include "storage.h"
#include "logger.h"
#include "alerts.h"
#include "reset_trace.h"
#include "wifi_diagnostics.h"

void scheduleRestart(unsigned long delayMs);
void startupRequestWifiConnect();
extern char gHostname[];
extern unsigned long gLoopMaxDurationMs;
extern unsigned long gLoopSlowCount;
extern unsigned long gLoopIterationCount;

namespace uartcfg
{

constexpr size_t UART_LINE_MAX = 2048;
constexpr size_t UART_PAYLOAD_MAX = CONFIG_JSON_CAPACITY;
constexpr size_t UART_CHUNK_BYTES = 64;
constexpr uint32_t UART_LINE_TIMEOUT_MS = 8000;
constexpr uint32_t UART_SESSION_TIMEOUT_MS = 15000;
constexpr size_t UART_READ_BUDGET_PER_TICK = 1024;

struct RxState
{
    char line[UART_LINE_MAX + 1];
    size_t lineLen;
    uint32_t lineStartAt;
    uint32_t lastByteAt;
    bool discardingLine;

    bool receivingConfig;
    char payload[UART_PAYLOAD_MAX + 1];
    size_t payloadLen;
    uint32_t lastChunkAt;
};

static RxState gState{};

inline int hexNibble(char ch)
{
    if (ch >= '0' && ch <= '9')
        return ch - '0';
    if (ch >= 'A' && ch <= 'F')
        return ch - 'A' + 10;
    if (ch >= 'a' && ch <= 'f')
        return ch - 'a' + 10;
    return -1;
}

inline uint32_t crc32Step(uint32_t crc, uint8_t byte)
{
    crc ^= byte;
    for (uint8_t i = 0; i < 8; i++)
    {
        const uint32_t mask = -(int32_t)(crc & 1U);
        crc = (crc >> 1) ^ (0xEDB88320UL & mask);
    }
    return crc;
}

inline uint32_t calcCrc(const uint8_t *data, size_t len)
{
    uint32_t crc = 0xFFFFFFFFUL;
    for (size_t i = 0; i < len; i++)
        crc = crc32Step(crc, data[i]);
    return crc ^ 0xFFFFFFFFUL;
}

inline void sendJsonResponse(const char *status, const char *cmd, const char *reason = nullptr)
{
    StaticJsonDocument<192> doc;
    doc["status"] = status;
    if (cmd)
        doc["cmd"] = cmd;
    if (reason)
        doc["reason"] = reason;
    serializeJson(doc, CONSOLE_PORT);
    CONSOLE_PORT.println();
}

inline void sendAck(const char *cmd)
{
    sendJsonResponse("ACK", cmd, nullptr);
}

inline void sendNack(const char *cmd, const char *reason)
{
    sendJsonResponse("NACK", cmd, reason);
}

inline String provisioningApSsidForUart()
{
    return platformProvisioningApSsid(AP_NAME);
}

inline void sendDeviceInfo()
{
    StaticJsonDocument<512> doc;
    doc["event"] = "device_info";
    doc["fw"] = FIRMWARE_VERSION;
    IPAddress ip = WiFi.localIP();
    if (ip[0] == 0)
        ip = WiFi.softAPIP();
    doc["ip"] = ip.toString();
    doc["adminPassword"] = gConfig.adminPassword;
    doc["hostname"] = gHostname[0] ? gHostname : "unset";
    char deviceId[7] = {0};
    platformUniqueSuffix(deviceId, sizeof(deviceId));
    doc["deviceId"] = deviceId;
    char mqttClientId[32] = {0};
    mqttBuildClientId(mqttClientId, sizeof(mqttClientId));
    doc["mqttClientId"] = mqttClientId;
    doc["apSsid"] = provisioningApSsidForUart();
    doc["apPassword"] = AP_PASSWORD;
    doc["resetReason"] = resetTraceReason();
    doc["lastStage"] = resetTraceStage();
    doc["bootCount"] = resetTraceBootCount();

    char mdns[48];
    snprintf(mdns, sizeof(mdns), "http://%s.local", gHostname[0] ? gHostname : "unset");
    doc["mdns"] = mdns;

    serializeJson(doc, CONSOLE_PORT);
    CONSOLE_PORT.println();
}

inline void sendDiagnostics()
{
    DynamicJsonDocument doc(1536);
    doc["event"] = "diagnostics";
    doc["fw"] = FIRMWARE_VERSION;
    doc["hostname"] = gHostname[0] ? gHostname : "unset";
    doc["uptimeMs"] = millis();
    doc["heapFree"] = ESP.getFreeHeap();
    doc["heapMaxBlock"] = platformMaxFreeBlock();
    doc["heapFragPct"] = platformHeapFragmentationPct();
    doc["resetReason"] = resetTraceReason();
    doc["lastStage"] = resetTraceStage();
    doc["bootCount"] = resetTraceBootCount();
    doc["wifiConfigured"] = strlen(gConfig.wifiSsid) > 0;
    doc["wifiConnected"] = WiFi.status() == WL_CONNECTED;
    doc["wifiStatus"] = (int)WiFi.status();
    doc["wifiSsid"] = WiFi.SSID();
    doc["wifiRssi"] = WiFi.status() == WL_CONNECTED ? WiFi.RSSI() : 0;
    doc["ip"] = WiFi.status() == WL_CONNECTED ? WiFi.localIP().toString() : WiFi.softAPIP().toString();
    doc["apSsid"] = WiFi.softAPSSID();
    doc["mqttConfigured"] = strlen(gConfig.mqttHost) > 0;
    doc["mqttConnected"] = gMqttConnected;
    char mqttClientId[32] = {0};
    mqttBuildClientId(mqttClientId, sizeof(mqttClientId));
    doc["mqttClientId"] = mqttClientId;
    doc["internetConnected"] = gInternetConnected;
    doc["fetchOk"] = gFetchOk;
    doc["mqttMessagesReceived"] = gMqttMessagesReceived;
    doc["mqttReconnectAttempts"] = gMqttReconnectAttempts;
    doc["mqttDisconnectEvents"] = gMqttDisconnectEvents;
    doc["lastMqttMessageMsAgo"] = gLastMqttMessageAt ? (unsigned long)(millis() - gLastMqttMessageAt) : 0UL;
    doc["ledCount"] = gConfig.ledCount;
    doc["loopMaxMs"] = gLoopMaxDurationMs;
    doc["loopSlowCount"] = gLoopSlowCount;
    doc["loopIterations"] = gLoopIterationCount;
    wifiDiagnostics::append(doc.as<JsonObject>());
    doc["fallbackConfigured"] = gConfig.fallbackUrl[0] != 0;
    doc["alertsSource"] = alertsDataSource();
    doc["alertsFresh"] = alertsDataFresh();
    doc["fallbackHttpStatus"] = gFallbackHttpStatus;
    doc["fallbackRequests"] = gFallbackRequests;
    doc["fallbackErrors"] = gFallbackErrors;
    serializeJson(doc, CONSOLE_PORT);
    CONSOLE_PORT.println();
}

inline void sendFactoryTest()
{
    DynamicJsonDocument doc(768);
    doc["event"] = "factory_test";
    doc["fw"] = FIRMWARE_VERSION;
    doc["fs"] = LittleFS.exists("/amcfg.json") || LittleFS.exists("/amcfg.bak");
    doc["heapOk"] = ESP.getFreeHeap() > 30000UL;
    doc["heapFree"] = ESP.getFreeHeap();
    doc["ledCount"] = gConfig.ledCount;
    resetTraceSetStage("factory_wifi_scan");
    const int found = WiFi.scanNetworks(false, true);
    doc["wifiScanOk"] = found >= 0;
    doc["wifiNetworks"] = max(found, 0);
    doc["wifiScanResult"] = found;
    if (found >= 0) {
        bool targetFound = false;
        int32_t targetRssi = -128;
        for (int i = 0; i < found; ++i) {
            if (WiFi.SSID(i) == String(gConfig.wifiSsid) && (!targetFound || WiFi.RSSI(i) > targetRssi)) {
                targetFound = true;
                targetRssi = WiFi.RSSI(i);
                doc["configuredNetworkChannel"] = WiFi.channel(i);
                doc["configuredNetworkAuth"] = static_cast<int>(WiFi.encryptionType(i));
            }
        }
        doc["configuredNetworkFound"] = targetFound;
        if (targetFound) doc["configuredNetworkRssi"] = targetRssi;
    }
    WiFi.scanDelete();
    doc["ok"] = doc["fs"].as<bool>() && doc["heapOk"].as<bool>() && doc["wifiScanOk"].as<bool>() && gConfig.ledCount > 0;
    serializeJson(doc, CONSOLE_PORT);
    CONSOLE_PORT.println();
}

inline void copyBounded(char *dst, size_t size, const char *value)
{
    if (!dst || size == 0)
        return;
    strncpy(dst, value ? value : "", size - 1);
    dst[size - 1] = '\0';
}

inline void resetLineBuffer()
{
    gState.lineLen = 0;
    gState.line[0] = '\0';
    gState.lineStartAt = 0;
    gState.discardingLine = false;
}

inline void resetSession()
{
    gState.receivingConfig = false;
    gState.payloadLen = 0;
    gState.payload[0] = '\0';
    gState.lastChunkAt = 0;
}

inline bool decodeHexAppend(const char *hex, size_t hexLen)
{
    if ((hexLen & 1U) != 0)
        return false;

    const size_t bytesToAdd = hexLen / 2U;
    if (gState.payloadLen + bytesToAdd > UART_PAYLOAD_MAX)
        return false;

    for (size_t i = 0; i < hexLen; i += 2)
    {
        const int hi = hexNibble(hex[i]);
        const int lo = hexNibble(hex[i + 1]);
        if (hi < 0 || lo < 0)
            return false;
        gState.payload[gState.payloadLen++] = (char)((hi << 4) | lo);
    }

    gState.payload[gState.payloadLen] = '\0';
    gState.lastChunkAt = millis();
    return true;
}

// Serialize twice from the same document: first count/checksum, then send
// bounded HEX packets. This preserves the wire format without a full JSON copy.
class ConfigCrcWriter {
public:
    size_t write(uint8_t byte) { crc_ = crc32Step(crc_, byte); return 1; }
    size_t write(const uint8_t *data, size_t size) {
        for (size_t i = 0; i < size; ++i) write(data[i]);
        return size;
    }
    uint32_t checksum() const { return crc_ ^ 0xFFFFFFFFUL; }
private:
    uint32_t crc_ = 0xFFFFFFFFUL;
};

class ConfigChunkWriter {
public:
    size_t write(uint8_t byte) {
        static const char hex[] = "0123456789ABCDEF";
        chunk_[used_ * 2U] = hex[byte >> 4];
        chunk_[used_ * 2U + 1U] = hex[byte & 15U];
        if (++used_ == UART_CHUNK_BYTES) flush();
        return 1;
    }
    size_t write(const uint8_t *data, size_t size) {
        for (size_t i = 0; i < size; ++i) write(data[i]);
        return size;
    }
    void flush() {
        if (!used_) return;
        chunk_[used_ * 2U] = '\0';
        StaticJsonDocument<256> packet;
        packet["event"] = "config_data";
        packet["seq"] = seq_++;
        packet["data"] = chunk_;
        serializeJson(packet, CONSOLE_PORT);
        CONSOLE_PORT.println();
        used_ = 0;
        yield();
    }
private:
    char chunk_[UART_CHUNK_BYTES * 2U + 1U];
    size_t used_ = 0;
    size_t seq_ = 0;
};

inline void sendCurrentConfig()
{
    DynamicJsonDocument cfg(CONFIG_JSON_CAPACITY);
    if (cfg.capacity() == 0)
    {
        sendNack("get_config", "cfg_alloc_failed");
        return;
    }
    storagePopulateJson(cfg);
    if (cfg.overflowed())
    {
        sendNack("get_config", "cfg_overflow");
        return;
    }

    ConfigCrcWriter checksum;
    const size_t jsonLen = serializeJson(cfg, checksum);
    if (jsonLen == 0 || jsonLen > CONFIG_JSON_CAPACITY)
    {
        sendNack("get_config", "serialize_failed");
        return;
    }

    StaticJsonDocument<128> beginDoc;
    beginDoc["event"] = "config_begin";
    beginDoc["bytes"] = jsonLen;
    beginDoc["crc"] = checksum.checksum();
    serializeJson(beginDoc, CONSOLE_PORT);
    CONSOLE_PORT.println();

    ConfigChunkWriter chunks;
    serializeJson(cfg, chunks);
    chunks.flush();

    StaticJsonDocument<64> endDoc;
    endDoc["event"] = "config_end";
    serializeJson(endDoc, CONSOLE_PORT);
    CONSOLE_PORT.println();
}

inline void sendExportConfig()
{
    DynamicJsonDocument cfg(CONFIG_JSON_CAPACITY);
    if (cfg.capacity() == 0)
    {
        sendNack("export_config", "cfg_alloc_failed");
        return;
    }
    storagePopulateJson(cfg);
    if (cfg.overflowed())
    {
        sendNack("export_config", "cfg_overflow");
        return;
    }
    CONSOLE_PORT.print(F("{\"event\":\"export_config\",\"config\":"));
    serializeJson(cfg, CONSOLE_PORT);
    CONSOLE_PORT.println(F("}"));
}

inline void sendConfigJson()
{
    DynamicJsonDocument cfg(CONFIG_JSON_CAPACITY);
    if (cfg.capacity() == 0)
    {
        sendNack("config_get", "cfg_alloc_failed");
        return;
    }
    storagePopulateJson(cfg);
    if (cfg.overflowed())
    {
        sendNack("config_get", "cfg_overflow");
        return;
    }
    CONSOLE_PORT.print(F("{\"event\":\"config\",\"config\":"));
    serializeJson(cfg, CONSOLE_PORT);
    CONSOLE_PORT.println(F("}"));
}

inline bool parseKeyValue(const char *line, char *cmd, size_t cmdSize, const char **dataPtr)
{
    *dataPtr = nullptr;
    cmd[0] = '\0';

    const char *eq = strchr(line, '=');
    if (!eq)
        return false;

    const size_t keyLen = (size_t)(eq - line);
    const char *value = eq + 1;

    if (keyLen == 3 && strncmp(line, "cmd", 3) == 0)
    {
        strncpy(cmd, value, cmdSize - 1);
        cmd[cmdSize - 1] = '\0';
        return true;
    }

    if (keyLen == 4 && strncmp(line, "data", 4) == 0)
    {
        strncpy(cmd, "set_data", cmdSize - 1);
        cmd[cmdSize - 1] = '\0';
        *dataPtr = value;
        return true;
    }

    return false;
}

inline bool parseLooseJsonObject(const char *text, DynamicJsonDocument &doc)
{
    doc.clear();
    if (!text || !text[0])
        return false;

    if (deserializeJson(doc, text) == DeserializationError::Ok && doc.is<JsonObject>())
        return true;

    String normalized(text);
    normalized.trim();
    normalized.replace("'", "\"");

    doc.clear();
    return deserializeJson(doc, normalized) == DeserializationError::Ok && doc.is<JsonObject>();
}

inline void handleSimpleProtocol(const char *line)
{
    if (strcmp(line, "get:info") == 0)
    {
        sendDeviceInfo();
        return;
    }

    if (strcmp(line, "get:diagnostics") == 0)
    {
        sendDiagnostics();
        return;
    }

    if (strcmp(line, "factory:test") == 0)
    {
        sendFactoryTest();
        return;
    }

    if (strcmp(line, "get:config") == 0)
    {
        sendConfigJson();
        return;
    }

    if (strncmp(line, "set:config", 10) == 0)
    {
        const char *payload = line + 10;
        while (*payload == ' ')
            payload++;

        DynamicJsonDocument doc(CONFIG_JSON_CAPACITY + 512);
        if (!parseLooseJsonObject(payload, doc))
        {
            sendNack("set:config", "json_invalid");
            return;
        }

        char error[32] = {0};
        if (!storageSaveConfigFromJson(doc.as<JsonVariantConst>(), true, error, sizeof(error)))
        {
            sendNack("set:config", error[0] ? error : "save_failed");
            return;
        }

        loggerSetMask(gConfig.logMask);
        alertsReloadClientConfig();
        sendAck("set:config");
        sendConfigJson();
        return;
    }

    if (strncmp(line, "set:wifi", 8) == 0)
    {
        const char *payload = line + 8;
        while (*payload == ' ')
            payload++;

        DynamicJsonDocument doc(512);
        if (!parseLooseJsonObject(payload, doc))
        {
            sendNack("set:wifi", "json_invalid");
            return;
        }

        const char *ssid = doc["ssid"] | "";
        const char *pass = doc["password"].isNull()
            ? (doc["pass"] | "")
            : (doc["password"] | "");

        if (!ssid[0])
        {
            sendNack("set:wifi", "missing_ssid");
            return;
        }

        if (strlen(ssid) > 32 || strlen(pass) >= WIFI_PASS_MAXLEN)
        {
            sendNack("set:wifi", "wifi_value_too_long");
            return;
        }

        char previousSsid[WIFI_SSID_MAXLEN];
        char previousPass[WIFI_PASS_MAXLEN];
        copyBounded(previousSsid, sizeof(previousSsid), gConfig.wifiSsid);
        copyBounded(previousPass, sizeof(previousPass), gConfig.wifiPass);
        copyBounded(gConfig.wifiSsid, WIFI_SSID_MAXLEN, ssid);
        copyBounded(gConfig.wifiPass, WIFI_PASS_MAXLEN, pass);

        if (!storageSaveCurrentConfig(true))
        {
            copyBounded(gConfig.wifiSsid, WIFI_SSID_MAXLEN, previousSsid);
            copyBounded(gConfig.wifiPass, WIFI_PASS_MAXLEN, previousPass);
            sendNack("set:wifi", "save_failed");
            return;
        }

        startupRequestWifiConnect();
        sendAck("set:wifi");
        sendDeviceInfo();
        return;
    }

    sendNack("line", "unsupported_format");
}

inline void applyIncomingConfig()
{
    if (gState.payloadLen == 0)
    {
        sendNack("set_end", "empty_payload");
        return;
    }

    DynamicJsonDocument doc(CONFIG_JSON_CAPACITY);
    const auto err = deserializeJson(doc, gState.payload, gState.payloadLen);
    if (err)
    {
        sendNack("set_end", "json_invalid");
        return;
    }

    char error[32] = {0};
    if (!storageSaveConfigFromJson(doc.as<JsonVariantConst>(), true, error, sizeof(error)))
    {
        sendNack("set_end", error[0] ? error : "save_failed");
        return;
    }

    loggerSetMask(gConfig.logMask);
    sendAck("set_end");
    LOG_INFO(LOG_CAT_CONFIG, "UART config updated");
    scheduleRestart(700);
}

inline void handleCommand(const char *cmd, const char *data, JsonVariantConst root = JsonVariantConst())
{
    if (strcmp(cmd, "hello") == 0 || strcmp(cmd, "ping") == 0)
    {
        sendAck(cmd);
        sendDeviceInfo();
        return;
    }

    if (strcmp(cmd, "device_info") == 0)
    {
        sendAck(cmd);
        sendDeviceInfo();
        return;
    }

    if (strcmp(cmd, "diagnostics") == 0)
    {
        sendAck(cmd);
        sendDiagnostics();
        return;
    }

    if (strcmp(cmd, "factory_test") == 0)
    {
        sendAck(cmd);
        sendFactoryTest();
        return;
    }

    if (strcmp(cmd, "wifi_set") == 0)
    {
        const char *ssid = nullptr;
        const char *pass = nullptr;
        if (!root.isNull())
        {
            ssid = root["ssid"] | "";
            pass = root["pass"] | "";
        }

        if (!ssid || !ssid[0])
        {
            sendNack(cmd, "missing_ssid");
            return;
        }

        if (strlen(ssid) > 32 || strlen(pass ? pass : "") >= WIFI_PASS_MAXLEN)
        {
            sendNack(cmd, "wifi_value_too_long");
            return;
        }

        char previousSsid[WIFI_SSID_MAXLEN];
        char previousPass[WIFI_PASS_MAXLEN];
        copyBounded(previousSsid, sizeof(previousSsid), gConfig.wifiSsid);
        copyBounded(previousPass, sizeof(previousPass), gConfig.wifiPass);
        copyBounded(gConfig.wifiSsid, WIFI_SSID_MAXLEN, ssid);
        copyBounded(gConfig.wifiPass, WIFI_PASS_MAXLEN, pass ? pass : "");

        if (!storageSaveCurrentConfig(true))
        {
            copyBounded(gConfig.wifiSsid, WIFI_SSID_MAXLEN, previousSsid);
            copyBounded(gConfig.wifiPass, WIFI_PASS_MAXLEN, previousPass);
            sendNack(cmd, "save_failed");
            return;
        }

        startupRequestWifiConnect();
        sendAck(cmd);
        sendDeviceInfo();
        return;
    }

    if (strcmp(cmd, "fallback_set") == 0)
    {
        if (root.isNull() || !root["url"].is<const char *>() ||
            !fallbackContract::validUrl(root["url"].as<const char *>())) {
            sendNack(cmd, "invalid_fallback_url");
            return;
        }
        char previous[sizeof(gConfig.fallbackUrl)];
        memcpy(previous, gConfig.fallbackUrl, sizeof(previous));
        copyBounded(gConfig.fallbackUrl, sizeof(gConfig.fallbackUrl), root["url"].as<const char *>());
        if (!storageSaveCurrentConfig(true)) {
            memcpy(gConfig.fallbackUrl, previous, sizeof(previous));
            sendNack(cmd, "save_failed");
            return;
        }
        sendAck(cmd);
        sendConfigJson();
        return;
    }

    if (strcmp(cmd, "wifi_connect") == 0)
    {
        if (!gConfig.wifiSsid[0])
        {
            sendNack(cmd, "ssid_not_configured");
            return;
        }
        startupRequestWifiConnect();
        sendAck(cmd);
        sendDeviceInfo();
        return;
    }

#if defined(ESP32)
    // Diagnostic override is temporary: it does not write configuration.
    if (strcmp(cmd, "wifi_tx_power") == 0)
    {
        if (root.isNull() || !root["quarterDbm"].is<int>()) {
            sendNack(cmd, "missing_power");
            return;
        }
        const int power = root["quarterDbm"].as<int>();
        if (power < 8 || power > 80) {
            sendNack(cmd, "power_out_of_range");
            return;
        }
        if (!WiFi.setTxPower(static_cast<wifi_power_t>(power))) {
            sendNack(cmd, "radio_not_ready");
            return;
        }
        sendAck(cmd);
        sendDiagnostics();
        return;
    }
#endif

    if (strcmp(cmd, "mqtt_set") == 0)
    {
        if (root.isNull())
        {
            sendNack(cmd, "missing_payload");
            return;
        }

        const char *host = root["host"] | "";
        const char *topic = root["topic"] | "";
        const char *user = root["user"] | "";
        const char *pass = root["pass"] | "";
        const unsigned long port = root.containsKey("port") ? root["port"].as<unsigned long>() : 1883UL;

        if (strlen(host) >= MQTT_HOST_MAXLEN || strlen(topic) >= MQTT_TOPIC_MAXLEN ||
            strlen(user) >= MQTT_USER_MAXLEN || strlen(pass) >= MQTT_PASS_MAXLEN)
        {
            sendNack(cmd, "mqtt_value_too_long");
            return;
        }

        if (port == 0 || port > 65535UL || (root.containsKey("port") && !root["port"].is<unsigned long>()))
        {
            sendNack(cmd, "bad_port");
            return;
        }

        const AppConfig previousConfig = gConfig;
        copyBounded(gConfig.mqttHost, MQTT_HOST_MAXLEN, host);
        copyBounded(gConfig.mqttTopic, MQTT_TOPIC_MAXLEN, topic);
        copyBounded(gConfig.mqttUser, MQTT_USER_MAXLEN, user);
        copyBounded(gConfig.mqttPass, MQTT_PASS_MAXLEN, pass);
        gConfig.mqttPort = port;

        if (!storageSaveCurrentConfig(true))
        {
            gConfig = previousConfig;
            sendNack(cmd, "save_failed");
            return;
        }

        alertsReloadClientConfig();
        sendAck(cmd);
        return;
    }

    if (strcmp(cmd, "import_config") == 0)
    {
        if (root.isNull() || root["config"].isNull())
        {
            sendNack(cmd, "missing_config");
            return;
        }

        char error[32] = {0};
        if (!storageSaveConfigFromJson(root["config"].as<JsonVariantConst>(), true, error, sizeof(error)))
        {
            sendNack(cmd, error[0] ? error : "import_failed");
            return;
        }

        loggerSetMask(gConfig.logMask);
        alertsReloadClientConfig();
        sendAck(cmd);
        sendDeviceInfo();
        return;
    }

    if (strcmp(cmd, "config_get") == 0)
    {
        sendAck(cmd);
        sendConfigJson();
        return;
    }

    if (strcmp(cmd, "config_set") == 0)
    {
        if (root.isNull())
        {
            sendNack(cmd, "missing_payload");
            return;
        }

        JsonVariantConst payload = root["config"].isNull()
            ? root
            : root["config"].as<JsonVariantConst>();

        char error[32] = {0};
        if (!storageSaveConfigFromJson(payload, true, error, sizeof(error)))
        {
            sendNack(cmd, error[0] ? error : "save_failed");
            return;
        }

        loggerSetMask(gConfig.logMask);
        alertsReloadClientConfig();
        sendAck(cmd);
        sendConfigJson();
        sendDeviceInfo();
        return;
    }

    if (strcmp(cmd, "get_config") == 0)
    {
        sendAck(cmd);
        // Keep backward compatibility, but also emit plain JSON config.
        sendCurrentConfig();
        sendConfigJson();
        return;
    }

    if (strcmp(cmd, "export_config") == 0)
    {
        sendAck(cmd);
        sendExportConfig();
        return;
    }

    if (strcmp(cmd, "set_begin") == 0)
    {
        resetSession();
        gState.receivingConfig = true;
        gState.lastChunkAt = millis();
        sendAck(cmd);
        return;
    }

    if (strcmp(cmd, "set_data") == 0)
    {
        if (!gState.receivingConfig)
        {
            sendNack(cmd, "not_receiving");
            return;
        }
        if (!data || !data[0])
        {
            sendNack(cmd, "missing_data");
            return;
        }

        if (!decodeHexAppend(data, strlen(data)))
        {
            resetSession();
            sendNack(cmd, "hex_invalid_or_overflow");
            return;
        }

        sendAck(cmd);
        return;
    }

    if (strcmp(cmd, "set_end") == 0)
    {
        if (!gState.receivingConfig)
        {
            sendNack(cmd, "not_receiving");
            return;
        }

        gState.receivingConfig = false;
        applyIncomingConfig();
        resetSession();
        return;
    }

    if (strcmp(cmd, "cancel") == 0)
    {
        resetSession();
        sendAck(cmd);
        return;
    }

    sendNack(cmd, "unknown_cmd");
}

inline void processLine(const char *line)
{
    if (!line || !line[0])
        return;

    if (strncmp(line, "get:", 4) == 0 ||
        strncmp(line, "set:", 4) == 0 ||
        strncmp(line, "factory:", 8) == 0)
    {
        handleSimpleProtocol(line);
        return;
    }

    if (strncmp(line, "AMCFG ", 6) == 0)
    {
        if (strcmp(line, "AMCFG GET") == 0)
            return handleCommand("get_config", nullptr);
        if (strcmp(line, "AMCFG SET BEGIN") == 0)
            return handleCommand("set_begin", nullptr);
        if (strcmp(line, "AMCFG SET END") == 0)
            return handleCommand("set_end", nullptr);
        if (strncmp(line, "AMCFG SET DATA ", 15) == 0)
            return handleCommand("set_data", line + 15);
        sendNack("AMCFG", "unknown_legacy_cmd");
        return;
    }

    if (line[0] == '{')
    {
        DynamicJsonDocument cmdDoc(CONFIG_JSON_CAPACITY + 512);
        const auto err = deserializeJson(cmdDoc, line);
        if (err)
        {
            sendNack("json", "parse_error");
            return;
        }

        const char *cmd = cmdDoc["cmd"] | "";
        const char *data = cmdDoc["data"] | nullptr;
        if (!cmd[0])
        {
            sendNack("json", "missing_cmd");
            return;
        }

        handleCommand(cmd, data, cmdDoc.as<JsonVariantConst>());
        return;
    }

    char cmd[24];
    const char *data = nullptr;
    if (parseKeyValue(line, cmd, sizeof(cmd), &data))
    {
        handleCommand(cmd, data);
        return;
    }

    sendNack("line", "unsupported_format");
}

inline void init()
{
    memset(&gState, 0, sizeof(gState));
}

inline void handle()
{
    const uint32_t now = millis();

    if ((gState.lineLen > 0 || gState.discardingLine) && now - gState.lastByteAt > UART_LINE_TIMEOUT_MS)
    {
        resetLineBuffer();
        sendNack("line", "line_timeout");
    }

    if (gState.receivingConfig && now - gState.lastChunkAt > UART_SESSION_TIMEOUT_MS)
    {
        resetSession();
        sendNack("set", "session_timeout");
    }

    size_t consumedBytes = 0;
    while (consumedBytes < UART_READ_BUDGET_PER_TICK && millis() - now < 4UL && CONSOLE_PORT.available() > 0)
    {
        const char ch = (char)CONSOLE_PORT.read();
        consumedBytes++;
        const uint32_t ts = millis();
        if (gState.lineLen == 0)
            gState.lineStartAt = ts;
        gState.lastByteAt = ts;

        if (ch == '\r')
            continue;

        if (ch == '\n')
        {
            if (!gState.discardingLine) {
                gState.line[gState.lineLen] = '\0';
                processLine(gState.line);
            }
            resetLineBuffer();
            break; // At most one potentially expensive command per loop tick.
        }

        if (gState.discardingLine) continue;

        if (gState.lineLen >= UART_LINE_MAX || ch == '\0')
        {
            resetLineBuffer();
            gState.discardingLine = true;
            sendNack("line", "line_overflow");
            continue;
        }

        gState.line[gState.lineLen++] = ch;

    }
}

} // namespace uartcfg


