#pragma once
#include <Adafruit_NeoPixel.h>
#include <time.h>
#include "config.h"
#include "storage.h"
#include "alerts.h"
#include "logger.h"
#include "animations.h"

Adafruit_NeoPixel strip(MAX_LEDS, LED_PIN, NEO_GRB + NEO_KHZ800);
static constexpr unsigned long LED_FRAME_INTERVAL_MS = 33UL;
static constexpr unsigned long INTERNET_OFFLINE_AUTONOMOUS_DEFAULT_MS = 60000UL;
static unsigned long gLastLedFrameAt = 0;
static unsigned long gInternetOfflineSinceMs = 0;
static bool gInternetOfflineTracked = false;

bool gCalibrationActive = false;
int  gCalibrationIndex = -1;

bool isNightMode() {
    if (!gConfig.night.enabled) return false;

    time_t now = time(nullptr);
    struct tm* tinfo = localtime(&now);
    if (!tinfo) return true;
    if (tinfo->tm_year < 120) return true;

    int currentMins = tinfo->tm_hour * 60 + tinfo->tm_min;
    int startMins   = gConfig.night.startHour * 60 + gConfig.night.startMinute;
    int endMins     = gConfig.night.endHour * 60 + gConfig.night.endMinute;

    if (startMins < endMins)
        return (currentMins >= startMins && currentMins < endMins);
    return (currentMins >= startMins || currentMins < endMins);
}

void ledsInit() {
    strip.begin();
    strip.clear();
    strip.show();
    LOG_INFO(LOG_CAT_SYSTEM, "LEDs initialized");
}

int countAssignedLeds() {
    int count = 0;
    for (int i = 0; i < gConfig.ledCount; i++) {
        if (gConfig.ledRegion[i] >= 0 && gConfig.ledRegion[i] < REGIONS_COUNT) count++;
    }
    return max(count, 1);
}

int assignedIndexForLed(int ledIndex) {
    int slot = 0;
    for (int i = 0; i <= ledIndex && i < gConfig.ledCount; i++) {
        if (gConfig.ledRegion[i] >= 0 && gConfig.ledRegion[i] < REGIONS_COUNT) {
            if (i == ledIndex) return slot;
            slot++;
        }
    }
    return 0;
}

Color currentAlertColor(bool night) {
    return night ? gConfig.nightMode.alertColor : gConfig.dayMode.alertColor;
}

Color currentClearColor(bool night) {
    return night ? gConfig.nightMode.clearColor : gConfig.dayMode.clearColor;
}

Color ukraineBlueColor(uint8_t alpha = 255) {
    return {0, 87, 184, alpha};
}

Color ukraineYellowColor(uint8_t alpha = 255) {
    return {255, 215, 0, alpha};
}

uint8_t modeBrightnessLimit(bool night) {
    return night ? gConfig.night.maxBrightness : 255;
}

Color capColorForMode(Color color, bool night) {
    color.a = min<uint8_t>(color.a, modeBrightnessLimit(night));
    return color;
}

Color capColorForAnimation(Color color, const AnimationConfig& cfg, bool night) {
    color = capColorForMode(color, night);
    color.a = min<uint8_t>(color.a, cfg.maxBrightness);
    return color;
}

void renderCalibrationFrame() {
    strip.clear();
    if (gCalibrationIndex >= 0 && gCalibrationIndex < MAX_LEDS)
        strip.setPixelColor(gCalibrationIndex, strip.Color(255, 255, 255));
    strip.show();
}

bool hasActiveAlerts() {
    for (int i = 0; i < REGIONS_COUNT; i++) {
        if (gAlerts[i]) return true;
    }
    return false;
}

bool hasRecentClearAnimation(unsigned long nowMs) {
    for (int i = 0; i < REGIONS_COUNT; i++) {
        if (!gAlerts[i] && gRegionStateChangedAt[i] > 0 && nowMs - gRegionStateChangedAt[i] < ALERT_CLEAR_HOLD_MS)
            return true;
    }
    return false;
}

void renderGlobalState(const AnimationConfig& cfg, const Color& primary, const Color& secondary) {
    int assignedCount = countAssignedLeds();
    unsigned long now = millis();
    bool night = isNightMode();
    Color safePrimary = capColorForAnimation(primary, cfg, night);
    Color safeSecondary = capColorForAnimation(secondary, cfg, night);

    for (int i = 0; i < gConfig.ledCount; i++) {
        int region = gConfig.ledRegion[i];
        if (region < 0 || region >= REGIONS_COUNT) {
            strip.setPixelColor(i, 0);
            continue;
        }
        int logicalIndex = assignedIndexForLed(i);
        strip.setPixelColor(i, animationColor(cfg, logicalIndex, assignedCount, now, safePrimary, safeSecondary));
    }

    for (int i = gConfig.ledCount; i < MAX_LEDS; i++) strip.setPixelColor(i, 0);
    strip.show();
}

float smoothstep01(float x) {
    x = constrain(x, 0.0f, 1.0f);
    return x * x * (3.0f - 2.0f * x);
}

