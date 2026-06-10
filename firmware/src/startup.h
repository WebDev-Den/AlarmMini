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

void serialProtocolHandle();

static DNSServer gProvisioningDns;
static bool gProvisioningDnsActive = false;
static unsigned long gProvisioningApLastEnsureAt = 0;

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
        strip.show();
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

    strip.show();
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
        strip.show();
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

    strip.show();
}

static void _showSolidFor(uint8_t ledCount, uint32_t color, unsigned long durationMs)
{
    for (uint8_t i = 0; i < ledCount; i++)
        strip.setPixelColor(i, color);
    for (uint8_t i = ledCount; i < MAX_LEDS; i++)
        strip.setPixelColor(i, 0);
    strip.show();

    const unsigned long startMs = millis();
    while (millis() - startMs < durationMs)
    {
        serialProtocolHandle();
        yield();
    }
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

    ssid.trim();
    if (ssid.length() == 0)
    {
        error = F("ssid_required");
        return false;
    }
    if (ssid.length() >= WIFI_SSID_MAXLEN)
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
    StaticJsonDocument<384> doc;
    doc["ok"] = true;
    doc["portal"] = portalActive;
    doc["wifiConnected"] = (WiFi.status() == WL_CONNECTED);
    doc["ssid"] = WiFi.SSID();
    doc["ip"] = WiFi.localIP().toString();
    doc["apSsid"] = _provisioningApSsid();
    doc["apIp"] = WiFi.softAPIP().toString();
    _sendProvisionJson(server, doc);
}

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

static void _sendProvisionNetworks(AlarmWebServer& server)
{
    DynamicJsonDocument doc(4096);
    doc["ok"] = true;
    JsonArray networks = doc.createNestedArray("networks");

    LOG_INFO(LOG_CAT_WIFI, "Provisioning WiFi scan started");
    const int found = WiFi.scanNetworks(false, true);
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
    _sendProvisionJson(server, doc);
}

static void _sendProvisionPage(AlarmWebServer& server)
{
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
<script>
const s=document.getElementById('s'),nets=document.getElementById('nets'),ssid=document.getElementById('ssid'),pass=document.getElementById('password');
function esc(v){return String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
function sig(r){return r>-55?'відмінний':r>-67?'добрий':r>-75?'середній':'слабкий'}
function setStatus(kind,msg){s.className='status '+(kind||'');s.textContent=msg}
function box(kind,msg){return '<div class="status '+kind+'">'+esc(msg)+'</div>'}
async function scan(){nets.innerHTML=box('busy','Сканую Wi-Fi мережі...');setStatus('busy','Оновлюю список доступних мереж...');try{const r=await fetch('/api/provision/networks',{cache:'no-store'});const j=await r.json();if(!r.ok||j.ok===false)throw new Error(j.error||('HTTP '+r.status));if(!j.networks||!j.networks.length){nets.innerHTML=box('err','Мережі не знайдено. Натисни оновити або введи SSID вручну.');setStatus('err','Не знайшов Wi-Fi мережі поруч. Перевір роутер або введи SSID вручну.');return}nets.innerHTML=j.networks.map(n=>`<button class="net" type="button" data-ssid="${esc(n.ssid)}"><span><b>${esc(n.ssid)}</b><br><span class="meta">${esc(n.auth)} · ${sig(n.rssi)} · ch ${n.channel}</span></span><span class="meta">${n.rssi} dBm</span></button>`).join('');nets.querySelectorAll('.net').forEach(b=>b.onclick=()=>{nets.querySelectorAll('.net').forEach(x=>x.classList.remove('active'));b.classList.add('active');ssid.value=b.dataset.ssid;pass.focus();setStatus('busy','Вибрано мережу: '+b.dataset.ssid+'\\nВведи пароль або залиш поле порожнім, якщо мережа відкрита.')});setStatus('ok','Список Wi-Fi оновлено. Знайдено мереж: '+j.networks.length)}catch(e){nets.innerHTML=box('err','Помилка сканування: '+e.message);setStatus('err','Помилка сканування Wi-Fi: '+e.message)}}
async function st(){try{const r=await fetch('/api/provision/status',{cache:'no-store'});const j=await r.json();let text='AP: '+(j.apSsid||'')+'\nIP налаштування: '+(j.apIp||'192.168.4.1');if(j.wifiConnected&&j.ip&&j.ip!='0.0.0.0'){text+='\n\nПідключено. Відкрий: http://'+j.ip+'/';setStatus('ok',text)}else if(!s.classList.contains('ok')&&!s.classList.contains('err')){setStatus('busy',text+'\n\nОчікую вибір Wi-Fi мережі.')}}catch(e){setStatus('err','Помилка читання статусу: '+e.message)}}
setInterval(st,1500);document.getElementById('scan').onclick=scan;document.getElementById('manual').onclick=()=>{ssid.focus();setStatus('busy','Введи SSID вручну, пароль можна залишити порожнім для відкритої мережі.')};document.getElementById('f').onsubmit=async e=>{e.preventDefault();const body={ssid:ssid.value.trim(),password:pass.value};if(!body.ssid){setStatus('err','Вибери мережу зі списку або введи SSID вручну.');return}setStatus('busy','Зберігаю Wi-Fi \"'+body.ssid+'\" і підключаю плату...');try{const r=await fetch('/api/provision/wifi',{method:'POST',body:JSON.stringify(body),headers:{'content-type':'application/json'}});const text=await r.text();let j=null;try{j=JSON.parse(text)}catch(_){ }if(!r.ok||!j||j.ok===false)throw new Error((j&&j.error)||text||('HTTP '+r.status));setStatus('ok','Wi-Fi збережено. Плата підключається до \"'+body.ssid+'\"...\\nЯкщо підключення успішне, нижче зʼявиться IP адреса основного інтерфейсу.');setTimeout(st,1200)}catch(e){setStatus('err','Не вдалося зберегти або застосувати Wi-Fi: '+e.message)}};st();scan();
</script></main></body></html>)rawliteral";

    server.sendHeader("Cache-Control", "no-store");
    server.send(200, "text/html; charset=utf-8", page);
}
static void _redirectProvisionHome(AlarmWebServer& server)
{
    server.sendHeader("Cache-Control", "no-store");
    server.sendHeader("Location", String("http://") + WiFi.softAPIP().toString() + "/");
    server.send(302, "text/plain", "");
}

