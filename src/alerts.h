#pragma once
#include "platform_compat.h"
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
bool gMqttDataStale                 = false;
bool gUsingFallbackSnapshot         = false;
bool gAlertTestActive               = false;
bool gAlertTestRegions[REGIONS_COUNT] = {false};
unsigned long gAlertTestStartedAt   = 0;
unsigned long gRegionStateChangedAt[REGIONS_COUNT] = {0};
uint32_t gMqttReconnectAttempts = 0;
uint32_t gMqttReconnectSuccess = 0;
uint32_t gMqttDisconnectEvents = 0;
uint32_t gMqttPayloadErrors = 0;
uint32_t gMqttMessagesReceived = 0;
uint32_t gMqttSubscriptionRefreshes = 0;
uint32_t gMqttSubscriptionRefreshFailures = 0;
uint32_t gMqttStaleReconnects = 0;
uint32_t gWifiRecoveryAttempts = 0;
uint32_t gInternetStateChanges = 0;
unsigned long gLastMqttMessageAt = 0;

static WiFiClient    _mqttWifi;
static PubSubClient  _mqtt(_mqttWifi);
static unsigned long _mqttLastReconnect = 0;
static int           _mqttReconnectDelay = 2000;
static unsigned long _internetLastCheck = 0;
static unsigned long _transportDownSince = 0;
static unsigned long _transportStableSince = 0;
static constexpr unsigned long INTERNET_CHECK_INTERVAL_MS = 60000UL;
static constexpr unsigned long AUTONOMOUS_HEALTH_INTERVAL_MS = 60000UL;
static constexpr unsigned long MQTT_STATUS_REFRESH_INTERVAL_MS = 60000UL;
static constexpr unsigned long MQTT_STALE_RECONNECT_MS = 10UL * 60UL * 1000UL;
static constexpr unsigned long WIFI_RECOVERY_INTERVAL_MS = 60000UL;
static constexpr unsigned long STARTUP_FAST_CHECK_WINDOW_MS = 60000UL;
static constexpr unsigned long STARTUP_INTERNET_CHECK_INTERVAL_MS = 15000UL;
static constexpr unsigned long STARTUP_WIFI_RECOVERY_INTERVAL_MS = 15000UL;
static constexpr unsigned long TRANSPORT_DROP_DEBOUNCE_MS = 5000UL;
static constexpr unsigned long TRANSPORT_STABLE_BEFORE_MQTT_MS = 8000UL;
static constexpr uint16_t MQTT_SOCKET_TIMEOUT_S = 1;
static constexpr unsigned long MQTT_LOOP_GUARD_MS = 10UL;
static constexpr unsigned long MQTT_LOOP_HARD_LIMIT_MS = 2000UL;
static constexpr unsigned int MQTT_MAX_PAYLOAD_BYTES = 1024U;
static constexpr unsigned long MQTT_DNS_REFRESH_MS = 30000UL;
static constexpr uint32_t MQTT_MIN_HEAP_FOR_CONNECT = 12000UL;
static unsigned long _mqttLastFailLogAt = 0;
static int _mqttLastFailState = 0;
static unsigned long _mqttLastLowHeapLogAt = 0;
static unsigned long _mqttLastDnsResolveAt = 0;
static unsigned long _mqttLastDnsLogAt = 0;
static IPAddress _mqttResolvedIp;
static bool _mqttHasResolvedIp = false;
static unsigned long _autonomousLastHealthAt = 0;
static unsigned long _mqttLastStatusRefreshAt = 0;
static unsigned long _mqttLastStaleReconnectAt = 0;
static unsigned long _wifiLastRecoveryAt = 0;
static constexpr char MQTT_SNAPSHOT_PATH[] = "/mqtt_snapshot.json";
static bool _mqttSnapshotLoadedOnce = false;
static void _rebuildEffectiveAlerts();

