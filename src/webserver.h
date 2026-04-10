#pragma once
#include <ESP8266WebServer.h>
#include <ESP8266WiFi.h>
#include <LittleFS.h>
#include <ArduinoJson.h>
#include "config.h"
#include "storage.h"
#include "buzzer.h"
#include "alerts.h"
#include "leds.h"
#include "logger.h"

extern char gHostname[];

ESP8266WebServer gServer(80);
char gSessionToken[33] = {0};
bool gRestartScheduled = false;
unsigned long gRestartAtMs = 0;

void scheduleRestart(unsigned long delayMs = 300)
{
    gRestartScheduled = true;
    gRestartAtMs = millis() + delayMs;
}

void addCors()
{
    gServer.sendHeader("Access-Control-Allow-Origin", "*");
    gServer.sendHeader("Cache-Control", "no-store");
}

String mimeTypeFor(const String &path)
{
    if (path.endsWith(".html"))
        return "text/html; charset=utf-8";
    if (path.endsWith(".css"))
        return "text/css; charset=utf-8";
    if (path.endsWith(".js"))
        return "application/javascript; charset=utf-8";
    if (path.endsWith(".json"))
        return "application/json; charset=utf-8";
    if (path.endsWith(".svg"))
        return "image/svg+xml";
    if (path.endsWith(".png"))
        return "image/png";
    if (path.endsWith(".ico"))
        return "image/x-icon";
    return "text/plain; charset=utf-8";
}

String getCookieValue(const String &name)
{
    if (!gServer.hasHeader("Cookie"))
        return "";

    const String cookieHeader = gServer.header("Cookie");
    const String token = name + "=";
    int start = cookieHeader.indexOf(token);
    if (start < 0)
        return "";

    start += token.length();
    int end = cookieHeader.indexOf(';', start);
    if (end < 0)
        end = cookieHeader.length();
    return cookieHeader.substring(start, end);
}

bool isAuthorized()
{
    if (!gSessionToken[0])
        return false;
    return getCookieValue("ESPSESSION") == gSessionToken;
}

bool ensureAuthorized()
{
    if (isAuthorized())
        return true;

    addCors();
    gServer.send(401, "application/json", "{\"authenticated\":false}");
    return false;
}

void sendJson(JsonDocument &doc, int status = 200)
{
    addCors();
    gServer.setContentLength(measureJson(doc));
    gServer.send(status, "application/json", "");
    serializeJson(doc, gServer.client());
}

void mergeMissingRecursive(JsonVariant dst, JsonVariantConst src)
{
    if (dst.is<JsonObject>() && src.is<JsonObjectConst>())
    {
        JsonObject dstObj = dst.as<JsonObject>();
        JsonObjectConst srcObj = src.as<JsonObjectConst>();
        for (JsonPairConst kv : srcObj)
        {
            const char *key = kv.key().c_str();
            if (!dstObj.containsKey(key))
            {
                dstObj[key] = kv.value();
                continue;
            }

            JsonVariant childDst = dstObj[key];
            JsonVariantConst childSrc = kv.value();
            if ((childDst.is<JsonObject>() && childSrc.is<JsonObjectConst>()) ||
                (childDst.is<JsonArray>() && childSrc.is<JsonArrayConst>()))
            {
                mergeMissingRecursive(childDst, childSrc);
            }
        }
        return;
    }

    if (dst.is<JsonArray>() && src.is<JsonArrayConst>())
    {
        JsonArray dstArr = dst.as<JsonArray>();
        JsonArrayConst srcArr = src.as<JsonArrayConst>();
        if (dstArr.size() == 0)
        {
            for (JsonVariantConst item : srcArr)
                dstArr.add(item);
        }
    }
}

void mergeOverrideRecursive(JsonVariant dst, JsonVariantConst src)
{
    if (dst.is<JsonObject>() && src.is<JsonObjectConst>())
    {
        JsonObject dstObj = dst.as<JsonObject>();
        JsonObjectConst srcObj = src.as<JsonObjectConst>();
        for (JsonPairConst kv : srcObj)
        {
            const char *key = kv.key().c_str();
            JsonVariant dstChild = dstObj[key];
            JsonVariantConst srcChild = kv.value();

            if ((dstChild.is<JsonObject>() && srcChild.is<JsonObjectConst>()) ||
                (dstChild.is<JsonArray>() && srcChild.is<JsonArrayConst>()))
            {
                mergeOverrideRecursive(dstChild, srcChild);
            }
            else
            {
                dstObj[key] = srcChild;
            }
        }
        return;
    }

    if (dst.is<JsonArray>() && src.is<JsonArrayConst>())
    {
        JsonArray dstArr = dst.as<JsonArray>();
        JsonArrayConst srcArr = src.as<JsonArrayConst>();
        dstArr.clear();
        for (JsonVariantConst item : srcArr)
            dstArr.add(item);
    }
}

