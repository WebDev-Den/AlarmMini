#pragma once
#include <ESP8266WiFi.h>
#include <ArduinoJson.h>
#include <PubSubClient.h>
#include "config.h"
#include "storage.h"
#include "logger.h"

bool gAlerts[REGIONS_COUNT]         = {false};
bool gPrevAlerts[REGIONS_COUNT]     = {false};
bool gMqttAlerts[REGIONS_COUNT]     = {false};
bool gFetchOk                       = false;
bool gAlertsChanged                 = false;
bool gMqttConnected                 = false;
bool gInternetConnected             = false;
bool gAlertTestActive               = false;
bool gAlertTestRegions[REGIONS_COUNT] = {false};
unsigned long gAlertTestStartedAt   = 0;
unsigned long gRegionStateChangedAt[REGIONS_COUNT] = {0};

static WiFiClient    _mqttWifi;
static PubSubClient  _mqtt(_mqttWifi);
static unsigned long _mqttLastReconnect = 0;
static int           _mqttReconnectDelay = 2000;
static unsigned long _internetLastCheck = 0;
static constexpr unsigned long INTERNET_CHECK_INTERVAL_MS = 60000UL;
static constexpr uint16_t INTERNET_CONNECT_TIMEOUT_MS = 250;
static constexpr uint16_t MQTT_SOCKET_TIMEOUT_S = 3;

static void _formatLogClock(char* buffer, size_t size)
{
    time_t now = time(nullptr);
    struct tm *tinfo = localtime(&now);
    if (tinfo && tinfo->tm_year >= 120)
    {
        snprintf(buffer, size, "%02d:%02d:%02d", tinfo->tm_hour, tinfo->tm_min, tinfo->tm_sec);
        return;
    }

    unsigned long seconds = millis() / 1000UL;
    unsigned long hours = (seconds / 3600UL) % 100UL;
    unsigned long minutes = (seconds / 60UL) % 60UL;
    unsigned long secs = seconds % 60UL;
    snprintf(buffer, size, "uptime %02lu:%02lu:%02lu", hours, minutes, secs);
}

static void _applyEffectiveAlerts(const bool* nextStates) {
    gAlertsChanged = false;
    unsigned long now = millis();

    for (int i = 0; i < REGIONS_COUNT; i++) {
        bool next = nextStates[i];
        if (next != gAlerts[i]) {
            gAlertsChanged = true;
            gRegionStateChangedAt[i] = now;
        }
        gPrevAlerts[i] = gAlerts[i];
        gAlerts[i] = next;
    }
}

static void _rebuildEffectiveAlerts() {
    bool effective[REGIONS_COUNT];
    for (int i = 0; i < REGIONS_COUNT; i++) {
        effective[i] = gMqttAlerts[i];
    }

    if (gAlertTestActive) {
        unsigned long elapsed = millis() - gAlertTestStartedAt;
        bool alertPhase = elapsed < 30000UL;
        bool clearPhase = elapsed >= 30000UL && elapsed < 60000UL;

        if (!alertPhase && !clearPhase) {
            gAlertTestActive = false;
        } else {
            for (int i = 0; i < REGIONS_COUNT; i++) {
                if (gAlertTestRegions[i]) {
                    effective[i] = alertPhase;
                }
            }
        }
    }

    _applyEffectiveAlerts(effective);
}

bool alertsStartSubscribedRegionTest() {
    bool hasAny = false;
    for (int i = 0; i < REGIONS_COUNT; i++) {
        gAlertTestRegions[i] = gConfig.buzzer.regions[i];
        hasAny = hasAny || gAlertTestRegions[i];
    }

    if (!hasAny) {
        return false;
    }

    gAlertTestActive = true;
    gAlertTestStartedAt = millis();
    _rebuildEffectiveAlerts();
    LOG_INFO(LOG_CAT_TEST, "Region alert simulation started: 30s alert + 30s clear");
    return true;
}

