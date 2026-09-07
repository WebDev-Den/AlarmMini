// startup_runtime_under_test.h is extracted verbatim from startup.h by the runner.
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <iostream>
#include <string>
#include "../src/wifi_recovery.h"

using String = std::string;
constexpr int WL_CONNECTED = 3;
constexpr int WL_DISCONNECTED = 6;
constexpr int WIFI_STA = 1;
constexpr int WIFI_OFF = 0;
constexpr int WIFI_AP = 2;
constexpr int WIFI_AP_STA = 3;
constexpr int WIFI_SCAN_RUNNING = -1;
constexpr int WIFI_SSID_MAXLEN = 64;
constexpr int WIFI_PASS_MAXLEN = 64;
constexpr const char* AP_NAME = "AlarmMap-Setup";
constexpr const char* AP_PASSWORD = "";
#define LOG_INFO(...) ((void)0)
#define LOG_WARN(...) ((void)0)
#define ALARMMINI_FEATURE_WIFI_SCAN_PORTAL 1

static uint32_t tick = 0;
static uint32_t millis() { return tick; }
static void delay(unsigned long ms) { tick += uint32_t(ms); }

struct IPAddress
{
    uint32_t address = 0;
    IPAddress() = default;
    IPAddress(uint8_t a, uint8_t b, uint8_t c, uint8_t d)
        : address(uint32_t(a) << 24 | uint32_t(b) << 16 | uint32_t(c) << 8 | d) {}
    bool operator==(const IPAddress& other) const { return address == other.address; }
    bool operator!=(const IPAddress& other) const { return !(*this == other); }
    String toString() const { return std::to_string(address); }
};

struct FakeWifi
{
    int modeValue = WIFI_STA;
    int statusValue = WL_DISCONNECTED;
    int scanValue = -2;
    int beginCalls = 0;
    int apCalls = 0;
    int disconnectCalls = 0;
    int scanDeleteCalls = 0;
    uint32_t beginDuration = 0;
    bool modeOk = true;
    bool configOk = true;
    bool apOk = true;
    bool staleDisconnect = false;
    IPAddress stationIp;
    IPAddress accessIp;
    String stationSsid;
    String stationPass;
    String accessSsid;
    int status() const { return statusValue; }
    IPAddress localIP() const { return stationIp; }
    IPAddress softAPIP() const { return accessIp; }
    String SSID() const { return stationSsid; }
    String softAPSSID() const { return accessSsid; }
    int getMode() const { return modeValue; }
    bool mode(int value)
    {
        if (modeOk)
        {
            modeValue = value;
            if (value == WIFI_OFF)
            {
                statusValue = WL_DISCONNECTED;
                stationIp = {};
            }
        }
        return modeOk;
    }
    bool softAPConfig(IPAddress ip, IPAddress, IPAddress)
    { if (configOk) accessIp = ip; return configOk; }
    bool softAP(const char* ssid, const char*, int, int, int)
    { ++apCalls; if (apOk) accessSsid = ssid; return apOk; }
    bool softAPdisconnect(bool)
    { accessSsid.clear(); accessIp = {}; modeValue = WIFI_STA; return true; }
    int scanComplete() const { return scanValue; }
    void scanDelete() { ++scanDeleteCalls; scanValue = -2; }
    int begin(const char* ssid, const char* pass)
    {
        ++beginCalls;
        stationSsid = ssid;
        stationPass = pass;
        tick += beginDuration;
        return statusValue;
    }
} WiFi;

enum class DNSReplyCode { NoError };
struct DNSServer
{
    bool startOk = true;
    bool active = false;
    int startCalls = 0;
    int processed = 0;
    void setErrorReplyCode(DNSReplyCode) {}
    bool start(int, const char*, IPAddress) { ++startCalls; active = startOk; return startOk; }
    void stop() { active = false; }
    void processNextRequest() { ++processed; }
};

static void platformWifiDisableSleep() {}
static void platformWifiConfigureApRadio() {}
static String platformProvisioningApSsid(const char* prefix) { return String(prefix) + "-123456"; }
static void platformWifiDisconnect()
{
    ++WiFi.disconnectCalls;
    if (!WiFi.staleDisconnect)
    {
        WiFi.statusValue = WL_DISCONNECTED;
        WiFi.stationIp = {};
    }
}

static struct Config
{
    char wifiSsid[WIFI_SSID_MAXLEN] = {};
    char wifiPass[WIFI_PASS_MAXLEN] = {};
} gConfig;
static uint32_t gWifiRecoveryAttempts = 0;
static bool saveOk = true;
static int saveCalls = 0;
static bool storageSaveCurrentConfig()
{
    ++saveCalls;
    tick += 100;
    return saveOk;
}