float fixedTransitionBrightness(unsigned long elapsedMs, bool alertState, bool night, int logicalIndex, int logicalCount) {
    const unsigned long durationMs = 60000UL;
    float progress = min(1.0f, elapsedMs / (float)durationMs);
    float ramp = smoothstep01(progress);

    float idxNorm = (logicalCount > 1) ? (logicalIndex / (float)(logicalCount - 1)) : 0.0f;
    float phase = (elapsedMs / 1000.0f) * (alertState ? 2.4f : 1.5f) * 6.2831853f;
    float breath = 0.5f + 0.5f * sinf(phase);
    float wave = 0.5f + 0.5f * sinf(phase * 0.55f + idxNorm * 3.8f);

    float baseMin = night ? 0.18f : 0.36f;
    float baseMax = night ? (alertState ? 0.74f : 0.58f) : (alertState ? 0.98f : 0.82f);
    float amplitude = alertState ? 0.26f : 0.18f;
    float dynamic = constrain(0.72f * breath + 0.28f * wave, 0.0f, 1.0f);
    float live = baseMin + (baseMax - baseMin) * (1.0f - amplitude + amplitude * dynamic);

    return constrain((0.45f + 0.55f * ramp) * live, 0.0f, 1.0f);
}

uint32_t fixedAlertClearColor(
    const Color& target,
    bool night,
    unsigned long elapsedMs,
    bool alertState,
    int logicalIndex,
    int logicalCount,
    uint8_t extraMaxBrightness = 255) {
    Color active = capColorForMode(target, night);
    active.a = min<uint8_t>(active.a, extraMaxBrightness);
    active.a = (uint8_t)(active.a * fixedTransitionBrightness(elapsedMs, alertState, night, logicalIndex, logicalCount));
    return applyColorBrightness(active, 1.0f);
}

uint32_t scalePackedColor(uint32_t color, float brightness) {
    brightness = constrain(brightness, 0.0f, 1.0f);
    uint8_t r = (color >> 16) & 0xFF;
    uint8_t g = (color >> 8) & 0xFF;
    uint8_t b = color & 0xFF;

    r = (uint8_t)(r * brightness);
    g = (uint8_t)(g * brightness);
    b = (uint8_t)(b * brightness);

    return ((uint32_t)r << 16) | ((uint32_t)g << 8) | (uint32_t)b;
}

float internetOfflinePulse(unsigned long nowMs, bool night) {
    const float minBrightness = night ? 0.08f : 0.40f;
    const float maxBrightness = night ? 0.22f : 0.68f;
    const float t = nowMs / 1000.0f;
    const float wave = 0.5f + 0.5f * sinf((2.0f * PI * t) / 3.2f);
    return minBrightness + wave * (maxBrightness - minBrightness);
}

float mqttOfflinePulse(unsigned long nowMs, bool night) {
    const float minBrightness = night ? 0.10f : 0.42f;
    const float maxBrightness = night ? 0.28f : 0.74f;
    const float phase = fmodf(nowMs / 1000.0f, 2.4f);

    auto pulseAt = [](float x, float center, float halfWidth) -> float {
        float distance = fabsf(x - center);
        if (distance >= halfWidth) return 0.0f;
        return 1.0f - (distance / halfWidth);
    };

    float pulse = max(pulseAt(phase, 0.20f, 0.16f), pulseAt(phase, 0.55f, 0.16f));
    pulse = pulse * pulse;
    return minBrightness + pulse * (maxBrightness - minBrightness);
}

uint32_t retainedStateColorForLed(int ledIndex, bool night, unsigned long now, const AnimationConfig& offlineCfg, int logicalCount) {
    int region = gConfig.ledRegion[ledIndex];
    if (region < 0 || region >= REGIONS_COUNT) {
        return 0;
    }
    int logicalIndex = assignedIndexForLed(ledIndex);

    const Color alertColor = currentAlertColor(night);
    const Color clearColor = currentClearColor(night);

    bool alertState = gAlerts[region];
    bool recentClear = !alertState &&
        gRegionStateChangedAt[region] > 0 &&
        now - gRegionStateChangedAt[region] < ALERT_CLEAR_HOLD_MS;

    if (alertState) {
        unsigned long elapsed = gRegionStateChangedAt[region] > 0 ? now - gRegionStateChangedAt[region] : 0;
        return fixedAlertClearColor(alertColor, night, elapsed, true, logicalIndex, logicalCount, offlineCfg.maxBrightness);
    }

    if (recentClear) {
        unsigned long elapsed = gRegionStateChangedAt[region] > 0 ? now - gRegionStateChangedAt[region] : 0;
        return fixedAlertClearColor(clearColor, night, elapsed, false, logicalIndex, logicalCount, offlineCfg.maxBrightness);
    }

    Color baseClear = capColorForMode(clearColor, night);
    baseClear.a = min<uint8_t>(baseClear.a, offlineCfg.maxBrightness);
    return applyColorBrightness(baseClear, 1.0f);
}

