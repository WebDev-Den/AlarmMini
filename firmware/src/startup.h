#pragma once
#include <Arduino.h>
#include <DNSServer.h>
#include <ArduinoJson.h>
#if defined(ESP32)
#include <esp_wifi.h>
#endif
#include "platform_compat.h"
#include "config.h"
#include "storage.h"
#include "leds.h"
#include "animations.h"
#include "logger.h"
#include "reset_trace.h"
#include "wifi_recovery.h"

void serialProtocolHandle();

static DNSServer gProvisioningDns;
static bool gProvisioningDnsActive = false;
static unsigned long gProvisioningApLastEnsureAt = 0;
static bool gProvisioningRequired = false;
static bool gProvisioningApActive = false;
static WifiRecoverySchedule gWifiRecovery;
static bool gWifiConnectRequested = false;
static bool gWifiDisconnectPending = false;
static bool gProvisionScanStarted = false;
static unsigned long gProvisionScanStartedAt = 0;
#if ALARMMINI_FEATURE_WIFI_SCAN_PORTAL
static unsigned long gProvisionScanLastAt = 0;
static bool gProvisionScanHasRun = false;
#endif
enum class ProvisionWifiState { Idle, Queued, Connecting, Saved, Failed };
static ProvisionWifiState gProvisionWifiState = ProvisionWifiState::Idle;
static char gProvisionWifiSsid[WIFI_SSID_MAXLEN] = {};
static char gProvisionWifiPass[WIFI_PASS_MAXLEN] = {};
static const char *gProvisionWifiError = "";
static unsigned long gProvisionWifiQueuedAt = 0;

static bool _wifiReady()
{
    return WiFi.status() == WL_CONNECTED && WiFi.localIP() != IPAddress(0, 0, 0, 0);
}

void startupRequestWifiConnect()
{
    // Shared by UART and the portal: never tear down the AP from a request handler.
    gWifiConnectRequested = true;
    gProvisionWifiState = ProvisionWifiState::Idle;
    memset(gProvisionWifiPass, 0, sizeof(gProvisionWifiPass));
    gProvisionWifiError = "";
}

static String _provisioningApSsid()
{
    return platformProvisioningApSsid(AP_NAME);
}

static void _showStartupBounceFlagAnimation(uint8_t ledCount,
                                            const Color& primary,
                                            const Color& secondary,
                                            unsigned long frameIntervalMs)
{
    static unsigned long lastFrameAt = 0;
    const unsigned long nowTick = millis();
    if (frameIntervalMs > 0 && nowTick - lastFrameAt < frameIntervalMs)
        return;
    lastFrameAt = nowTick;

    if (ledCount == 0)
    {
        strip.clear();
        ledsShowIfChanged();
        return;
    }

    const float nowMs = (float)millis();
    const float sweepT = fmodf(nowMs / STARTUP_ANIMATION_SWEEP_MS, 1.0f);
    const float pingPong = 1.0f - fabsf((sweepT * 2.0f) - 1.0f);
    const float eased = pingPong * pingPong * (3.0f - 2.0f * pingPong);
    const float head = (ledCount > 1) ? eased * (float)(ledCount - 1) : 0.0f;

    const float breath = 0.5f + 0.5f * sinf(nowMs * 0.0018f);
    const float ambient = 0.06f + 0.08f * breath;
    const float waveTime = nowMs * 0.0012f;

    for (uint8_t i = 0; i < ledCount; i++)
    {
        const float distance = fabsf((float)i - head);
        const float tailProgress = constrain(distance / STARTUP_ANIMATION_TAIL_LENGTH, 0.0f, 1.0f);
        const float fade = 1.0f - (tailProgress * tailProgress);
        const float glow = powf(max(0.0f, fade), STARTUP_ANIMATION_BRIGHTNESS_POWER);

        const float pos = (ledCount > 1) ? ((float)i / (float)(ledCount - 1)) : 0.0f;
        const float flagWave = 0.5f + 0.5f * sinf((pos * 2.6f - waveTime) * 6.2831853f);
        const float blend = constrain(0.15f + 0.65f * pos + 0.20f * (flagWave - 0.5f), 0.0f, 1.0f);
        Color mixed = {
            (uint8_t)(primary.r + (secondary.r - primary.r) * blend),
            (uint8_t)(primary.g + (secondary.g - primary.g) * blend),
            (uint8_t)(primary.b + (secondary.b - primary.b) * blend),
            (uint8_t)(primary.a)
        };

        const float sparkle = 0.03f + 0.03f * sinf((nowMs * 0.004f) + ((float)i * 0.75f));
        const float brightness = constrain(ambient + glow * (0.75f + 0.25f * breath) + sparkle, 0.0f, 1.0f);
        uint32_t color = applyColorBrightness(mixed, brightness);

        strip.setPixelColor(i, color);
    }

    for (uint8_t i = ledCount; i < MAX_LEDS; i++)
        strip.setPixelColor(i, 0);

    ledsShowIfChanged();
}

