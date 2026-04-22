#pragma once
#include <Arduino.h>
#include <WiFiManager.h>
#include <DNSServer.h>
#include "platform_compat.h"
#include "config.h"
#include "leds.h"
#include "animations.h"
#include "logger.h"

void serialProtocolHandle();

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
        WiFi.begin();
    unsigned long t0 = millis();
    while (millis() - t0 < 15000)
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

    WiFiManager wm;
    wm.setConfigPortalBlocking(false);
    wm.setConfigPortalTimeout(180);
    wm.setBreakAfterConfig(true);
    wm.startConfigPortal(AP_NAME, AP_PASSWORD);
    LOG_INFO(LOG_CAT_WIFI, "AP mode SSID='%s' IP=%s",
             AP_NAME, WiFi.softAPIP().toString().c_str());

    unsigned long apStart = millis();
    unsigned long lastPortalProcessAt = 0;
    while (millis() - apStart < 180000UL)
    {
        serialProtocolHandle();

        const unsigned long now = millis();
        if (now - lastPortalProcessAt >= 15UL)
        {
            wm.process();
            lastPortalProcessAt = now;
        }

        if (WiFi.status() == WL_CONNECTED)
        {
            storageSyncWifiCredentials();
            LOG_INFO(LOG_CAT_WIFI, "Connected via portal. IP: %s", WiFi.localIP().toString().c_str());
            const uint8_t modeCap = modeBrightnessLimit(night);
            _showSolidFor(ledCount, strip.Color(0, min<uint8_t>(startupCfg.maxBrightness, modeCap), 0), 800);
            return true;
        }

        if (!wm.getConfigPortalActive())
            break;

        _showApFlagBlendAnimation(ledCount, apPrimary, apSecondary, AP_ANIMATION_FRAME_MS);
        yield();
    }

    LOG_WARN(LOG_CAT_WIFI, "Portal timeout -> keep AP mode without restart");
    const uint8_t modeCap = modeBrightnessLimit(night);
    _showSolidFor(ledCount, strip.Color(min<uint8_t>(startupCfg.maxBrightness, modeCap), 0, 0), 500);
    strip.clear();
    strip.show();

    WiFi.mode(WIFI_AP_STA);
    WiFi.softAP(AP_NAME, AP_PASSWORD);
    LOG_INFO(LOG_CAT_WIFI, "Fallback AP active SSID='%s' IP=%s",
             AP_NAME, WiFi.softAPIP().toString().c_str());
    return false;
}
