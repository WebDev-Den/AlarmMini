#pragma once

#include <Arduino.h>
#include "config.h"

#if defined(ESP32)
#include <esp32-hal-ledc.h>
#endif

namespace platform_audio
{
#if defined(ESP32)
static constexpr uint8_t BUZZER_LEDC_CHANNEL = 6;
#endif

inline void initBuzzerPin()
{
    pinMode(BUZZER_PIN, OUTPUT);
    digitalWrite(BUZZER_PIN, LOW);
#if defined(ESP32)
    ledcSetup(BUZZER_LEDC_CHANNEL, 2000, 10);
    ledcAttachPin(BUZZER_PIN, BUZZER_LEDC_CHANNEL);
    ledcWriteTone(BUZZER_LEDC_CHANNEL, 0);
#endif
}

inline void playTone(uint16_t freq)
{
#if defined(ESP32)
    ledcWriteTone(BUZZER_LEDC_CHANNEL, freq);
#else
    tone(BUZZER_PIN, freq);
#endif
}

inline void stopTone()
{
#if defined(ESP32)
    ledcWriteTone(BUZZER_LEDC_CHANNEL, 0);
#else
    noTone(BUZZER_PIN);
#endif
}
} // namespace platform_audio