static void _showApFlagBlendAnimation(uint8_t ledCount,
                                      const Color& primary,
                                      const Color& secondary,
                                      unsigned long frameIntervalMs)
{
    static unsigned long lastFrameAt = 0;
    const unsigned long nowTick = millis();
    if (frameIntervalMs > 0 && nowTick - lastFrameAt < frameIntervalMs)
        return;
    lastFrameAt = nowTick;

    if (ledCount == 0)
    {
        strip.clear();
        ledsShowIfChanged();
        return;
    }

    const float phase = millis() / (float)max<unsigned long>(frameIntervalMs, 1UL);

    for (uint8_t i = 0; i < ledCount; i++)
    {
        const uint32_t seed = (uint32_t)(i + 1) * 2654435761UL;
        const float offset = (seed & 0xFF) / 255.0f;
        const float wave = 0.5f + 0.5f * sinf((phase * AP_ANIMATION_PHASE_SPEED) + offset * 6.2831853f);
        const float brightness = AP_ANIMATION_MIN_BRIGHTNESS + wave * AP_ANIMATION_BRIGHTNESS_RANGE;
        Color mixed = {
            (uint8_t)(primary.r + (secondary.r - primary.r) * wave),
            (uint8_t)(primary.g + (secondary.g - primary.g) * wave),
            (uint8_t)(primary.b + (secondary.b - primary.b) * wave),
            primary.a
        };
        strip.setPixelColor(i, applyColorBrightness(mixed, brightness));
    }

    for (uint8_t i = ledCount; i < MAX_LEDS; i++)
        strip.setPixelColor(i, 0);

    ledsShowIfChanged();
}

static String _htmlEscape(const String& value)
{
    String out;
    out.reserve(value.length() + 8);
    for (size_t i = 0; i < value.length(); i++)
    {
        const char c = value[i];
        if (c == '&') out += F("&amp;");
        else if (c == '<') out += F("&lt;");
        else if (c == '>') out += F("&gt;");
        else if (c == '"') out += F("&quot;");
        else out += c;
    }
    return out;
}

static bool _readWifiProvisionPayload(AlarmWebServer& server, String& ssid, String& pass, String& error)
{
    ssid = "";
    pass = "";

    if (server.hasArg("plain") && server.arg("plain").length())
    {
        StaticJsonDocument<384> doc;
        DeserializationError jsonErr = deserializeJson(doc, server.arg("plain"));
        if (jsonErr)
        {
            error = F("invalid_json");
            return false;
        }
        ssid = String(doc["ssid"] | "");
        pass = String(doc["password"] | "");
    }
    else
    {
        ssid = server.arg("ssid");
        pass = server.arg("password");
    }

    if (ssid.length() == 0)
    {
        error = F("ssid_required");
        return false;
    }
    if (ssid.length() > 32)
    {
        error = F("ssid_too_long");
        return false;
    }
    if (pass.length() >= WIFI_PASS_MAXLEN)
    {
        error = F("password_too_long");
        return false;
    }

    return true;
}

static void _sendProvisionJson(AlarmWebServer& server, JsonDocument& doc, int status = 200)
{
    server.sendHeader("Cache-Control", "no-store");
    server.sendHeader("Access-Control-Allow-Origin", "*");
    String body;
    serializeJson(doc, body);
    server.send(status, "application/json", body);
}

static void _sendProvisionStatus(AlarmWebServer& server, bool portalActive)
{
    StaticJsonDocument<768> doc;
    doc["ok"] = true;
    doc["portal"] = portalActive;
    doc["wifiConnected"] = _wifiReady();
    doc["ssid"] = WiFi.SSID();
    doc["ip"] = WiFi.localIP().toString();
    doc["apSsid"] = _provisioningApSsid();
    doc["apIp"] = WiFi.softAPIP().toString();
    doc["connecting"] = gWifiRecovery.attempting || gProvisionWifiState == ProvisionWifiState::Queued;
    doc["saved"] = gProvisionWifiState == ProvisionWifiState::Saved;
    doc["error"] = gProvisionWifiError;
    _sendProvisionJson(server, doc);
}

