#pragma once
#include <Arduino.h>
#include <ESP8266WiFi.h>
#include <WiFiManager.h>
#include <DNSServer.h>
#include "config.h"
#include "leds.h"
#include "animations.h"
#include "logger.h"

static void _showStartupBounceFlagAnimation(uint8_t ledCount,
                                            const Color& primary,
                                            const Color& secondary,
                                            unsigned long frameIntervalMs)
{
    constexpr float STARTUP_SWEEP_MS = 1000.0f;
    static float activeIndex = 0.0f;
    static int8_t direction = 1;
    static unsigned long lastStepMs = 0;

    if (ledCount == 0)
    {
        strip.clear();
        strip.show();
        return;
    }

    const unsigned long now = millis();
    if (lastStepMs == 0 || now - lastStepMs >= frameIntervalMs)
    {
        const float step = (ledCount > 1)
            ? ((ledCount - 1) * frameIntervalMs) / STARTUP_SWEEP_MS
            : 0.0f;
        lastStepMs = now;
        if (ledCount > 1)
        {
            activeIndex += step * direction;
            if (activeIndex >= (ledCount - 1))
            {
                activeIndex = (float)(ledCount - 1);
                direction = -1;
            }
            else if (activeIndex <= 0.0f)
            {
                activeIndex = 0.0f;
                direction = 1;
            }
        }
        else
        {
            activeIndex = 0.0f;
        }
    }

    const float tailLength = 2.4f;

    for (uint8_t i = 0; i < ledCount; i++)
    {
        const float phaseOffset = (direction > 0)
            ? (activeIndex - i)
            : (i - activeIndex);

        if (phaseOffset < 0.0f || phaseOffset > tailLength)
        {
            strip.setPixelColor(i, 0);
            continue;
        }

        uint32_t color = 0;
        if (phaseOffset <= 1.0f)
        {
            const float t = phaseOffset;
            const float fade = 1.0f - 0.15f * t;
            const float brightness = fade * fade;
            Color mixed = {
                (uint8_t)(primary.r + (secondary.r - primary.r) * t),
                (uint8_t)(primary.g + (secondary.g - primary.g) * t),
                (uint8_t)(primary.b + (secondary.b - primary.b) * t),
                (uint8_t)(primary.a)
            };
            color = applyColorBrightness(mixed, brightness);
        }
        else
        {
            const float t = (phaseOffset - 1.0f) / (tailLength - 1.0f);
            const float fade = 1.0f - constrain(t, 0.0f, 1.0f);
            const float brightness = fade * fade * fade;
            color = applyColorBrightness(secondary, brightness);
        }

        strip.setPixelColor(i, color);
    }

    for (uint8_t i = ledCount; i < MAX_LEDS; i++)
        strip.setPixelColor(i, 0);

    strip.show();
}

static void _showStartupAnimation(const AnimationConfig& cfg, uint8_t ledCount, const Color& primary, const Color& secondary)
{
    unsigned long now = millis();
    for (uint8_t i = 0; i < ledCount; i++)
        strip.setPixelColor(i, animationColor(cfg, i, ledCount, now, primary, secondary));
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
        yield();
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
    WiFi.begin();
    unsigned long t0 = millis();
    unsigned long lastStartupFrame = 0;
    while (millis() - t0 < 15000)
    {
        if (WiFi.status() == WL_CONNECTED)
        {
            LOG_INFO(LOG_CAT_WIFI, "OK IP: %s", WiFi.localIP().toString().c_str());
            return true;
        }
        unsigned long now = millis();
        if (lastStartupFrame == 0 || now - lastStartupFrame >= 24)
        {
            _showStartupBounceFlagAnimation(ledCount, startupPrimary, startupSecondary, 55);
            lastStartupFrame = now;
        }
        yield();
    }

    LOG_WARN(LOG_CAT_WIFI, "Saved network unavailable, switching to AP");
    const unsigned long startupTailStart = millis();
    while (millis() - startupTailStart < 1200)
    {
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
    unsigned long lastApFrame = 0;
    while (millis() - apStart < 180000UL)
    {
        dns.processNextRequest();
        wm.process();

        if (WiFi.status() == WL_CONNECTED)
        {
            LOG_INFO(LOG_CAT_WIFI, "Connected via portal. IP: %s", WiFi.localIP().toString().c_str());
            dns.stop();
            const uint8_t modeCap = modeBrightnessLimit(night);
            _showSolidFor(ledCount, strip.Color(0, min<uint8_t>(startupCfg.maxBrightness, modeCap), 0), 800);
            return true;
        }

        unsigned long now = millis();
        if (lastApFrame == 0 || now - lastApFrame >= 20)
        {
            _showStartupAnimation(apCfg, ledCount, apPrimary, apSecondary);
            lastApFrame = now;
        }
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
        yield();
    ESP.restart();
    return false;
}