bool hasNonEmptyText(JsonVariantConst value)
{
    if (value.isNull())
        return false;
    const char *text = value.as<const char *>();
    return text && text[0] != '\0';
}

void preserveTextIfIncomingEmpty(JsonObject dstObj, JsonObjectConst srcObj, const char *key)
{
    if (!key || !dstObj.containsKey(key) || !srcObj.containsKey(key))
        return;

    JsonVariantConst incoming = dstObj[key];
    JsonVariantConst previous = srcObj[key];
    if (!hasNonEmptyText(incoming) && hasNonEmptyText(previous))
        dstObj[key] = previous;
}

void fillBoundedCopy(char *dst, size_t size, const char *src)
{
    if (!dst || size == 0)
        return;
    strncpy(dst, src ? src : "", size - 1);
    dst[size - 1] = '\0';
}

struct SaveChangeFlags
{
    bool wifiChanged;
    bool mqttChanged;
};

bool persistConfigFromRequestJson(const String &body,
                                  bool /*unusedStrictFullMode*/,
                                  SaveChangeFlags *outFlags,
                                  char *error,
                                  size_t errorSize)
{
    if (outFlags)
    {
        outFlags->wifiChanged = false;
        outFlags->mqttChanged = false;
    }

    constexpr size_t SAVE_DOC_CAPACITY = CONFIG_JSON_CAPACITY + 512;

    DynamicJsonDocument requestDoc(SAVE_DOC_CAPACITY);
    const DeserializationError parseErr = deserializeJson(requestDoc, body);
    if (parseErr || !requestDoc.is<JsonObject>())
    {
        if (error && errorSize)
            snprintf(error, errorSize, "json_invalid");
        return false;
    }

    char prevWifiSsid[WIFI_SSID_MAXLEN];
    char prevWifiPass[WIFI_PASS_MAXLEN];
    char prevMqttHost[MQTT_HOST_MAXLEN];
    char prevMqttTopic[MQTT_TOPIC_MAXLEN];
    char prevMqttUser[MQTT_USER_MAXLEN];
    char prevMqttPass[MQTT_PASS_MAXLEN];
    const uint16_t prevMqttPort = gConfig.mqttPort;
    fillBoundedCopy(prevWifiSsid, sizeof(prevWifiSsid), gConfig.wifiSsid);
    fillBoundedCopy(prevWifiPass, sizeof(prevWifiPass), gConfig.wifiPass);
    fillBoundedCopy(prevMqttHost, sizeof(prevMqttHost), gConfig.mqttHost);
    fillBoundedCopy(prevMqttTopic, sizeof(prevMqttTopic), gConfig.mqttTopic);
    fillBoundedCopy(prevMqttUser, sizeof(prevMqttUser), gConfig.mqttUser);
    fillBoundedCopy(prevMqttPass, sizeof(prevMqttPass), gConfig.mqttPass);

    char storageError[32] = {0};
    if (!storageSaveConfigFromJson(requestDoc.as<JsonVariantConst>(), false, storageError, sizeof(storageError)))
    {
        if (error && errorSize)
            snprintf(error, errorSize, "%s", storageError[0] ? storageError : "save_failed");
        return false;
    }

    loggerSetMask(gConfig.logMask);

    if (outFlags)
    {
        outFlags->wifiChanged =
            strncmp(prevWifiSsid, gConfig.wifiSsid, sizeof(prevWifiSsid)) != 0 ||
            strncmp(prevWifiPass, gConfig.wifiPass, sizeof(prevWifiPass)) != 0;

        outFlags->mqttChanged =
            strncmp(prevMqttHost, gConfig.mqttHost, sizeof(prevMqttHost)) != 0 ||
            prevMqttPort != gConfig.mqttPort ||
            strncmp(prevMqttTopic, gConfig.mqttTopic, sizeof(prevMqttTopic)) != 0 ||
            strncmp(prevMqttUser, gConfig.mqttUser, sizeof(prevMqttUser)) != 0 ||
            strncmp(prevMqttPass, gConfig.mqttPass, sizeof(prevMqttPass)) != 0;
    }

    if (error && errorSize)
        error[0] = '\0';
    return true;
}

