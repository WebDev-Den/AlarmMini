#pragma once
#include <Adafruit_NeoPixel.h>
#include <time.h>
#include "config.h"
#include "storage.h"
#include "alerts.h"
#include "logger.h"
#include "animations.h"

Adafruit_NeoPixel strip(MAX_LEDS, LED_PIN, NEO_GRB + NEO_KHZ800);

bool gCalibrationActive = false;
int  gCalibrationIndex = -1;

bool isNightMode() {
    if (!gConfig.night.enabled) return false;

    time_t now = time(nullptr);
    struct tm* tinfo = localtime(&now);
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

float fixedTransitionBrightness(unsigned long elapsedMs) {
    const unsigned long durationMs = 60000UL;
    if (elapsedMs >= durationMs) return 1.0f;

    float progress = elapsedMs / (float)durationMs;
    float minLevel = 0.5f + progress * 0.5f;
    float speed = 1.0f + (1.0f - progress) * 3.0f;
    float pulse = 0.5f + 0.5f * sinf((elapsedMs / 1000.0f) * speed * 6.2831853f);
    return minLevel + pulse * (1.0f - minLevel);
}

uint32_t fixedAlertClearColor(const Color& target, bool night, unsigned long elapsedMs) {
    Color active = capColorForMode(target, night);
    active.a = (uint8_t)(active.a * fixedTransitionBrightness(elapsedMs));
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

float internetOfflinePulse(unsigned long nowMs) {
    constexpr float minBrightness = 0.15f;
    const float t = nowMs / 1000.0f;
    const float wave = 0.5f + 0.5f * sinf((2.0f * PI * t) / 2.8f);
    return minBrightness + wave * (1.0f - minBrightness);
}

float mqttOfflinePulse(unsigned long nowMs) {
    constexpr float minBrightness = 0.15f;
    const float phase = fmodf(nowMs / 1000.0f, 1.8f);

    auto pulseAt = [](float x, float center, float halfWidth) -> float {
        float distance = fabsf(x - center);
        if (distance >= halfWidth) return 0.0f;
        return 1.0f - (distance / halfWidth);
    };

    float pulse = max(pulseAt(phase, 0.20f, 0.16f), pulseAt(phase, 0.55f, 0.16f));
    pulse = pulse * pulse;
    return minBrightness + pulse * (1.0f - minBrightness);
}

uint32_t retainedStateColorForLed(int ledIndex, bool night, unsigned long now) {
    int region = gConfig.ledRegion[ledIndex];
    if (region < 0 || region >= REGIONS_COUNT) {
        return 0;
    }

    const Color alertColor = currentAlertColor(night);
    const Color clearColor = currentClearColor(night);

    bool alertState = gAlerts[region];
    bool recentClear = !alertState &&
        gRegionStateChangedAt[region] > 0 &&
        now - gRegionStateChangedAt[region] < ALERT_CLEAR_HOLD_MS;

    if (alertState) {
        unsigned long elapsed = gRegionStateChangedAt[region] > 0 ? now - gRegionStateChangedAt[region] : 0;
        return fixedAlertClearColor(alertColor, night, elapsed);
    }

    if (recentClear) {
        unsigned long elapsed = gRegionStateChangedAt[region] > 0 ? now - gRegionStateChangedAt[region] : 0;
        return fixedAlertClearColor(clearColor, night, elapsed);
    }

    return applyColorBrightness(capColorForMode(clearColor, night), 1.0f);
}

void renderRetainedStateWithPulse(bool night, bool mqttLost) {
    const unsigned long now = millis();
    const float pulseBrightness = mqttLost ? mqttOfflinePulse(now) : internetOfflinePulse(now);

    for (int i = 0; i < gConfig.ledCount; i++) {
        uint32_t baseColor = retainedStateColorForLed(i, night, now);
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
            color = fixedAlertClearColor(alertColor, night, elapsed);
        } else if (recentClear) {
            unsigned long elapsed = gRegionStateChangedAt[region] > 0 ? now - gRegionStateChangedAt[region] : 0;
            color = fixedAlertClearColor(clearColor, night, elapsed);
        } else {
            int logicalIndex = assignedIndexForLed(i);
            color = animationColor(
                animationForState(MAP_STATE_IDLE),
                logicalIndex,
                countAssignedLeds(),
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

    bool night = isNightMode();
    bool activeAlerts = hasActiveAlerts();
    bool recentClear = hasRecentClearAnimation(millis());

    if (activeAlerts || recentClear) {
        renderAlertClearState(night);
        return;
    }

    if (!gInternetConnected || WiFi.status() != WL_CONNECTED) {
        renderRetainedStateWithPulse(night, false);
        return;
    }

    if (strlen(gConfig.mqttHost) && !gMqttConnected) {
        renderRetainedStateWithPulse(night, true);
        return;
    }

    renderGlobalState(animationForState(MAP_STATE_IDLE), ukraineBlueColor(), ukraineYellowColor());
}