#if ALARMMINI_FEATURE_WIFI_SCAN_PORTAL
static const char* _wifiAuthLabel(uint8_t encryption)
{
    switch (encryption)
    {
#if defined(ESP8266)
    case AUTH_OPEN:
        return "open";
    case AUTH_WEP:
        return "wep";
    case AUTH_WPA_PSK:
        return "wpa";
    case AUTH_WPA2_PSK:
        return "wpa2";
    case AUTH_WPA_WPA2_PSK:
        return "wpa/wpa2";
#else
    case WIFI_AUTH_OPEN:
        return "open";
    case WIFI_AUTH_WEP:
        return "wep";
    case WIFI_AUTH_WPA_PSK:
        return "wpa";
    case WIFI_AUTH_WPA2_PSK:
        return "wpa2";
    case WIFI_AUTH_WPA_WPA2_PSK:
        return "wpa/wpa2";
    case WIFI_AUTH_WPA2_ENTERPRISE:
        return "wpa2-enterprise";
    case WIFI_AUTH_WPA3_PSK:
        return "wpa3";
    case WIFI_AUTH_WPA2_WPA3_PSK:
        return "wpa2/wpa3";
#endif
    default:
        return "secured";
    }
}

static bool _wifiAuthIsOpen(uint8_t encryption)
{
#if defined(ESP8266)
    return encryption == AUTH_OPEN;
#else
    return encryption == WIFI_AUTH_OPEN;
#endif
}
#endif

static void _sendProvisionNetworks(AlarmWebServer& server)
{
#if !ALARMMINI_FEATURE_WIFI_SCAN_PORTAL
    DynamicJsonDocument doc(192);
    doc["ok"] = true;
    doc["scanDisabled"] = true;
    doc["count"] = 0;
    doc.createNestedArray("networks");
    _sendProvisionJson(server, doc);
    return;
#else
    // Only one async scan at a time; an association and a scan must not compete.
    if (gWifiRecovery.attempting || gWifiConnectRequested ||
        gProvisionWifiState == ProvisionWifiState::Queued)
    {
        StaticJsonDocument<128> busy;
        busy["ok"] = false;
        busy["error"] = "wifi_connecting";
        _sendProvisionJson(server, busy, 409);
        return;
    }
    int found = WiFi.scanComplete();
    if (!gProvisionScanStarted)
    {
        if (gProvisionScanHasRun && millis() - gProvisionScanLastAt < 15000UL)
        {
            StaticJsonDocument<128> busy;
            busy["ok"] = false;
            busy["error"] = "scan_rate_limited";
            _sendProvisionJson(server, busy, 429);
            return;
        }
        WiFi.scanDelete();
        found = WiFi.scanNetworks(true, false);
        gProvisionScanStarted = true;
        gProvisionScanHasRun = true;
        gProvisionScanStartedAt = gProvisionScanLastAt = millis();
    }
    if (found == WIFI_SCAN_RUNNING)
    {
        StaticJsonDocument<128> busy;
        busy["ok"] = true;
        busy["scanning"] = true;
        _sendProvisionJson(server, busy, 202);
        return;
    }
    DynamicJsonDocument doc(4096);
    doc["ok"] = true;
    JsonArray networks = doc.createNestedArray("networks");

    doc["scanning"] = false;
    if (found < 0)
    {
        doc["ok"] = false;
        doc["error"] = "scan_failed";
    }
    doc["count"] = max(found, 0);

    if (found > 0)
    {
        const uint8_t limit = min(found, 18);
        for (uint8_t i = 0; i < limit; i++)
        {
            const String ssid = WiFi.SSID(i);
            if (ssid.length() == 0)
                continue;

            bool duplicate = false;
            for (JsonObject existing : networks)
            {
                if (ssid == String(existing["ssid"] | ""))
                {
                    duplicate = true;
                    break;
                }
            }
            if (duplicate)
                continue;

            const uint8_t enc = WiFi.encryptionType(i);
            JsonObject item = networks.createNestedObject();
            item["ssid"] = ssid;
            item["rssi"] = WiFi.RSSI(i);
            item["channel"] = WiFi.channel(i);
            item["auth"] = _wifiAuthLabel(enc);
            item["open"] = _wifiAuthIsOpen(enc);
        }
    }

    WiFi.scanDelete();
    gProvisionScanStarted = false;
    if (doc.overflowed())
    {
        server.send(503, "application/json", "{\"ok\":false,\"error\":\"low_memory\"}");
        return;
    }
    _sendProvisionJson(server, doc, found < 0 ? 503 : 200);
#endif
}