static void _sendCaptiveProbePage(AlarmWebServer& server)
{
    // Captive portal probes must not look like a successful internet check.
    _sendProvisionPage(server);
}

static void _startProvisioningDns()
{
    if (!gProvisioningDnsActive)
    {
        gProvisioningDns.start(53, "*", WiFi.softAPIP());
        gProvisioningDnsActive = true;
    }
}

static void _stopProvisioningDns()
{
    if (gProvisioningDnsActive)
    {
        gProvisioningDns.stop();
        gProvisioningDnsActive = false;
    }
}

void startupProvisioningHandle()
{
    if (!gProvisioningDnsActive)
        return;

    if (WiFi.status() == WL_CONNECTED)
    {
        _stopProvisioningDns();
        return;
    }

    gProvisioningDns.processNextRequest();
}

static void _startProvisioningAp()
{
    WiFi.softAPdisconnect(true);
    platformWifiDisconnect();
    platformWifiDisableSleep();
    platformWifiSetMaxTxPower();
    delay(120);

    // AP+STA keeps the setup network visible while allowing Wi-Fi scans.
    WiFi.mode(WIFI_AP_STA);
    delay(120);

    platformWifiConfigureApRadio();

    IPAddress apIp(192, 168, 4, 1);
    IPAddress apGateway(192, 168, 4, 1);
    IPAddress apSubnet(255, 255, 255, 0);
    WiFi.softAPConfig(apIp, apGateway, apSubnet);

    // Channel 1 + HT20 is the most compatible setup for phones/Windows scans.
    const uint8_t apChannel = 1;
    const uint8_t maxClients = 4;
    const String apSsid = _provisioningApSsid();
    bool ok = false;
    if (strlen(AP_PASSWORD) == 0)
        ok = WiFi.softAP(apSsid.c_str(), nullptr, apChannel, 0, maxClients);
    else
        ok = WiFi.softAP(apSsid.c_str(), AP_PASSWORD, apChannel, 0, maxClients);

    LOG_INFO(LOG_CAT_WIFI, "Setup AP %s SSID='%s' IP=%s MAC=%s channel=%u open=%s",
             ok ? "started" : "failed",
             apSsid.c_str(),
             WiFi.softAPIP().toString().c_str(),
             WiFi.softAPmacAddress().c_str(),
             apChannel,
             strlen(AP_PASSWORD) == 0 ? "yes" : "no");
    _startProvisioningDns();
    gProvisioningApLastEnsureAt = millis();
}