#include "startup_runtime_under_test.h"

static void require(bool condition, const char* message)
{
    if (!condition)
    {
        std::cerr << "FAIL: " << message << '\n';
        std::exit(EXIT_FAILURE);
    }
}

static void reset()
{
    tick = 0;
    WiFi = {};
    gConfig = {};
    gWifiRecovery = {};
    gProvisioningDns = {};
    gProvisioningDnsActive = false;
    gProvisioningApLastEnsureAt = 0;
    gProvisioningRequired = false;
    gProvisioningApActive = false;
    gWifiConnectRequested = false;
    gWifiDisconnectPending = false;
    gProvisionScanStarted = false;
    gProvisionScanStartedAt = gProvisionScanLastAt = 0;
    gProvisionScanHasRun = false;
    gProvisionWifiState = ProvisionWifiState::Idle;
    memset(gProvisionWifiSsid, 0, sizeof(gProvisionWifiSsid));
    memset(gProvisionWifiPass, 0, sizeof(gProvisionWifiPass));
    gProvisionWifiError = "";
    gProvisionWifiQueuedAt = 0;
    gWifiRecoveryAttempts = 0;
    saveOk = true;
    saveCalls = 0;
}

static void setCredentials(const char* ssid = "saved-router", const char* pass = "saved-password")
{
    snprintf(gConfig.wifiSsid, sizeof(gConfig.wifiSsid), "%s", ssid);
    snprintf(gConfig.wifiPass, sizeof(gConfig.wifiPass), "%s", pass);
}

static void linkUp(const char* ssid)
{
    WiFi.stationSsid = ssid;
    WiFi.statusValue = WL_CONNECTED;
    WiFi.stationIp = IPAddress(192, 168, 1, 10);
}

static void queueCandidate(const char* ssid = "new-router", const char* pass = "new-password")
{
    snprintf(gProvisionWifiSsid, sizeof(gProvisionWifiSsid), "%s", ssid);
    snprintf(gProvisionWifiPass, sizeof(gProvisionWifiPass), "%s", pass);
    gProvisionWifiState = ProvisionWifiState::Queued;
    gProvisionWifiQueuedAt = millis();
}

static void apAndDnsFailuresRecover()
{
    reset();
    WiFi.configOk = false;
    _startProvisioningAp();
    require(gProvisioningRequired && !gProvisioningApActive && !gProvisioningDnsActive,
            "AP config failure must not report working AP/DNS");
    WiFi.configOk = true;
    gProvisioningDns.startOk = false;
    tick = 10000;
    startupProvisioningHandle();
    require(gProvisioningApActive && !gProvisioningDnsActive, "DNS failure must not latch active=true");
    gProvisioningDns.startOk = true;
    tick = 20000;
    startupProvisioningHandle();
    require(gProvisioningDnsActive && gProvisioningDns.startCalls == 2, "failed DNS must retry on a healthy AP");
    WiFi.accessSsid = "wrong-ap";
    tick = 30000;
    startupProvisioningHandle();
    require(WiFi.softAPSSID() == _provisioningApSsid() && gProvisioningDnsActive,
            "lost AP configuration must restore AP and rebind DNS");
}

static void lateRouterAndRuntimeDrop()
{
    reset();
    setCredentials();
    _beginWifiAttempt();
    startupProvisioningHandle();
    tick = 15000;
    _startProvisioningAp();
    require(gWifiRecovery.attempting && WiFi.disconnectCalls == 1, "fallback AP must preserve initial STA attempt");
    tick = 20000;
    startupProvisioningHandle();
    require(!gWifiRecovery.attempting && gProvisioningApActive, "expired boot attempt must leave portal active");
    tick = 49999;
    startupProvisioningHandle();
    require(WiFi.beginCalls == 1, "failed attempt must leave radio idle for the retry interval");
    tick = 50000;
    startupProvisioningHandle();
    startupProvisioningHandle();
    require(WiFi.beginCalls == 2, "portal must retry without a user action");
    tick = 52000;
    linkUp(gConfig.wifiSsid);
    startupProvisioningHandle();
    require(gWifiRecovery.connected && gProvisioningApActive, "connection must retain AP status grace");
    tick = 82000;
    startupProvisioningHandle();
    require(!gProvisioningRequired && !gProvisioningDnsActive && WiFi.getMode() == WIFI_STA,
            "stable success must close portal");
    tick = 90000;
    WiFi.statusValue = WL_DISCONNECTED;
    startupProvisioningHandle();
    startupProvisioningHandle();
    require(WiFi.beginCalls == 3 && !gProvisioningRequired, "runtime drop must trigger immediate STA retry");
    tick = 110000;
    startupProvisioningHandle();
    tick = 120000;
    startupProvisioningHandle();
    require(gProvisioningApActive && gProvisioningDnsActive, "extended runtime loss must start AP plus DNS");
}

