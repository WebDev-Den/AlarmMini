#pragma once
#include <Arduino.h>
#include <ESP8266WiFi.h>
#include <WiFiManager.h>
#include <DNSServer.h>
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
    constexpr float STARTUP_SWEEP_MS = 2200.0f;

    if (ledCount == 0)
    {
        strip.clear();
        strip.show();
        return;
    }

    const float nowMs = (float)millis();
    const float sweepPosition = fmodf(nowMs, STARTUP_SWEEP_MS * 2.0f);
    const bool forward = sweepPosition < STARTUP_SWEEP_MS;
    const float segmentProgress = forward
        ? (sweepPosition / STARTUP_SWEEP_MS)
        : ((sweepPosition - STARTUP_SWEEP_MS) / STARTUP_SWEEP_MS);
    const float easedProgress = 0.5f - 0.5f * cosf(segmentProgress * 3.1415926f);
    const float activeIndex = (ledCount > 1)
        ? easedProgress * (float)(ledCount - 1)
        : 0.0f;

    const float tailLength = 5.2f;

    for (uint8_t i = 0; i < ledCount; i++)
    {
        const float phaseOffset = forward
            ? (activeIndex - i)
            : (i - activeIndex);

        if (phaseOffset < 0.0f || phaseOffset > tailLength)
        {
            strip.setPixelColor(i, 0);
            continue;
        }

        const float normalized = constrain(phaseOffset / tailLength, 0.0f, 1.0f);
        const float wave = 0.5f + 0.5f * cosf(normalized * 3.1415926f);
        const float blend = normalized * normalized * (3.0f - 2.0f * normalized);
        const float brightness = wave * wave;
        Color mixed = {
            (uint8_t)(primary.r + (secondary.r - primary.r) * blend),
            (uint8_t)(primary.g + (secondary.g - primary.g) * blend),
            (uint8_t)(primary.b + (secondary.b - primary.b) * blend),
            (uint8_t)(primary.a)
        };
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
        const float wave = 0.5f + 0.5f * sinf((phase * 0.85f) + offset * 6.2831853f);
        const float brightness = 0.22f + wave * 0.78f;
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
        _showStartupBounceFlagAnimation(ledCount, startupPrimary, startupSecondary, 55);
        yield();
    }

    LOG_WARN(LOG_CAT_WIFI, "Saved network unavailable, switching to AP");
    const unsigned long startupTailStart = millis();
    while (millis() - startupTailStart < 1200)
    {
        serialProtocolHandle();
        _showStartupBounceFlagAnimation(ledCount, startupPrimary, startupSecondary, 55);
        yield();
    }
    strip.clear();
    strip.show();

    WiFi.mode(WIFI_AP_STA);
    WiFi.softAP(AP_NAME, AP_PASSWORD);
    LOG_INFO(LOG_CAT_WIFI, "AP mode SSID='%s' IP=%s",
             AP_NAME, WiFi.softAPIP().toString().c_str());

    DNSServer dns;
    dns.start(53, "*", WiFi.softAPIP());

    WiFiManager wm;
    wm.setConfigPortalTimeout(180);
    wm.setBreakAfterConfig(true);
    wm.startWebPortal();

    unsigned long apStart = millis();
    while (millis() - apStart < 180000UL)
    {
        serialProtocolHandle();
        dns.processNextRequest();
        wm.process();

        if (WiFi.status() == WL_CONNECTED)
        {
            storageSyncWifiCredentials();
            LOG_INFO(LOG_CAT_WIFI, "Connected via portal. IP: %s", WiFi.localIP().toString().c_str());
            dns.stop();
            const uint8_t modeCap = modeBrightnessLimit(night);
            _showSolidFor(ledCount, strip.Color(0, min<uint8_t>(startupCfg.maxBrightness, modeCap), 0), 800);
            return true;
        }

        _showApFlagBlendAnimation(ledCount, apPrimary, apSecondary, 40);
        yield();
    }

    LOG_WARN(LOG_CAT_WIFI, "Portal timeout -> restart");
    dns.stop();
    const uint8_t modeCap = modeBrightnessLimit(night);
    _showSolidFor(ledCount, strip.Color(min<uint8_t>(startupCfg.maxBrightness, modeCap), 0, 0), 500);
    strip.clear();
    strip.show();
    const unsigned long restartPauseStart = millis();
    while (millis() - restartPauseStart < 300)
    {
        serialProtocolHandle();
        yield();
    }
    ESP.restart();
    return false;
}