void handleSession()
{
    DynamicJsonDocument doc(128);
    doc["authenticated"] = isAuthorized();
    sendJson(doc);
}

void handleLogin()
{
    if (!gServer.hasArg("plain"))
    {
        addCors();
        gServer.send(400, "application/json", "{\"ok\":false}");
        return;
    }

    DynamicJsonDocument doc(256);
    if (deserializeJson(doc, gServer.arg("plain")) != DeserializationError::Ok)
    {
        addCors();
        gServer.send(400, "application/json", "{\"ok\":false}");
        return;
    }

    const char *password = doc["password"] | "";
    if (strcmp(password, gConfig.adminPassword) != 0)
    {
        LOG_WARN(LOG_CAT_WEB, "Login failed");
        addCors();
        gServer.send(401, "application/json", "{\"ok\":false}");
        return;
    }

    snprintf(gSessionToken, sizeof(gSessionToken), "%08X%08lX", ESP.getChipId(), micros());
    LOG_INFO(LOG_CAT_WEB, "Login successful");
    addCors();
    String cookie = "ESPSESSION=";
    cookie += gSessionToken;
    cookie += "; Path=/; HttpOnly; SameSite=Lax";
    gServer.sendHeader("Set-Cookie", cookie);
    gServer.send(200, "application/json", "{\"ok\":true}");
}

void handleLogout()
{
    gSessionToken[0] = '\0';
    LOG_INFO(LOG_CAT_WEB, "Session closed");
    addCors();
    gServer.sendHeader("Set-Cookie", "ESPSESSION=deleted; Path=/; Max-Age=0; HttpOnly; SameSite=Lax");
    gServer.send(200, "application/json", "{\"ok\":true}");
}

void handleGetInfo()
{
    if (!ensureAuthorized())
        return;

    DynamicJsonDocument doc(4096);
    doc["maxLeds"] = MAX_LEDS;
    doc["mqttHost"] = gConfig.mqttHost;
    doc["mqttPort"] = gConfig.mqttPort ? gConfig.mqttPort : 1883;
    doc["mqttTopic"] = strlen(gConfig.mqttTopic) ? gConfig.mqttTopic : "alerts/status";
    doc["mqttUser"] = gConfig.mqttUser;
    doc["mqttPass"] = gConfig.mqttPass;
    doc["adminPassword"] = gConfig.adminPassword;
    doc["hostname"] = gHostname;
    doc["ip"] = WiFi.localIP().toString();
    doc["firmwareVersion"] = FIRMWARE_VERSION;
    doc["apSsid"] = AP_NAME;
    doc["apPassword"] = AP_PASSWORD;
    doc["ledPin"] = LED_PIN;
    doc["buzzerPin"] = BUZZER_PIN;
    JsonObject logCategoryBits = doc.createNestedObject("logCategoryBits");
    logCategoryBits["system"] = LOG_CAT_SYSTEM;
    logCategoryBits["wifi"] = LOG_CAT_WIFI;
    logCategoryBits["internet"] = LOG_CAT_INTERNET;
    logCategoryBits["mqtt"] = LOG_CAT_MQTT;
    logCategoryBits["web"] = LOG_CAT_WEB;
    logCategoryBits["config"] = LOG_CAT_CONFIG;
    logCategoryBits["calibration"] = LOG_CAT_CALIBRATION;
    logCategoryBits["test"] = LOG_CAT_TEST;

    JsonArray regions = doc.createNestedArray("regions");
    for (int i = 0; i < REGIONS_COUNT; i++)
        regions.add(REGIONS[i]);

    sendJson(doc);
}

void handleGetAlerts()
{
    if (!ensureAuthorized())
        return;

    DynamicJsonDocument doc(1024);
    JsonArray arr = doc.to<JsonArray>();
    for (int i = 0; i < REGIONS_COUNT; i++)
        arr.add(gAlerts[i]);
    sendJson(doc);
}

void handleGetConfig()
{
    if (!ensureAuthorized())
        return;

    DynamicJsonDocument doc(CONFIG_JSON_CAPACITY);
    storagePopulateJson(doc);
    sendJson(doc);
}