static const char PROVISION_SCRIPT[] PROGMEM = R"portaljs(<script>
const s=document.getElementById('s'),f=document.getElementById('f'),ssid=document.getElementById('ssid'),pass=document.getElementById('password'),nets=document.getElementById('nets');
let lastIp='',submitting=false,scanBusy=false;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function status(kind,text){s.className='status '+kind;s.textContent=text}
function esc(v){return String(v).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
async function request(url,options={}){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),6000);try{const r=await fetch(url,{...options,cache:'no-store',signal:controller.signal});const j=await r.json();if(!r.ok||j.ok===false)throw new Error(j.error||('HTTP '+r.status));return j}finally{clearTimeout(timer)}}
async function poll(){try{const j=await request('/api/provision/status');const info='AP: '+j.apSsid+'\nIP налаштування: '+j.apIp;if(j.error){const errors={connect_timeout_or_bad_password:'Не вдалося підключитися. Перевір SSID і пароль.',config_save_failed:'Не вдалося зберегти налаштування. Попередні дані збережено.'};status('err',errors[j.error]||j.error)}else if(j.wifiConnected&&!j.connecting&&j.ip&&j.ip!=='0.0.0.0'){lastIp=j.ip;status('ok','Підключено. Відкрий: http://'+lastIp+'/\nТочка налаштування вимкнеться після 30 секунд стабільного зʼєднання.')}else{status('busy',info+'\n\n'+(j.connecting?'Підключення до Wi-Fi…':'Вибери або введи Wi-Fi мережу.'))}}catch(e){if(!lastIp)status('busy','Очікую звʼязок із платою. За потреби підключись знову до точки налаштування.')}finally{setTimeout(poll,2000)}}
f.onsubmit=async e=>{e.preventDefault();if(submitting)return;const body={ssid:ssid.value,password:pass.value};if(!body.ssid){status('err','Введи SSID.');return}submitting=true;lastIp='';status('busy','Перевіряю Wi-Fi…');try{await request('/api/provision/wifi',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});status('busy','Підключаю плату. Налаштування збережуться після успішного зʼєднання.')}catch(e){status('err','Запит не підтверджено: '+e.message+'. Перевіряю стан плати…')}finally{submitting=false}};
async function scan(){if(!nets||scanBusy)return;scanBusy=true;const button=document.getElementById('scan');button.disabled=true;nets.textContent='Сканую Wi-Fi…';const deadline=Date.now()+35000;try{let j;do{try{j=await request('/api/provision/networks')}catch(e){if(e.message==='wifi_connecting'&&Date.now()<deadline){await pause(1500);continue}throw e}if(!j.scanning)break;await pause(700)}while(Date.now()<deadline);if(!j||j.scanning)throw new Error('Час сканування вичерпано');nets.innerHTML=(j.networks||[]).map(n=>`<button class="net" type="button" data-ssid="${esc(n.ssid)}"><b>${esc(n.ssid)}</b><span>${n.rssi} dBm · ${esc(n.auth)}</span></button>`).join('');if(!nets.children.length)nets.textContent='Мережі не знайдено. Введи SSID вручну.';nets.querySelectorAll('.net').forEach(b=>b.onclick=()=>{ssid.value=b.dataset.ssid;pass.focus()})}catch(e){nets.textContent='Сканування: '+e.message+'. Можна ввести SSID вручну.'}finally{scanBusy=false;button.disabled=false}}
if(nets){document.getElementById('scan').onclick=scan;document.getElementById('manual').onclick=()=>ssid.focus();scan()}poll();
</script>)portaljs";

