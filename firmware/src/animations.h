#pragma once

#include <Arduino.h>
#include <cmath>
#include "config.h"

#ifndef M_PI
#define M_PI 3.14159265358979323846f
#endif

inline float animSpeedFactor(const AnimationConfig& cfg) {
    return 0.45f + (cfg.speed * 0.22f);
}

inline float animScaleFactor(const AnimationConfig& cfg) {
    return constrain(cfg.scale / 100.0f, 0.0f, 1.0f);
}

inline float animSizeFactor(const AnimationConfig& cfg) {
    return 1.0f + (cfg.size * 0.45f);
}

inline float animTriangle(float x) {
    float f = x - floorf(x);
    return f < 0.5f ? (f * 2.0f) : (2.0f - f * 2.0f);
}

inline uint32_t animHash(uint32_t x) {
    x ^= x >> 16;
    x *= 0x7feb352d;
    x ^= x >> 15;
    x *= 0x846ca68b;
    x ^= x >> 16;
    return x;
}

inline uint32_t mixColor(Color a, Color b, float t) {
    t = constrain(t, 0.0f, 1.0f);
    return ((uint8_t)(a.r + (b.r - a.r) * t) << 16) |
           ((uint8_t)(a.g + (b.g - a.g) * t) << 8) |
           ((uint8_t)(a.b + (b.b - a.b) * t));
}

inline uint32_t applyColorBrightness(const Color& c, float brightness) {
    float ab = (c.a / 255.0f) * constrain(brightness, 0.0f, 1.0f);
    return ((uint8_t)(c.r * ab) << 16) |
           ((uint8_t)(c.g * ab) << 8) |
           (uint8_t)(c.b * ab);
}

inline float animationBrightness(const AnimationConfig& cfg, int ledIndex, int ledCount, unsigned long nowMs) {
    if (!cfg.enabled) return 1.0f;

    const float t = nowMs / 1000.0f;
    const float speed = animSpeedFactor(cfg);
    const float size = animSizeFactor(cfg);
    const float scale = animScaleFactor(cfg);
    const float pos = ledCount > 1 ? (float)ledIndex / (float)(ledCount - 1) : 0.0f;

    switch (cfg.effect) {
        case ANIM_STATIC:
            return 1.0f;

        case ANIM_PULSE: {
            float wave = 0.5f + 0.5f * sinf((t * speed * 2.0f * M_PI));
            return (1.0f - scale) + wave * scale;
        }

        case ANIM_BREATH: {
            float wave = 0.5f + 0.5f * sinf((t * speed * M_PI));
            float eased = wave * wave;
            return 0.2f + eased * (0.8f * scale + 0.2f);
        }

        case ANIM_WAVE: {
            float wave = 0.5f + 0.5f * sinf((pos * size - t * speed) * 2.0f * M_PI);
            return 0.15f + wave * (0.85f * scale + 0.15f);
        }

        case ANIM_SCANNER: {
            float travel = animTriangle(t * speed * 0.35f);
            float head = travel * (ledCount > 1 ? (ledCount - 1) : 1);
            float tail = max(1.0f, size * 0.9f);
            float distance = fabsf(ledIndex - head);
            float glow = 1.0f - min(distance / tail, 1.0f);
            return 0.08f + glow * (0.92f * scale + 0.08f);
        }

        case ANIM_BLINK: {
            float phase = fmodf(t * speed, 1.0f);
            return phase < 0.5f ? 1.0f : max(0.0f, 1.0f - scale);
        }

        case ANIM_FLAG: {
            float phase = sinf((pos * size - t * speed * 0.6f) * 2.0f * M_PI);
            return 0.35f + (0.65f * (0.5f + 0.5f * phase));
        }

        case ANIM_SPARKLE: {
            uint32_t bucket = (uint32_t)(t * (speed * 7.0f + 2.0f));
            uint32_t rnd = animHash((uint32_t)ledIndex * 2654435761UL ^ bucket);
            float sparkle = ((rnd & 1023) / 1023.0f);
            float threshold = 0.78f - (scale * 0.45f);
            return sparkle > threshold ? 1.0f : 0.12f + sparkle * 0.25f;
        }

        case ANIM_WIPE: {
            float cycle = fmodf(t * speed * 0.3f, 1.0f);
            float reveal = cycle * size;
            return pos <= reveal ? 1.0f : max(0.0f, 0.08f + scale * 0.22f);
        }

        case ANIM_FADE: {
            float wave = animTriangle(t * speed * 0.4f);
            return 0.1f + wave * (0.9f * scale + 0.1f);
        }

        default:
            return 1.0f;
    }
}

inline uint32_t animationColor(const AnimationConfig& cfg, int ledIndex, int ledCount, unsigned long nowMs, const Color& primary, const Color& secondary) {
    if (cfg.effect == ANIM_FLAG) {
        float pos = ledCount > 1 ? (float)ledIndex / (float)(ledCount - 1) : 0.0f;
        float wave = 0.5f + 0.5f * sinf((pos * animSizeFactor(cfg) - (nowMs / 1000.0f) * animSpeedFactor(cfg) * 0.6f) * 2.0f * M_PI);
        return mixColor(primary, secondary, wave);
    }
    return applyColorBrightness(primary, animationBrightness(cfg, ledIndex, ledCount, nowMs));
}