void handleSaveSettings()
{
    if (!ensureAuthorized())
        return;

    if (!gServer.hasArg("plain"))
    {
        addCors();
        gServer.send(400, "application/json", "{\"ok\":false}");
        return;
    }

    SaveChangeFlags flags{};
    char saveError[32] = {0};
    if (!persistConfigFromRequestJson(gServer.arg("plain"), true, &flags, saveError, sizeof(saveError)))
    {
        LOG_ERROR(LOG_CAT_CONFIG, "Save settings failed: %s", saveError);
        addCors();
        gServer.send(422, "application/json", "{\"ok\":false,\"reason\":\"invalid_full_config\"}");
        return;
    }

    if (flags.wifiChanged)
    {
        LOG_INFO(LOG_CAT_CONFIG, "WiFi settings changed, apply deferred until restart/manual connect");
        if (flags.mqttChanged)
            alertsReloadClientConfig();
    }
    else if (flags.mqttChanged)
    {
        LOG_INFO(LOG_CAT_CONFIG, "Settings saved, MQTT settings updated");
        alertsReloadClientConfig();
    }
    else
    {
        LOG_INFO(LOG_CAT_CONFIG, "Settings saved without restart");
    }

    addCors();
    gServer.send(200, "text/plain", "OK");
}

void handleTestBuzzer()
{
    if (!ensureAuthorized())
        return;

    buzzerTest(gServer.arg("alert") == "1");
    LOG_INFO(LOG_CAT_TEST, "Buzzer test requested");
    addCors();
    gServer.send(200, "text/plain", "OK");
}

void handleTestRegionAlert()
{
    if (!ensureAuthorized())
        return;

    addCors();
    if (!alertsStartSubscribedRegionTest())
    {
        gServer.send(400, "text/plain", "No subscribed regions");
        return;
    }

    gServer.send(200, "text/plain", "OK");
}

void handleCalibrateLed()
{
    if (!ensureAuthorized())
        return;

    int idx = gServer.arg("index").toInt();
    if (idx < 0 || idx >= MAX_LEDS)
    {
        addCors();
        gServer.send(400, "text/plain", "Bad index");
        return;
    }
    gCalibrationActive = true;
    gCalibrationIndex = idx;
    LOG_INFO(LOG_CAT_CALIBRATION, "Calibration LED index=%d", idx);
    addCors();
    gServer.send(200, "text/plain", "OK");
}

void handleCalibrateDone()
{
    if (!ensureAuthorized())
        return;

    gCalibrationActive = false;
    gCalibrationIndex = -1;
    strip.clear();
    strip.show();
    LOG_INFO(LOG_CAT_CALIBRATION, "Calibration mode finished");
    addCors();
    gServer.send(200, "text/plain", "OK");
}

void handleRestart()
{
    if (!ensureAuthorized())
        return;

    LOG_INFO(LOG_CAT_SYSTEM, "Restart requested from web");
    addCors();
    gServer.send(200, "text/plain", "OK");
    scheduleRestart();
}

void handleGetLogs()
{
    if (!ensureAuthorized())
        return;

    DynamicJsonDocument doc(8192);
    doc["mask"] = loggerGetMask();

    JsonArray categories = doc.createNestedArray("categories");
    const uint16_t categoryBits[] = {
        LOG_CAT_SYSTEM, LOG_CAT_WIFI, LOG_CAT_INTERNET, LOG_CAT_MQTT,
        LOG_CAT_WEB, LOG_CAT_CONFIG, LOG_CAT_CALIBRATION, LOG_CAT_TEST};
    for (uint8_t i = 0; i < sizeof(categoryBits) / sizeof(categoryBits[0]); i++)
    {
        JsonObject item = categories.createNestedObject();
        item["bit"] = categoryBits[i];
        item["key"] = loggerCategoryKey(categoryBits[i]);
        item["label"] = loggerCategoryLabel(categoryBits[i]);
        item["enabled"] = loggerIsEnabled(categoryBits[i]);
    }

    JsonArray entries = doc.createNestedArray("entries");
    loggerExportJson(entries, 24);
    sendJson(doc);
}

void handleClearLogs()
{
    if (!ensureAuthorized())
        return;

    loggerClear();
    addCors();
    gServer.send(200, "application/json", "{\"ok\":true}");
}

void handleDisableLogs()
{
    if (!ensureAuthorized())
        return;

    loggerClear();
    gConfig.logMask = 0;
    loggerSetMask(0);
    storageSaveCurrentConfig();

    addCors();
    gServer.send(200, "application/json", "{\"ok\":true,\"disabled\":true}");
}