static void _ensureProvisioningApRunning()
{
    const unsigned long now = millis();
    if (now - gProvisioningApLastEnsureAt < 10000UL)
        return;
    gProvisioningApLastEnsureAt = now;

    const String expectedSsid = _provisioningApSsid();
    const IPAddress expectedIp(192, 168, 4, 1);
    const bool ssidOk = WiFi.softAPSSID() == expectedSsid;
    const bool ipOk = WiFi.softAPIP() == expectedIp;
    const bool modeOk = (WiFi.getMode() == WIFI_AP || WiFi.getMode() == WIFI_AP_STA);

    if (ssidOk && ipOk && modeOk)
        return;

    LOG_WARN(LOG_CAT_WIFI, "Provisioning AP watchdog restart: ssidOk=%d ipOk=%d mode=%d",
             ssidOk ? 1 : 0,
             ipOk ? 1 : 0,
             (int)WiFi.getMode());
    _startProvisioningAp();
}

static void _stopProvisioningServices(AlarmWebServer& portalServer, bool stopDns)
{
    portalServer.close();
    if (stopDns)
        _stopProvisioningDns();
}

// ===== MAIN WIFI + EFFECT =====
bool startupWifiWithEffect(uint8_t ledCount)
{
    LOG_INFO(LOG_CAT_WIFI, "WiFi connecting...");

    const bool night = isNightMode();
    const AnimationConfig startupCfg = animationForState(MAP_STATE_STARTUP);
    const AnimationConfig apCfg = animationForState(MAP_STATE_AP_MODE);
    const Color startupPrimary = capColorForAnimation(ukraineBlueColor(startupCfg.maxBrightness), startupCfg, night);
    const Color startupSecondary = capColorForAnimation(ukraineYellowColor(startupCfg.maxBrightness), startupCfg, night);
    const Color apPrimary = capColorForAnimation(ukraineBlueColor(apCfg.maxBrightness), apCfg, night);
    const Color apSecondary = capColorForAnimation(ukraineYellowColor(apCfg.maxBrightness), apCfg, night);

    WiFi.mode(WIFI_STA);
    if (strlen(gConfig.wifiSsid))
        WiFi.begin(gConfig.wifiSsid, gConfig.wifiPass);
    else
        LOG_WARN(LOG_CAT_WIFI, "No saved WiFi credentials, provisioning portal will start");

    unsigned long t0 = millis();
    while (strlen(gConfig.wifiSsid) && millis() - t0 < 15000)
    {
        serialProtocolHandle();
        if (WiFi.status() == WL_CONNECTED)
        {
            storageSyncWifiCredentials();
            LOG_INFO(LOG_CAT_WIFI, "OK IP: %s", WiFi.localIP().toString().c_str());
            return true;
        }
        _showStartupBounceFlagAnimation(ledCount, startupPrimary, startupSecondary, STARTUP_ANIMATION_FRAME_MS);
        yield();
    }

    LOG_WARN(LOG_CAT_WIFI, "Saved network unavailable, switching to AP");
    const unsigned long startupTailStart = millis();
    while (millis() - startupTailStart < STARTUP_ANIMATION_TAIL_EXTRA_MS)
    {
        serialProtocolHandle();
        _showStartupBounceFlagAnimation(ledCount, startupPrimary, startupSecondary, STARTUP_ANIMATION_FRAME_MS);
        yield();
    }
    strip.clear();
    strip.show();

    _startProvisioningAp();
    AlarmWebServer portalServer(80);

    portalServer.on("/", HTTP_GET, [&portalServer]() { _sendProvisionPage(portalServer); });
    portalServer.on("/index.html", HTTP_GET, [&portalServer]() { _sendProvisionPage(portalServer); });
    portalServer.on("/generate_204", HTTP_GET, [&portalServer]() { _redirectProvisionHome(portalServer); });
    portalServer.on("/gen_204", HTTP_GET, [&portalServer]() { _redirectProvisionHome(portalServer); });
    portalServer.on("/mobile/status.php", HTTP_GET, [&portalServer]() { _redirectProvisionHome(portalServer); });
    portalServer.on("/hotspot-detect.html", HTTP_GET, [&portalServer]() { _sendCaptiveProbePage(portalServer); });
    portalServer.on("/library/test/success.html", HTTP_GET, [&portalServer]() { _sendCaptiveProbePage(portalServer); });
    portalServer.on("/connecttest.txt", HTTP_GET, [&portalServer]() { _redirectProvisionHome(portalServer); });
    portalServer.on("/redirect", HTTP_GET, [&portalServer]() { _sendProvisionPage(portalServer); });
    portalServer.on("/ncsi.txt", HTTP_GET, [&portalServer]() { _redirectProvisionHome(portalServer); });
    portalServer.on("/canonical.html", HTTP_GET, [&portalServer]() { _sendCaptiveProbePage(portalServer); });
    portalServer.on("/api/provision/status", HTTP_GET, [&portalServer]() { _sendProvisionStatus(portalServer, true); });
    portalServer.on("/api/provision/networks", HTTP_GET, [&portalServer]() { _sendProvisionNetworks(portalServer); });
    portalServer.on("/api/provision/wifi", HTTP_OPTIONS, [&portalServer]()
                    {
                        portalServer.sendHeader("Access-Control-Allow-Origin", "*");
                        portalServer.sendHeader("Access-Control-Allow-Headers", "content-type");
                        portalServer.send(204, "text/plain", "");
                    });
    portalServer.on("/api/provision/wifi", HTTP_POST, [&portalServer]()
                    {
                        String ssid;
                        String pass;
                        String error;
                        StaticJsonDocument<384> doc;
                        if (!_readWifiProvisionPayload(portalServer, ssid, pass, error))
                        {
                            doc["ok"] = false;
                            doc["error"] = error;
                            _sendProvisionJson(portalServer, doc, 400);
                            return;
                        }

                        char prevSsid[WIFI_SSID_MAXLEN];
                        char prevPass[WIFI_PASS_MAXLEN];
                        snprintf(prevSsid, sizeof(prevSsid), "%s", gConfig.wifiSsid);
                        snprintf(prevPass, sizeof(prevPass), "%s", gConfig.wifiPass);

                        resetTraceSetStage("provision_wifi_test");
                        LOG_INFO(LOG_CAT_WIFI, "Provisioning test connect to SSID='%s'", ssid.c_str());
                        WiFi.mode(WIFI_AP_STA);
                        WiFi.begin(ssid.c_str(), pass.c_str());

                        const unsigned long connectStart = millis();
                        while (WiFi.status() != WL_CONNECTED && millis() - connectStart < 15000UL)
                        {
                            serialProtocolHandle();
                            startupProvisioningHandle();
                            delay(50);
                            yield();
                        }

                        const bool connected = WiFi.status() == WL_CONNECTED;
                        bool saved = false;
                        if (connected)
                        {
                            snprintf(gConfig.wifiSsid, WIFI_SSID_MAXLEN, "%s", ssid.c_str());
                            snprintf(gConfig.wifiPass, WIFI_PASS_MAXLEN, "%s", pass.c_str());
                            saved = storageSaveCurrentConfig(true);
                        }
                        else
                        {
                            platformWifiDisconnect();
                            snprintf(gConfig.wifiSsid, WIFI_SSID_MAXLEN, "%s", prevSsid);
                            snprintf(gConfig.wifiPass, WIFI_PASS_MAXLEN, "%s", prevPass);
                            WiFi.mode(WIFI_AP_STA);
                        }

                        doc["ok"] = connected && saved;
                        doc["event"] = "wifi_saved";
                        doc["ssid"] = ssid;
                        doc["connected"] = connected;
                        doc["saved"] = saved;
                        doc["ip"] = connected ? WiFi.localIP().toString() : "";
                        doc["message"] = connected
                                             ? (saved ? "connected_and_saved" : "connected_but_save_failed")
                                             : "connect_timeout_or_bad_password";
                        _sendProvisionJson(portalServer, doc, (connected && saved) ? 200 : 422);
                    });
    portalServer.onNotFound([&portalServer]()
                            {
                                _redirectProvisionHome(portalServer);
                            });
    portalServer.begin();

    LOG_INFO(LOG_CAT_WIFI, "AP mode SSID='%s' IP=%s",
             _provisioningApSsid().c_str(), WiFi.softAPIP().toString().c_str());

    // WiFiManager-style provisioning: keep the setup portal alive until Wi-Fi connects.
    while (true)
    {
        serialProtocolHandle();
        startupProvisioningHandle();
        portalServer.handleClient();
        _ensureProvisioningApRunning();

        if (WiFi.status() == WL_CONNECTED)
        {
            storageSyncWifiCredentials();
            LOG_INFO(LOG_CAT_WIFI, "Connected via portal. IP: %s", WiFi.localIP().toString().c_str());
            const uint8_t modeCap = modeBrightnessLimit(night);
            _showSolidFor(ledCount, strip.Color(0, min<uint8_t>(startupCfg.maxBrightness, modeCap), 0), 800);
            _stopProvisioningServices(portalServer, true);
            WiFi.mode(WIFI_STA);
            return true;
        }

        _showApFlagBlendAnimation(ledCount, apPrimary, apSecondary, AP_ANIMATION_FRAME_MS);
        yield();
    }

    return false;
}