void _mqttCallback(char* topic, byte* payload, unsigned int length) {
    StaticJsonDocument<512> doc;
    if (deserializeJson(doc, payload, length) || !doc.is<JsonArray>()) {
        LOG_WARN(LOG_CAT_MQTT, "Invalid payload, expected [0,1,0,...]");
        gFetchOk = false;
        return;
    }

    JsonArray arr = doc.as<JsonArray>();
    char eventTime[24];
    _formatLogClock(eventTime, sizeof(eventTime));

    for (int i = 0; i < REGIONS_COUNT; i++) {
        bool v = (i < (int)arr.size()) && arr[i].as<bool>();
        if (v != gMqttAlerts[i]) {
            LOG_INFO(LOG_CAT_MQTT, "Region '%s' -> %s at %s",
                     REGIONS[i],
                     v ? "ALERT" : "CLEAR",
                     eventTime);
        }
        gMqttAlerts[i] = v;
    }

    _rebuildEffectiveAlerts();
    gFetchOk = true;
    LOG_INFO(LOG_CAT_MQTT, "Received %d states%s",
             (int)arr.size(), gAlertsChanged ? " (changed)" : "");
}

bool _mqttConnect() {
    if (!strlen(gConfig.mqttHost)) {
        LOG_WARN(LOG_CAT_MQTT, "Broker is not configured");
        return false;
    }

    _mqtt.setServer(gConfig.mqttHost, gConfig.mqttPort);
    _mqtt.setCallback(_mqttCallback);
    _mqtt.setKeepAlive(256);
    _mqtt.setSocketTimeout(MQTT_SOCKET_TIMEOUT_S);

    char clientId[24];
    snprintf(clientId, sizeof(clientId), "alarm-map-%06X", ESP.getChipId());

    bool ok = strlen(gConfig.mqttUser)
        ? _mqtt.connect(clientId, gConfig.mqttUser, gConfig.mqttPass)
        : _mqtt.connect(clientId);

    if (ok) {
        const char* t = strlen(gConfig.mqttTopic) ? gConfig.mqttTopic : "alerts/status";
        _mqtt.subscribe(t, 1);
        gMqttConnected = true;
        _mqttReconnectDelay = 2000;
        LOG_INFO(LOG_CAT_MQTT, "Connected, topic: '%s'", t);
    } else {
        gMqttConnected = false;
        _mqttReconnectDelay = min(_mqttReconnectDelay * 2, 60000);
        LOG_WARN(LOG_CAT_MQTT, "Connect error rc=%d, next retry in %ds",
                 _mqtt.state(), _mqttReconnectDelay / 1000);
    }

    return ok;
}

bool _checkInternetConnection() {
    if (WiFi.status() != WL_CONNECTED) return false;

    WiFiClient testClient;
    testClient.setTimeout(INTERNET_CONNECT_TIMEOUT_MS);
    bool ok = testClient.connect(IPAddress(1, 1, 1, 1), 80);
    if (ok) testClient.stop();
    yield();
    return ok;
}

void alertsFetch() {
    gInternetConnected = _checkInternetConnection();
    _mqttConnect();
    _rebuildEffectiveAlerts();
}

void alertsReloadClientConfig() {
    if (_mqtt.connected()) {
        _mqtt.disconnect();
    }
    gMqttConnected = false;
    _mqttLastReconnect = 0;
    _mqttReconnectDelay = 2000;
}

void alertsHandle() {
    unsigned long now = millis();

    if (gAlertTestActive) {
        _rebuildEffectiveAlerts();
    }

    if (WiFi.status() == WL_CONNECTED && now - _internetLastCheck > INTERNET_CHECK_INTERVAL_MS) {
        _internetLastCheck = now;
        bool prevInternet = gInternetConnected;
        gInternetConnected = _checkInternetConnection();
        if (prevInternet != gInternetConnected) {
            LOG_INFO(LOG_CAT_INTERNET, "Internet %s", gInternetConnected ? "online" : "offline");
        }
    } else if (WiFi.status() != WL_CONNECTED) {
        gInternetConnected = false;
    }

    if (_mqtt.connected()) {
        gMqttConnected = true;
        _mqtt.loop();
        yield();
        return;
    }

    if (gMqttConnected) {
        gMqttConnected = false;
        LOG_WARN(LOG_CAT_MQTT, "Connection lost, keeping last alert state");
    }

    if (!strlen(gConfig.mqttHost)) return;
    if (now - _mqttLastReconnect < (unsigned long)_mqttReconnectDelay) return;

    _mqttLastReconnect = now;
    LOG_INFO(LOG_CAT_MQTT, "Reconnecting...");
    _mqttConnect();
    yield();
}