void handleConfigApiGet()
{
    DynamicJsonDocument doc(CONFIG_JSON_CAPACITY);
    storagePopulateJson(doc);
    sendJson(doc);
}

void handleConfigApiPost()
{
    if (!gServer.hasArg("plain"))
    {
        addCors();
        gServer.send(400, "application/json", "{\"ok\":false,\"reason\":\"missing_body\"}");
        return;
    }

    SaveChangeFlags flags{};
    char saveError[32] = {0};
    if (!persistConfigFromRequestJson(gServer.arg("plain"), false, &flags, saveError, sizeof(saveError)))
    {
        addCors();
        gServer.send(422, "application/json", "{\"ok\":false,\"reason\":\"validation_or_storage\"}");
        return;
    }

    if (flags.mqttChanged)
        alertsReloadClientConfig();

    addCors();
    gServer.send(200, "application/json", "{\"ok\":true}");
}

void handleHealth()
{
    StaticJsonDocument<384> doc;
    doc["uptimeMs"] = millis();
    doc["heapFree"] = ESP.getFreeHeap();
    doc["heapMaxBlock"] = ESP.getMaxFreeBlockSize();
    doc["heapFragPct"] = ESP.getHeapFragmentation();
    doc["resetReason"] = ESP.getResetReason();
    doc["wifiStatus"] = WiFi.status();
    doc["wifiConnected"] = (WiFi.status() == WL_CONNECTED);
    doc["mqttConnected"] = gMqttConnected;
    doc["internetConnected"] = gInternetConnected;
    sendJson(doc);
}

void webserverInit()
{
    gServer.collectHeaders("Cookie");

    gServer.on("/", HTTP_GET, []()
               {
                   gServer.sendHeader("Location", "/index.html");
                   gServer.send(302, "text/plain", "");
               });

    gServer.on("/favicon.ico", HTTP_GET, []()
               { gServer.send(204, "image/x-icon", ""); });

    gServer.on("/api/session", HTTP_GET, handleSession);
    gServer.on("/api/login", HTTP_POST, handleLogin);
    gServer.on("/api/logout", HTTP_POST, handleLogout);
    gServer.on("/api/info", HTTP_GET, handleGetInfo);
    gServer.on("/api/config", HTTP_GET, handleGetConfig);
    gServer.on("/api/alerts", HTTP_GET, handleGetAlerts);
    gServer.on("/api/saveSettings", HTTP_POST, handleSaveSettings);
    gServer.on("/api/logs", HTTP_GET, handleGetLogs);
    gServer.on("/api/logs/clear", HTTP_POST, handleClearLogs);
    gServer.on("/api/logs/disable", HTTP_POST, handleDisableLogs);
    gServer.on("/api/testBuzzer", HTTP_GET, handleTestBuzzer);
    gServer.on("/api/testRegionAlert", HTTP_GET, handleTestRegionAlert);
    gServer.on("/api/calibrate/led", HTTP_GET, handleCalibrateLed);
    gServer.on("/api/calibrate/done", HTTP_GET, handleCalibrateDone);
    gServer.on("/api/restart", HTTP_GET, handleRestart);
    gServer.on("/config", HTTP_GET, handleConfigApiGet);
    gServer.on("/config", HTTP_POST, handleConfigApiPost);
    gServer.on("/health", HTTP_GET, handleHealth);

    gServer.serveStatic("/index.html", LittleFS, "/index.html");
    gServer.serveStatic("/style.css", LittleFS, "/style.css");
    gServer.serveStatic("/bootstrap.min.css", LittleFS, "/bootstrap.min.css");
    gServer.serveStatic("/bootstrap.bundle.min.js", LittleFS, "/bootstrap.bundle.min.js");
    gServer.serveStatic("/main.js", LittleFS, "/main.js");
    gServer.serveStatic("/qrcode.min.js", LittleFS, "/qrcode.min.js");
    gServer.serveStatic("/map.svg", LittleFS, "/map.svg");
    gServer.serveStatic("/favicon.svg", LittleFS, "/favicon.svg");

    gServer.onNotFound([]()
                       { gServer.send(404, "text/plain", "Not found"); });

    gServer.begin();
    LOG_INFO(LOG_CAT_WEB, "Server started -> http://%s", WiFi.localIP().toString().c_str());
}

void webserverHandle()
{
    gServer.handleClient();
    if (gRestartScheduled && (long)(millis() - gRestartAtMs) >= 0)
    {
        gRestartScheduled = false;
        ESP.restart();
    }
}