static void _sendProvisionPage(AlarmWebServer& server)
{
#if defined(ESP8266)
    const String savedSsid = _htmlEscape(String(gConfig.wifiSsid));

    server.sendHeader("Cache-Control", "no-store");
    server.setContentLength(CONTENT_LENGTH_UNKNOWN);
    server.send(200, "text/html; charset=utf-8", "");
    server.sendContent(F("<!doctype html><html lang='uk'><head><meta charset='utf-8'>"
                         "<meta name='viewport' content='width=device-width,initial-scale=1'>"
                         "<title>AlarmMini Wi-Fi Setup</title>"
                         "<style>"
                         "body{margin:0;padding:18px;background:#06101f;color:#eef6ff;font-family:Arial,sans-serif}"
                         "main{max-width:520px;margin:auto;padding:18px;border:1px solid #28476e;border-radius:18px;background:#0d1f38}"
                         "h1{margin:0 0 8px}.hint{color:#9ab4d6;line-height:1.45}.pill{padding:8px 10px;border:1px solid #28476e;border-radius:999px;color:#9ab4d6;display:inline-block}"
                         "label{display:block;margin-top:14px;color:#9ab4d6}input,button{width:100%;min-height:46px;border-radius:12px;font-size:16px;box-sizing:border-box}"
                         "input{margin-top:6px;padding:0 12px;border:1px solid #28476e;background:#07172c;color:#eef6ff}"
                         "button{margin-top:16px;border:0;background:linear-gradient(135deg,#4ea8ff,#ffd447);font-weight:800;color:#06101f}"
                         ".status{margin-top:14px;padding:10px;border:1px solid #28476e;border-radius:12px;white-space:pre-wrap;color:#9ab4d6;font-family:Consolas,monospace;font-size:12px}"
                         ".ok{border-color:#46e68b;color:#a9ffc9}.err{border-color:#ff6b6b;color:#ffc5c5}"
                         "</style></head><body><main><h1>AlarmMini Wi-Fi</h1>"
                         "<p class='hint'>ESP8266 setup mode. Enter Wi-Fi SSID and password, then wait for device IP.</p>"
                         "<p class='pill'>AP: <b>"));
    server.sendContent(_htmlEscape(_provisioningApSsid()));
    server.sendContent(F("</b></p><form id='f'><label>SSID</label><input id='ssid' name='ssid' required value=\""));
    server.sendContent(savedSsid);
    server.sendContent(F("\" autocomplete='off'><label>Password</label><input id='password' name='password' type='password'>"
                         "<button>Save Wi-Fi</button></form><div class='status' id='s'>Ready</div>"
                         "</main>"));
    server.sendContent(FPSTR(PROVISION_SCRIPT));
    server.sendContent(F("</body></html>"));
    server.sendContent(""); // Finish the chunked response so fetch/navigation completes.
    return;
#else

    const String savedSsid = _htmlEscape(String(gConfig.wifiSsid));
    String page;
    page.reserve(9000);
    page += F("<!doctype html><html lang='uk'><head><meta charset='utf-8'>");
    page += F("<meta name='viewport' content='width=device-width,initial-scale=1'>");
    page += F("<title>AlarmMini Wi-Fi Setup</title>");
    page += R"rawliteral(
<style>
:root{color-scheme:dark;--bg:#06101f;--card:#0d1f38;--line:#28476e;--text:#eef6ff;--muted:#9ab4d6;--accent:#ffd447;--blue:#4ea8ff;--ok:#46e68b;--bad:#ff6b6b;--warn:#ffd447}
*{box-sizing:border-box}body{margin:0;min-height:100dvh;padding:18px;background:radial-gradient(circle at top left,#173a62,transparent 34%),linear-gradient(160deg,#06101f,#08192d);font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:var(--text)}
main{width:min(680px,100%);margin:0 auto;padding:22px;border:1px solid var(--line);border-radius:24px;background:linear-gradient(180deg,rgba(13,31,56,.97),rgba(6,16,31,.97));box-shadow:0 24px 90px rgba(0,0,0,.36)}
h1{margin:0 0 6px;font-size:28px}.lead{margin:0 0 18px;color:var(--muted);line-height:1.5}.pill{display:inline-flex;gap:8px;align-items:center;margin:0 0 16px;padding:8px 10px;border:1px solid var(--line);border-radius:999px;color:var(--muted);font-size:13px}
.grid{display:grid;gap:14px}.nets{display:grid;gap:8px;max-height:300px;overflow:auto;padding-right:4px}.net{width:100%;display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:48px;padding:10px 12px;border:1px solid var(--line);border-radius:14px;background:#07172c;color:var(--text);text-align:left}.net:hover,.net.active{border-color:var(--accent);background:#102746}.meta{color:var(--muted);font-size:12px;white-space:nowrap}
label{display:block;margin:14px 0 7px;color:var(--muted);font-size:13px}input{width:100%;min-height:48px;border-radius:14px;border:1px solid var(--line);background:#07172c;color:var(--text);padding:0 14px;font-size:16px}
.row{display:grid;grid-template-columns:1fr 1fr;gap:10px}.btn{width:100%;min-height:48px;border:0;border-radius:14px;background:linear-gradient(135deg,var(--blue),var(--accent));font-weight:800;color:#06101f;font-size:15px}.ghost{background:#07172c;color:var(--text);border:1px solid var(--line)}.status{margin-top:16px;padding:12px;border:1px solid var(--line);border-radius:14px;color:var(--muted);font-family:ui-monospace,Consolas,monospace;font-size:12px;white-space:pre-wrap;overflow:auto}.status.ok{border-color:rgba(70,230,139,.7);background:rgba(70,230,139,.12);color:#a9ffc9}.status.err{border-color:rgba(255,107,107,.75);background:rgba(255,107,107,.12);color:#ffc5c5}.status.busy{border-color:rgba(255,212,71,.65);background:rgba(255,212,71,.1);color:#ffeaa0}.hint{margin:6px 0 0;color:var(--muted);font-size:12px}
@media(max-width:560px){main{padding:18px}.row{grid-template-columns:1fr}}
</style></head><body><main><h1>AlarmMini Wi-Fi</h1><p class='lead'>Вибери домашню Wi-Fi мережу зі списку або введи SSID вручну. Пароль пристрою тут не потрібен.</p><div class='pill'>Точка налаштування: <b>)rawliteral";
    page += _htmlEscape(_provisioningApSsid());
    page += R"rawliteral(</b></div><section class='grid'><div class='row'><button class='btn ghost' id='scan' type='button'>Оновити список Wi-Fi</button><button class='btn ghost' id='manual' type='button'>Ввести SSID вручну</button></div><div class='nets' id='nets'><div class='status'>Сканую мережі...</div></div><form id='f'><label>SSID</label><input id='ssid' name='ssid' value=")rawliteral";
    page += savedSsid;
    page += R"rawliteral(" autocomplete='off' required><label>Пароль Wi-Fi <span style='color:var(--muted)'>(залиш порожнім для відкритої мережі)</span></label><input id='password' name='password' type='password' autocomplete='current-password'><button class='btn'>Підключити плату</button></form><div class='status' id='s'>Очікування...</div></section>
)rawliteral";
    page += FPSTR(PROVISION_SCRIPT);
    page += R"rawliteral(</main></body></html>)rawliteral";

    server.sendHeader("Cache-Control", "no-store");
    server.send(200, "text/html; charset=utf-8", page);
#endif
}
static void _startProvisioningDns()
{
    if (!gProvisioningDnsActive && gProvisioningApActive)
    {
        gProvisioningDns.setErrorReplyCode(DNSReplyCode::NoError);
        gProvisioningDnsActive = gProvisioningDns.start(53, "*", WiFi.softAPIP());
        if (!gProvisioningDnsActive)
            LOG_WARN(LOG_CAT_WIFI, "Setup DNS start failed; will retry");
    }
}

static void _stopProvisioningDns()
{
    gProvisioningDns.stop();
    gProvisioningDnsActive = false;
}

static void _startProvisioningAp()
{
    gProvisioningRequired = true;
    gProvisioningApLastEnsureAt = millis();
    _stopProvisioningDns();
    // Preserve a running STA attempt. Reinitializing the whole radio here can
    // cancel DHCP, change channel repeatedly and drop the phone from the AP.
    const bool modeOk = WiFi.mode(WIFI_AP_STA);
    platformWifiDisableSleep();
    platformWifiConfigureApRadio();
    const IPAddress apIp(192, 168, 4, 1);
    const bool configOk = modeOk && WiFi.softAPConfig(apIp, apIp, IPAddress(255, 255, 255, 0));
    const String apSsid = _provisioningApSsid();
    gProvisioningApActive = configOk && WiFi.softAP(apSsid.c_str(),
        strlen(AP_PASSWORD) ? AP_PASSWORD : nullptr, 1, 0, 4);
    LOG_INFO(LOG_CAT_WIFI, "Setup AP %s SSID='%s' IP=%s",
             gProvisioningApActive ? "started" : "failed", apSsid.c_str(),
             WiFi.softAPIP().toString().c_str());
    _startProvisioningDns();
}

static void _ensureProvisioningApRunning()
{
    if (!gProvisioningRequired || millis() - gProvisioningApLastEnsureAt < 10000UL)
        return;
    gProvisioningApLastEnsureAt = millis();
    const bool modeOk = WiFi.getMode() == WIFI_AP || WiFi.getMode() == WIFI_AP_STA;
    if (!gProvisioningApActive || !modeOk ||
        WiFi.softAPSSID() != _provisioningApSsid() || WiFi.softAPIP() != IPAddress(192, 168, 4, 1))
    {
        LOG_WARN(LOG_CAT_WIFI, "Restarting unavailable setup AP");
        _startProvisioningAp();
    }
    else
        _startProvisioningDns();
}

static void _beginWifiAttempt()
{
    // On ESP32 disconnect is asynchronous. Do not begin/accept a candidate
    // until the old connection has visibly ended (same-SSID password changes).
    gWifiDisconnectPending = true;
    platformWifiDisconnect();
    gWifiRecovery.observe(false, millis());
    gWifiRecovery.start(millis());
    gWifiRecoveryAttempts++;
    LOG_INFO(LOG_CAT_WIFI, "WiFi connection attempt #%lu", (unsigned long)gWifiRecoveryAttempts);
}

static void _finishFailedProvision(const char *error)
{
    gProvisionWifiState = ProvisionWifiState::Failed;
    gProvisionWifiError = error;
    gWifiDisconnectPending = false;
    memset(gProvisionWifiPass, 0, sizeof(gProvisionWifiPass));
    platformWifiDisconnect();
    gWifiRecovery.observe(false, millis());
    gWifiRecovery.finish(millis());
    LOG_WARN(LOG_CAT_WIFI, "Provisioning failed: %s; keeping saved credentials", error);
}

void startupProvisioningHandle()
{
    uint32_t now = millis();
    if (gProvisioningDnsActive)
        gProvisioningDns.processNextRequest();
    _ensureProvisioningApRunning();

    // Release abandoned scan results and recover a scan which never completes.
    if (gProvisionScanStarted && now - gProvisionScanStartedAt >= 15000UL)
    {
#if defined(ESP32)
        esp_wifi_scan_stop();
#endif
        WiFi.scanDelete();
        gProvisionScanStarted = false;
    }
    const bool scanning = gProvisionScanStarted && WiFi.scanComplete() == WIFI_SCAN_RUNNING;
    const bool queued = gProvisionWifiState == ProvisionWifiState::Queued;
    if (!scanning && (gWifiConnectRequested || (queued && now - gProvisionWifiQueuedAt >= 250UL)))
    {
        WiFi.scanDelete();
        gProvisionScanStarted = false;
        if (gWifiConnectRequested)
        {
            gWifiConnectRequested = false;
            if (gConfig.wifiSsid[0])
                _beginWifiAttempt();
            else
            {
                platformWifiDisconnect();
                gWifiDisconnectPending = false;
                gWifiRecovery.observe(false, now);
                gWifiRecovery.finish(now);
                if (!gProvisioningRequired)
                    _startProvisioningAp();
            }
        }
        else
        {
            gProvisionWifiState = ProvisionWifiState::Connecting;
            _beginWifiAttempt();
        }
    }

    if (gWifiDisconnectPending && WiFi.status() != WL_CONNECTED)
    {
        WiFi.mode(gProvisioningRequired ? WIFI_AP_STA : WIFI_STA);
        platformWifiDisableSleep();
        const bool candidate = gProvisionWifiState == ProvisionWifiState::Connecting;
        WiFi.begin(candidate ? gProvisionWifiSsid : gConfig.wifiSsid,
                   candidate ? gProvisionWifiPass : gConfig.wifiPass);
        gWifiDisconnectPending = false;
        gWifiRecovery.start(millis());
    }
    now = millis(); // WiFi.begin/disconnect may yield; don't compare with an older tick.
    const bool ready = _wifiReady();
    if (!gWifiDisconnectPending && gProvisionWifiState == ProvisionWifiState::Connecting && ready &&
        WiFi.SSID() == String(gProvisionWifiSsid))
    {
        char previousSsid[WIFI_SSID_MAXLEN];
        char previousPass[WIFI_PASS_MAXLEN];
        memcpy(previousSsid, gConfig.wifiSsid, sizeof(previousSsid));
        memcpy(previousPass, gConfig.wifiPass, sizeof(previousPass));
        snprintf(gConfig.wifiSsid, sizeof(gConfig.wifiSsid), "%s", gProvisionWifiSsid);
        snprintf(gConfig.wifiPass, sizeof(gConfig.wifiPass), "%s", gProvisionWifiPass);
        if (!storageSaveCurrentConfig())
        {
            memcpy(gConfig.wifiSsid, previousSsid, sizeof(previousSsid));
            memcpy(gConfig.wifiPass, previousPass, sizeof(previousPass));
            _finishFailedProvision("config_save_failed");
            return;
        }
        memset(gProvisionWifiPass, 0, sizeof(gProvisionWifiPass));
        gProvisionWifiState = ProvisionWifiState::Saved;
        gProvisionWifiError = "";
        LOG_INFO(LOG_CAT_WIFI, "Provisioned WiFi connected and saved");
    }
    const bool wasConnected = gWifiRecovery.connected;
    // A new candidate is not accepted until it has connected AND been saved.
    const bool usable = ready && !gWifiDisconnectPending && gProvisionWifiState != ProvisionWifiState::Connecting;
    gWifiRecovery.observe(usable, now);
    if (usable)
    {
        if (!wasConnected)
            LOG_INFO(LOG_CAT_WIFI, "WiFi connected IP=%s", WiFi.localIP().toString().c_str());
        // Keep DNS/AP for a grace period so the phone receives status and the LAN IP.
        if (gProvisioningRequired && !queued && !gWifiConnectRequested && gWifiRecovery.closeApDue(now))
        {
            _stopProvisioningDns();
            WiFi.softAPdisconnect(true);
            WiFi.mode(WIFI_STA);
            gProvisioningApActive = false;
            gProvisioningRequired = false;
            LOG_INFO(LOG_CAT_WIFI, "Setup AP closed after stable WiFi connection");
        }
        return;
    }

    if (gWifiRecovery.timedOut(now))
    {
        if (gWifiDisconnectPending)
        {
            LOG_WARN(LOG_CAT_WIFI, "STA disconnect stuck; restarting WiFi radio");
            _stopProvisioningDns();
            WiFi.mode(WIFI_OFF);
            gProvisioningApActive = false;
            if (gProvisioningRequired)
                _startProvisioningAp();
        }
        if (gProvisionWifiState == ProvisionWifiState::Connecting)
        {
            _finishFailedProvision("connect_timeout_or_bad_password");
            return;
        }
        else
        {
            platformWifiDisconnect();
            gWifiDisconnectPending = false;
            gWifiRecovery.finish(now);
            LOG_WARN(LOG_CAT_WIFI, "WiFi attempt timed out; retry scheduled");
        }
    }
    if (!gProvisioningRequired && (!gConfig.wifiSsid[0] || gWifiRecovery.fallbackDue(now)))
        _startProvisioningAp();
    if (!scanning && !queued && gConfig.wifiSsid[0] && gWifiRecovery.retryDue(now))
        _beginWifiAttempt();
}

static bool _isProvisioningRequest(AlarmWebServer &server)
{
    // The unauthenticated setup endpoints are available only on the setup AP.
    return gProvisioningRequired && gProvisioningApActive &&
           server.client().localIP() == WiFi.softAPIP();
}

bool startupServeProvisioningPage(AlarmWebServer &server)
{
    if (!_isProvisioningRequest(server))
        return false;
    _sendProvisionPage(server);
    return true;
}

static bool _requireProvisioningRequest(AlarmWebServer &server)
{
    if (_isProvisioningRequest(server))
        return true;
    server.send(403, "application/json", "{\"ok\":false,\"error\":\"setup_ap_required\"}");
    return false;
}

void startupProvisioningRegisterRoutes(AlarmWebServer &server)
{
    server.on("/api/provision/status", HTTP_GET, [&server]() {
        if (_requireProvisioningRequest(server)) _sendProvisionStatus(server, true);
    });
    server.on("/api/provision/networks", HTTP_GET, [&server]() {
        if (_requireProvisioningRequest(server)) _sendProvisionNetworks(server);
    });
    server.on("/api/provision/wifi", HTTP_POST, [&server]() {
        if (!_requireProvisioningRequest(server)) return;
        if (gProvisionWifiState == ProvisionWifiState::Queued ||
            gProvisionWifiState == ProvisionWifiState::Connecting)
        {
            server.send(409, "application/json", "{\"ok\":false,\"error\":\"wifi_connecting\"}");
            return;
        }
        String ssid, pass, error;
        StaticJsonDocument<256> doc;
        if (!_readWifiProvisionPayload(server, ssid, pass, error))
        {
            doc["ok"] = false;
            doc["error"] = error;
            _sendProvisionJson(server, doc, 400);
            return;
        }
        snprintf(gProvisionWifiSsid, sizeof(gProvisionWifiSsid), "%s", ssid.c_str());
        snprintf(gProvisionWifiPass, sizeof(gProvisionWifiPass), "%s", pass.c_str());
        gProvisionWifiError = "";
        gProvisionWifiState = ProvisionWifiState::Queued;
        gProvisionWifiQueuedAt = millis();
        gWifiConnectRequested = false;
        doc["ok"] = true;
        doc["event"] = "wifi_connecting";
        doc["saved"] = false;
        doc["connecting"] = true;
        // Send before changing the shared AP/STA channel; poll status for result.
        _sendProvisionJson(server, doc, 202);
    });
}

bool startupShowProvisioningEffect(uint8_t ledCount)
{
    if (!gProvisioningRequired || _wifiReady() || gFetchOk || gCalibrationActive)
        return false;
    const AnimationConfig cfg = animationForState(MAP_STATE_AP_MODE);
    const bool night = isNightMode();
    _showApFlagBlendAnimation(ledCount,
        capColorForAnimation(ukraineBlueColor(cfg.maxBrightness), cfg, night),
        capColorForAnimation(ukraineYellowColor(cfg.maxBrightness), cfg, night), AP_ANIMATION_FRAME_MS);
    return true;
}

// Setup is bounded even if the router starts several minutes after the device.
bool startupWifiWithEffect(uint8_t ledCount)
{
    WiFi.mode(WIFI_STA);
    platformWifiDisableSleep();
    platformWifiConfigureApRadio();
    gWifiRecovery.offlineSince = millis();
    if (!gConfig.wifiSsid[0])
    {
        _startProvisioningAp();
        return false;
    }
    _beginWifiAttempt();
    const AnimationConfig cfg = animationForState(MAP_STATE_STARTUP);
    const bool night = isNightMode();
    const Color primary = capColorForAnimation(ukraineBlueColor(cfg.maxBrightness), cfg, night);
    const Color secondary = capColorForAnimation(ukraineYellowColor(cfg.maxBrightness), cfg, night);
    const uint32_t startedAt = millis();
    while (millis() - startedAt < 15000UL)
    {
        serialProtocolHandle();
        startupProvisioningHandle();
        if (_wifiReady() && !gWifiDisconnectPending)
            return true;
        _showStartupBounceFlagAnimation(ledCount, primary, secondary, STARTUP_ANIMATION_FRAME_MS);
        delay(1);
    }
    _startProvisioningAp();
    return false;
}