static void candidateWaitsForScanAndDhcp()
{
    reset();
    setCredentials();
    _startProvisioningAp();
    tick = 1000;
    gProvisionScanStarted = true;
    gProvisionScanStartedAt = tick;
    WiFi.scanValue = WIFI_SCAN_RUNNING;
    queueCandidate();
    tick = 1500;
    startupProvisioningHandle();
    require(WiFi.beginCalls == 0 && saveCalls == 0, "candidate must not race with active scan");
    WiFi.scanValue = 5;
    startupProvisioningHandle();
    require(WiFi.beginCalls == 1 && !gProvisionScanStarted, "queued candidate must proceed when scan completes");
    WiFi.statusValue = WL_CONNECTED;
    startupProvisioningHandle();
    require(saveCalls == 0 && !gWifiRecovery.connected, "association without DHCP must not commit credentials");
    linkUp("new-router");
    tick = 3000;
    startupProvisioningHandle();
    require(saveCalls == 1 && gProvisionWifiState == ProvisionWifiState::Saved &&
            String(gConfig.wifiSsid) == "new-router" && !gProvisionWifiPass[0],
            "verified candidate must save once and clear temporary password");
    startupProvisioningHandle();
    require(saveCalls == 1, "connected poll must not rewrite config repeatedly");
}

static void failedCandidateRetainsSavedNetwork()
{
    reset();
    setCredentials();
    _startProvisioningAp();
    queueCandidate();
    tick = 250;
    startupProvisioningHandle();
    tick = 20250;
    startupProvisioningHandle();
    require(gProvisionWifiState == ProvisionWifiState::Failed && saveCalls == 0 &&
            String(gConfig.wifiSsid) == "saved-router", "bad candidate must not erase known credentials");
    tick = 50250;
    startupProvisioningHandle();
    startupProvisioningHandle();
    require(WiFi.stationSsid == "saved-router", "timed-out candidate must return to saved network retries");

    reset();
    setCredentials();
    _startProvisioningAp();
    queueCandidate();
    tick = 250;
    startupProvisioningHandle();
    linkUp("new-router");
    saveOk = false;
    startupProvisioningHandle();
    require(gProvisionWifiState == ProvisionWifiState::Failed &&
            String(gConfig.wifiSsid) == "saved-router" && String(gConfig.wifiPass) == "saved-password" &&
            !gWifiRecovery.connected && gProvisioningApActive,
            "flash save failure must restore RAM credentials and keep portal");
}

static void manualRequestSupersedesQueuedCandidate()
{
    reset();
    setCredentials();
    _startProvisioningAp();
    queueCandidate();
    startupRequestWifiConnect();
    startupProvisioningHandle();
    require(WiFi.stationSsid == "saved-router" && gProvisionWifiState == ProvisionWifiState::Idle,
            "UART/manual request must supersede pending portal candidate");
}

static void yieldingBeginUsesFreshClock()
{
    reset();
    setCredentials();
    tick = 50000;
    WiFi.beginDuration = 400;
    startupRequestWifiConnect();
    startupProvisioningHandle();
    require(gWifiRecovery.attempting && gWifiRecovery.attemptSince == tick,
            "time spent inside begin must not underflow the attempt timeout comparison");
}

static void staleLinkMustNotValidateWrongPassword()
{
    reset();
    setCredentials();
    _startProvisioningAp();
    linkUp(gConfig.wifiSsid);
    gWifiRecovery.observe(true, tick);
    queueCandidate("saved-router", "known-wrong-password");
    WiFi.staleDisconnect = true;
    tick = 250;
    startupProvisioningHandle();
    require(saveCalls == 0 && String(gConfig.wifiPass) == "saved-password",
            "async stale WL_CONNECTED must not validate a new password for the same SSID");
    require(WiFi.beginCalls == 0, "new begin must wait until prior connection is visibly disconnected");
    tick = 20250;
    startupProvisioningHandle();
    require(gProvisionWifiState == ProvisionWifiState::Failed && saveCalls == 0 &&
            gProvisioningApActive && !gWifiDisconnectPending,
            "stuck disconnect must time out and leave a working setup AP");
}

int main()
{
    apAndDnsFailuresRecover();
    lateRouterAndRuntimeDrop();
    candidateWaitsForScanAndDhcp();
    failedCandidateRetainsSavedNetwork();
    manualRequestSupersedesQueuedCandidate();
    yieldingBeginUsesFreshClock();
    staleLinkMustNotValidateWrongPassword();
    std::cout << "PASS: production Wi-Fi runtime AP/DNS recovery, scan/queue, DHCP, rollback, stale link\n";
}
