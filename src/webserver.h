#pragma once
#include <ESP8266WebServer.h>
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
String gSessionToken;
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
    return gSessionToken.length() && getCookieValue("ESPSESSION") == gSessionToken;
}

bool ensureAuthorized()
{
    if (isAuthorized())
        return true;

    addCors();
    gServer.send(401, "application/json", "{\"authenticated\":false}");
    return false;
}

void sendJson(DynamicJsonDocument &doc, int status = 200)
{
    addCors();
    String json;
    serializeJson(doc, json);
    gServer.send(status, "application/json", json);
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

    gSessionToken = String(ESP.getChipId(), HEX) + String(micros(), HEX);
    LOG_INFO(LOG_CAT_WEB, "Login successful");
    addCors();
    gServer.sendHeader("Set-Cookie", "ESPSESSION=" + gSessionToken + "; Path=/; HttpOnly; SameSite=Lax");
    gServer.send(200, "application/json", "{\"ok\":true}");
}

void handleLogout()
{
    gSessionToken = "";
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

    File f = LittleFS.open("/config.json", "r");
    if (!f)
    {
        addCors();
        gServer.send(404, "application/json", "{}");
        return;
    }

    DynamicJsonDocument doc(CONFIG_JSON_CAPACITY);
    DeserializationError err = deserializeJson(doc, f);
    f.close();

    if (err)
    {
        addCors();
        gServer.send(500, "application/json", "{}");
        return;
    }

    doc.remove("animations");
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

    DynamicJsonDocument doc(CONFIG_JSON_CAPACITY);
    DeserializationError err = deserializeJson(doc, gServer.arg("plain"));
    if (err)
    {
        addCors();
        gServer.send(400, "text/plain", "Invalid JSON");
        return;
    }

    DynamicJsonDocument currentDoc(CONFIG_JSON_CAPACITY);
    File currentFile = LittleFS.open("/config.json", "r");
    if (currentFile)
    {
        deserializeJson(currentDoc, currentFile);
        currentFile.close();
    }

    doc.remove("adminPassword");
    doc.remove("animations");

    for (JsonPair kv : currentDoc.as<JsonObject>())
    {
        if (!doc.containsKey(kv.key().c_str()))
            doc[kv.key().c_str()] = kv.value();
    }
    doc.remove("adminPassword");
    doc.remove("animations");

    File f = LittleFS.open("/config.json", "w");
    serializeJson(doc, f);
    f.close();

    storageApplyJson(doc);
    loggerSetMask(gConfig.logMask);
    gSessionToken = "";
    LOG_INFO(LOG_CAT_CONFIG, "Settings saved, restart scheduled");

    addCors();
    gServer.sendHeader("Set-Cookie", "ESPSESSION=deleted; Path=/; Max-Age=0; HttpOnly; SameSite=Lax");
    gServer.send(200, "text/plain", "OK");
    scheduleRestart();
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

    DynamicJsonDocument doc(16384);
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
    loggerExportJson(entries);
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

    DynamicJsonDocument doc(CONFIG_JSON_CAPACITY);
    File currentFile = LittleFS.open("/config.json", "r");
    if (currentFile)
    {
        deserializeJson(doc, currentFile);
        currentFile.close();
    }

    doc["logMask"] = 0;

    File outFile = LittleFS.open("/config.json", "w");
    serializeJson(doc, outFile);
    outFile.close();

    loggerClear();
    gConfig.logMask = 0;
    loggerSetMask(0);

    addCors();
    gServer.send(200, "application/json", "{\"ok\":true,\"disabled\":true}");
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