void renderRetainedState(bool night, bool mqttLost) {
    const unsigned long now = millis();
    const AnimationConfig offlineCfg = animationForState(
        mqttLost ? MAP_STATE_MQTT_LOST : MAP_STATE_INTERNET_LOST
    );
    const int logicalCount = countAssignedLeds();

    for (int i = 0; i < gConfig.ledCount; i++) {
        uint32_t baseColor = retainedStateColorForLed(i, night, now, offlineCfg, logicalCount);
        strip.setPixelColor(i, baseColor);
    }

    for (int i = gConfig.ledCount; i < MAX_LEDS; i++) {
        strip.setPixelColor(i, 0);
    }

    strip.show();
}

void renderRetainedStateWithPulse(bool night, bool mqttLost) {
    const unsigned long now = millis();
    const AnimationConfig offlineCfg = animationForState(
        mqttLost ? MAP_STATE_MQTT_LOST : MAP_STATE_INTERNET_LOST
    );
    const float pulseBrightness = mqttLost ? mqttOfflinePulse(now, night) : internetOfflinePulse(now, night);
    const int logicalCount = countAssignedLeds();

    for (int i = 0; i < gConfig.ledCount; i++) {
        uint32_t baseColor = retainedStateColorForLed(i, night, now, offlineCfg, logicalCount);
        strip.setPixelColor(i, scalePackedColor(baseColor, pulseBrightness));
    }

    for (int i = gConfig.ledCount; i < MAX_LEDS; i++) {
        strip.setPixelColor(i, 0);
    }

    strip.show();
}

void renderAlertClearState(bool night) {
    const Color alertColor = currentAlertColor(night);
    const Color clearColor = currentClearColor(night);
    unsigned long now = millis();
    int logicalCount = countAssignedLeds();

    for (int i = 0; i < gConfig.ledCount; i++) {
        int region = gConfig.ledRegion[i];
        if (region < 0 || region >= REGIONS_COUNT) {
            strip.setPixelColor(i, 0);
            continue;
        }

        bool alertState = gAlerts[region];
        bool recentClear = !alertState &&
            gRegionStateChangedAt[region] > 0 &&
            now - gRegionStateChangedAt[region] < ALERT_CLEAR_HOLD_MS;

        uint32_t color = 0;
        if (alertState) {
            unsigned long elapsed = gRegionStateChangedAt[region] > 0 ? now - gRegionStateChangedAt[region] : 0;
            color = fixedAlertClearColor(alertColor, night, elapsed, true, assignedIndexForLed(i), logicalCount);
        } else if (recentClear) {
            unsigned long elapsed = gRegionStateChangedAt[region] > 0 ? now - gRegionStateChangedAt[region] : 0;
            color = fixedAlertClearColor(clearColor, night, elapsed, false, assignedIndexForLed(i), logicalCount);
        } else {
            int logicalIndex = assignedIndexForLed(i);
            color = animationColor(
                animationForState(MAP_STATE_IDLE),
                logicalIndex,
                logicalCount,
                now,
                capColorForAnimation(clearColor, animationForState(MAP_STATE_IDLE), night),
                capColorForAnimation(alertColor, animationForState(MAP_STATE_IDLE), night));
        }

        strip.setPixelColor(i, color);
    }

    for (int i = gConfig.ledCount; i < MAX_LEDS; i++) strip.setPixelColor(i, 0);
    strip.show();
}

void ledsHandle() {
    if (gCalibrationActive) {
        renderCalibrationFrame();
        return;
    }

    const unsigned long now = millis();
    if (now - gLastLedFrameAt < LED_FRAME_INTERVAL_MS) {
        return;
    }
    gLastLedFrameAt = now;

    bool night = isNightMode();
    bool internetLost = (!gInternetConnected || WiFi.status() != WL_CONNECTED);
    if (internetLost) {
        if (!gInternetOfflineTracked) {
            gInternetOfflineTracked = true;
            gInternetOfflineSinceMs = now;
            LOG_WARN(LOG_CAT_INTERNET, "Internet offline: autonomous retain mode started");
        }
    } else {
        gInternetOfflineTracked = false;
    }
    bool activeAlerts = hasActiveAlerts();
    bool recentClear = hasRecentClearAnimation(now);

    if (activeAlerts || recentClear) {
        renderAlertClearState(night);
        return;
    }

    if (internetLost) {
        const unsigned long offlineElapsed = now - gInternetOfflineSinceMs;
        const unsigned long autonomousWindowMs = gConfig.offline.autonomousSeconds > 0
            ? (unsigned long)gConfig.offline.autonomousSeconds * 1000UL
            : INTERNET_OFFLINE_AUTONOMOUS_DEFAULT_MS;
        if (offlineElapsed < autonomousWindowMs) {
            renderRetainedState(night, false);
        } else {
            renderRetainedStateWithPulse(night, false);
        }
        return;
    }

    if (strlen(gConfig.mqttHost) && !gMqttConnected) {
        renderRetainedStateWithPulse(night, true);
        return;
    }

    renderGlobalState(animationForState(MAP_STATE_IDLE), ukraineBlueColor(), ukraineYellowColor());
}