static bool _saveMqttSnapshot()
{
    StaticJsonDocument<256> doc;
    JsonArray states = doc.createNestedArray("states");
    for (int i = 0; i < REGIONS_COUNT; i++) {
        states.add(gMqttAlerts[i]);
    }
    doc["ts"] = millis();

    File tmp = LittleFS.open("/mqtt_snapshot.tmp", "w");
    if (!tmp) return false;
    if (serializeJson(doc, tmp) == 0 || tmp.getWriteError()) {
        tmp.close();
        LittleFS.remove("/mqtt_snapshot.tmp");
        return false;
    }
    tmp.flush();
    tmp.close();
    LittleFS.remove(MQTT_SNAPSHOT_PATH);
    if (!LittleFS.rename("/mqtt_snapshot.tmp", MQTT_SNAPSHOT_PATH)) {
        LittleFS.remove("/mqtt_snapshot.tmp");
        return false;
    }
    return true;
}

static bool _loadMqttSnapshot()
{
    if (!LittleFS.exists(MQTT_SNAPSHOT_PATH)) return false;

    File f = LittleFS.open(MQTT_SNAPSHOT_PATH, "r");
    if (!f) return false;

    StaticJsonDocument<256> doc;
    const auto err = deserializeJson(doc, f);
    f.close();
    if (err) return false;

    JsonArrayConst arr = doc["states"].as<JsonArrayConst>();
    if (arr.isNull()) return false;

    bool anyChanged = false;
    for (int i = 0; i < REGIONS_COUNT; i++) {
        const bool v = (i < (int)arr.size()) ? arr[i].as<bool>() : false;
        if (gMqttAlerts[i] != v) anyChanged = true;
        gMqttAlerts[i] = v;
    }
    _rebuildEffectiveAlerts();
    gFetchOk = true;
    gMqttDataStale = true;
    gUsingFallbackSnapshot = true;
    if (anyChanged) {
        LOG_WARN(LOG_CAT_MQTT, "Applied fallback MQTT snapshot from LittleFS");
    }
    return true;
}

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
    unsigned long now = millis();
    for (int i = 0; i < REGIONS_COUNT; i++) {
        effective[i] = gMqttAlerts[i];
    }

    if (gAlertTestActive) {
        unsigned long elapsed = now - gAlertTestStartedAt;
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
    if (length == 0 || length > MQTT_MAX_PAYLOAD_BYTES) {
        gMqttPayloadErrors++;
        LOG_WARN(LOG_CAT_MQTT, "Payload size %u is out of safe bounds", length);
        gFetchOk = false;
        return;
    }

    StaticJsonDocument<512> doc;
    if (deserializeJson(doc, payload, length) || !doc.is<JsonArray>()) {
        gMqttPayloadErrors++;
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
    gMqttDataStale = false;
    gUsingFallbackSnapshot = false;
    gMqttMessagesReceived++;
    gLastMqttMessageAt = millis();
    _saveMqttSnapshot();
    LOG_INFO(LOG_CAT_MQTT, "Received %d states%s",
             (int)arr.size(), gAlertsChanged ? " (changed)" : "");
}

bool _mqttConnect() {
    gMqttReconnectAttempts++;
    if (!strlen(gConfig.mqttHost)) {
        LOG_WARN(LOG_CAT_MQTT, "Broker is not configured");
        return false;
    }

    const uint32_t heapFree = ESP.getFreeHeap();
    if (heapFree < MQTT_MIN_HEAP_FOR_CONNECT) {
        const unsigned long now = millis();
        if ((now - _mqttLastLowHeapLogAt) > 15000UL) {
            _mqttLastLowHeapLogAt = now;
            LOG_WARN(LOG_CAT_MQTT, "Reconnect postponed: low heap (%lu bytes)", (unsigned long)heapFree);
        }
        return false;
    }

    // DNS resolution on unstable links can block long enough to disturb MQTT recovery.
    // Prefer cached/resolved IP and refresh it periodically.
    IPAddress hostIp;
    bool useResolvedIp = false;
    if (hostIp.fromString(gConfig.mqttHost)) {
        useResolvedIp = true;
    } else {
        const unsigned long now = millis();
        if (!_mqttHasResolvedIp || (now - _mqttLastDnsResolveAt) > MQTT_DNS_REFRESH_MS) {
            _mqttLastDnsResolveAt = now;
            IPAddress resolved;
            if (WiFi.hostByName(gConfig.mqttHost, resolved)) {
                _mqttResolvedIp = resolved;
                _mqttHasResolvedIp = true;
            } else {
                if ((now - _mqttLastDnsLogAt) > 10000UL) {
                    _mqttLastDnsLogAt = now;
                    LOG_WARN(LOG_CAT_MQTT, "DNS resolve failed for '%s'", gConfig.mqttHost);
                }
            }
        }
        if (_mqttHasResolvedIp) {
            hostIp = _mqttResolvedIp;
            useResolvedIp = true;
        }
    }

    if (useResolvedIp) {
        _mqtt.setServer(hostIp, gConfig.mqttPort);
    } else {
        _mqtt.setServer(gConfig.mqttHost, gConfig.mqttPort);
    }
    _mqtt.setCallback(_mqttCallback);
    _mqtt.setKeepAlive(60);
    _mqtt.setSocketTimeout(MQTT_SOCKET_TIMEOUT_S);
    _mqttWifi.setTimeout(1000);
    _mqttWifi.stop();

    char clientId[24];
    snprintf(clientId, sizeof(clientId), "alarm-map-%06X", platformChipId());

    bool ok = strlen(gConfig.mqttUser)
        ? _mqtt.connect(clientId, gConfig.mqttUser, gConfig.mqttPass)
        : _mqtt.connect(clientId);

    if (ok) {
        const char* t = strlen(gConfig.mqttTopic) ? gConfig.mqttTopic : "alerts/status";
        if (!_mqtt.subscribe(t, 1)) {
            gMqttSubscriptionRefreshFailures++;
            LOG_WARN(LOG_CAT_MQTT, "Subscribe failed for topic: '%s'", t);
            _mqtt.disconnect();
            _mqttWifi.stop();
            gMqttConnected = false;
            return false;
        }
        gMqttConnected = true;
        gMqttReconnectSuccess++;
        _mqttReconnectDelay = 2000;
        _transportDownSince = 0;
        _mqttLastStatusRefreshAt = millis();
        LOG_INFO(LOG_CAT_MQTT, "Connected, topic: '%s'", t);
    } else {
        gMqttConnected = false;
        _mqttReconnectDelay = min(_mqttReconnectDelay * 2, 60000);
        const int state = _mqtt.state();
        const unsigned long now = millis();
        if (_mqttLastFailState != state || (now - _mqttLastFailLogAt) > 10000UL) {
            _mqttLastFailState = state;
            _mqttLastFailLogAt = now;
            LOG_WARN(LOG_CAT_MQTT, "Connect error rc=%d, next retry in %ds",
                     state, _mqttReconnectDelay / 1000);
        }
    }

    return ok;
}

static bool _mqttRefreshStatusSubscription(unsigned long now) {
    if (!_mqtt.connected() || !strlen(gConfig.mqttHost)) {
        return false;
    }
    if (now - _mqttLastStatusRefreshAt < MQTT_STATUS_REFRESH_INTERVAL_MS) {
        return true;
    }
    _mqttLastStatusRefreshAt = now;

    const char* t = strlen(gConfig.mqttTopic) ? gConfig.mqttTopic : "alerts/status";
    _mqtt.unsubscribe(t);
    yield();

    if (_mqtt.subscribe(t, 1)) {
        gMqttSubscriptionRefreshes++;
        LOG_INFO(LOG_CAT_MQTT, "Subscription refreshed: '%s'", t);
        return true;
    }

    gMqttSubscriptionRefreshFailures++;
    LOG_WARN(LOG_CAT_MQTT, "Subscription refresh failed, forcing reconnect");
    _mqtt.disconnect();
    _mqttWifi.stop();
    gMqttConnected = false;
    _mqttLastReconnect = 0;
    _mqttReconnectDelay = 2000;
    return false;
}

static void _wifiRecoveryTick(unsigned long now) {
    if (WiFi.status() == WL_CONNECTED || !strlen(gConfig.wifiSsid)) {
        return;
    }
    const unsigned long interval = now < STARTUP_FAST_CHECK_WINDOW_MS
        ? STARTUP_WIFI_RECOVERY_INTERVAL_MS
        : WIFI_RECOVERY_INTERVAL_MS;
    if (now - _wifiLastRecoveryAt < interval) {
        return;
    }

    _wifiLastRecoveryAt = now;
    gWifiRecoveryAttempts++;
    LOG_INFO(LOG_CAT_WIFI, "WiFi recovery attempt #%lu", (unsigned long)gWifiRecoveryAttempts);

    // AP_STA keeps the setup portal reachable while STA retries the saved network.
    WiFi.mode(WIFI_AP_STA);
    WiFi.begin(gConfig.wifiSsid, gConfig.wifiPass);
}

static void _mqttStaleWatchdogTick(unsigned long now) {
    if (!_mqtt.connected() || !gFetchOk || gLastMqttMessageAt == 0) {
        gMqttDataStale = false;
        return;
    }

    const unsigned long age = now - gLastMqttMessageAt;
    gMqttDataStale = age > MQTT_STALE_RECONNECT_MS;
    if (!gMqttDataStale) {
        return;
    }
    if (now - _mqttLastStaleReconnectAt < MQTT_STALE_RECONNECT_MS) {
        return;
    }

    _mqttLastStaleReconnectAt = now;
    gMqttStaleReconnects++;
    LOG_WARN(LOG_CAT_MQTT, "No MQTT payload for %lus, forcing reconnect",
             (unsigned long)(age / 1000UL));
    _mqtt.disconnect();
    _mqttWifi.stop();
    gMqttConnected = false;
    _mqttLastReconnect = 0;
    _mqttReconnectDelay = 2000;
}

bool _checkInternetConnection() {
    if (WiFi.status() != WL_CONNECTED) return false;
    IPAddress ip = WiFi.localIP();
    return ip[0] != 0;
}

void alertsFetch() {
    gInternetConnected = _checkInternetConnection();
    _mqttConnect();
    _rebuildEffectiveAlerts();
}

void alertsReloadClientConfig() {
    if (_mqtt.connected()) {
        _mqtt.disconnect();
        _mqttWifi.stop();
    }
    gMqttConnected = false;
    _mqttLastReconnect = 0;
    _mqttReconnectDelay = 2000;
    _transportStableSince = 0;
}

void alertsHandle() {
    unsigned long now = millis();

    if (gAlertTestActive) {
        _rebuildEffectiveAlerts();
    }

    _wifiRecoveryTick(now);

    const unsigned long internetInterval = now < STARTUP_FAST_CHECK_WINDOW_MS
        ? STARTUP_INTERNET_CHECK_INTERVAL_MS
        : INTERNET_CHECK_INTERVAL_MS;
    if (WiFi.status() == WL_CONNECTED && now - _internetLastCheck > internetInterval) {
        _internetLastCheck = now;
        bool prevInternet = gInternetConnected;
        gInternetConnected = _checkInternetConnection();
        if (prevInternet != gInternetConnected) {
            gInternetStateChanges++;
            LOG_INFO(LOG_CAT_INTERNET, "Internet %s", gInternetConnected ? "online" : "offline");
        }
    } else if (WiFi.status() != WL_CONNECTED) {
        if (gInternetConnected) {
            gInternetStateChanges++;
        }
        gInternetConnected = false;
        _internetLastCheck = 0;
    }

    // Never keep stale MQTT sockets when transport is down.
    if (WiFi.status() != WL_CONNECTED || !gInternetConnected) {
        if (_transportDownSince == 0) {
            _transportDownSince = now;
            _transportStableSince = 0;
            yield();
            return;
        }
        if (now - _transportDownSince < TRANSPORT_DROP_DEBOUNCE_MS) {
            _transportStableSince = 0;
            yield();
            return;
        }
        if (_mqtt.connected()) {
            _mqtt.disconnect();
            _mqttWifi.stop();
        }
        if (gMqttConnected) {
            gMqttConnected = false;
            gMqttDisconnectEvents++;
            LOG_WARN(LOG_CAT_MQTT, "Paused: waiting for WiFi/Internet recovery");
        }
        gMqttDataStale = gFetchOk;
        yield();
        return;
    }
    _transportDownSince = 0;
    if (_transportStableSince == 0) {
        _transportStableSince = now;
    }

    if (_mqtt.connected()) {
        gMqttConnected = true;
        const unsigned long loopStartedAt = millis();
        _mqtt.loop();
        const unsigned long loopElapsed = millis() - loopStartedAt;
        if (loopElapsed > MQTT_LOOP_GUARD_MS) {
            LOG_WARN(LOG_CAT_MQTT, "MQTT loop took %lums", loopElapsed);
        }
        if (loopElapsed > MQTT_LOOP_HARD_LIMIT_MS) {
            LOG_WARN(LOG_CAT_MQTT, "MQTT loop hard limit exceeded, forcing reconnect");
            _mqtt.disconnect();
            _mqttWifi.stop();
            gMqttConnected = false;
            _mqttLastReconnect = now;
        }
        _mqttRefreshStatusSubscription(now);
        _mqttStaleWatchdogTick(now);
        yield();
        return;
    }

    if (gMqttConnected) {
        gMqttConnected = false;
        gMqttDisconnectEvents++;
        LOG_WARN(LOG_CAT_MQTT, "Connection lost, keeping last alert state");
    }

    if (!strlen(gConfig.mqttHost))
    {
        yield();
        return;
    }
    if (now - _transportStableSince < TRANSPORT_STABLE_BEFORE_MQTT_MS)
    {
        yield();
        return;
    }
    if (now - _mqttLastReconnect < (unsigned long)_mqttReconnectDelay)
    {
        yield();
        return;
    }

    _mqttLastReconnect = now;
    LOG_INFO(LOG_CAT_MQTT, "Reconnecting...");
    _mqttConnect();
    if (!_mqttSnapshotLoadedOnce) {
        _mqttSnapshotLoadedOnce = _loadMqttSnapshot();
    }
    yield();
}

void alertsAutonomousHealthTick()
{
    const unsigned long now = millis();
    if ((now - _autonomousLastHealthAt) < AUTONOMOUS_HEALTH_INTERVAL_MS)
        return;
    _autonomousLastHealthAt = now;

    const wl_status_t wifiStatus = WiFi.status();
    const bool wifiOk = (wifiStatus == WL_CONNECTED);
    const bool internetOk = _checkInternetConnection();
    const bool mqttOk = _mqtt.connected();

    bool internetChanged = (gInternetConnected != internetOk);
    gInternetConnected = internetOk;

    if (internetChanged) {
        gInternetStateChanges++;
    }
    if (gMqttConnected != mqttOk) {
        if (gMqttConnected && !mqttOk) gMqttDisconnectEvents++;
        gMqttConnected = mqttOk;
    }

    LOG_INFO(LOG_CAT_INTERNET,
             "Autonomous health: wifi=%d internet=%d mqtt=%d heap=%lu",
             (int)wifiOk, (int)internetOk, (int)mqttOk, (unsigned long)ESP.getFreeHeap());

    if (!wifiOk || !internetOk) {
        return;
    }

    // Link is back but MQTT still down: trigger reconnect path immediately.
    if (!mqttOk && strlen(gConfig.mqttHost)) {
        _transportDownSince = 0;
        _transportStableSince = now;
        _mqttLastReconnect = 0;
        _mqttReconnectDelay = min(_mqttReconnectDelay, 5000);
        LOG_INFO(LOG_CAT_MQTT, "Autonomous health: forcing MQTT reconnect attempt");
        _mqttConnect();
    }
}
