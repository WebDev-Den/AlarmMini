#pragma once
#include <Arduino.h>
#define AP_NAME     "AlarmMap-Setup"
#define AP_PASSWORD "12345678"
#define LED_PIN    5
#define MAX_LEDS   27
#define BUZZER_PIN 14

#define MQTT_HOST_MAXLEN  64
#define MQTT_TOPIC_MAXLEN 64
#define MQTT_USER_MAXLEN  32
#define MQTT_PASS_MAXLEN  32
#define NTP_SERVER_MAXLEN 64
#define ADMIN_PASS_MAXLEN 32
#define FIRMWARE_VERSION  "1.0.1-beta"

#define REGIONS_COUNT 25

const char* const REGIONS[REGIONS_COUNT] = {
    "Вінницька область",         // 0
    "Волинська область",         // 1
    "Дніпропетровська область",  // 2
    "Донецька область",          // 3
    "Житомирська область",       // 4
    "Закарпатська область",      // 5
    "Запорізька область",        // 6
    "Івано-Франківська область", // 7
    "Київська область",          // 8
    "Кіровоградська область",    // 9
    "Луганська область",         // 10
    "Львівська область",         // 11
    "Миколаївська область",      // 12
    "Одеська область",           // 13
    "Полтавська область",        // 14
    "Рівненська область",        // 15
    "Сумська область",           // 16
    "Тернопільська область",     // 17
    "Харківська область",        // 18
    "Херсонська область",        // 19
    "Хмельницька область",       // 20
    "Черкаська область",         // 21
    "Чернівецька область",       // 22
    "Чернігівська область",      // 23
    "Автономна Республіка Крим"  // 24
};

struct Color      { uint8_t r, g, b, a; };
struct ModeConfig { Color alertColor; Color clearColor; };
enum AnimationEffectType : uint8_t {
    ANIM_STATIC = 0,
    ANIM_PULSE,
    ANIM_BREATH,
    ANIM_WAVE,
    ANIM_SCANNER,
    ANIM_BLINK,
    ANIM_FLAG,
    ANIM_SPARKLE,
    ANIM_WIPE,
    ANIM_FADE,
    ANIM_EFFECT_COUNT
};

struct AnimationConfig {
    uint8_t effect;
    uint8_t speed;
    uint8_t scale;
    uint8_t size;
    uint8_t maxBrightness;
    bool    enabled;
};

enum MapVisualState : uint8_t {
    MAP_STATE_STARTUP = 0,
    MAP_STATE_AP_MODE,
    MAP_STATE_INTERNET_LOST,
    MAP_STATE_MQTT_LOST,
    MAP_STATE_IDLE,
    MAP_STATE_COUNT
};

struct StateAnimationBinding {
    MapVisualState state;
    const char* label;
    AnimationConfig config;
};

constexpr uint16_t ALERT_CLEAR_HOLD_MS = 30000;
constexpr uint8_t SYSTEM_EFFECTS_MAX_BRIGHTNESS = 15;

// Main animation presets for map states.
// Change effect/speed/scale/size/maxBrightness here instead of the web UI.
constexpr StateAnimationBinding STATE_ANIMATIONS[MAP_STATE_COUNT] = {
    {MAP_STATE_STARTUP, "startup",       {ANIM_SCANNER, 6, 100, 5, SYSTEM_EFFECTS_MAX_BRIGHTNESS, true}},
    {MAP_STATE_AP_MODE, "apMode",        {ANIM_WAVE,    5, 100, 7, SYSTEM_EFFECTS_MAX_BRIGHTNESS, true}},
    {MAP_STATE_INTERNET_LOST, "internetLost", {ANIM_SCANNER, 6, 100, 5, SYSTEM_EFFECTS_MAX_BRIGHTNESS, true}},
    {MAP_STATE_MQTT_LOST, "mqttLost",    {ANIM_BLINK,   5, 100, 4, SYSTEM_EFFECTS_MAX_BRIGHTNESS, true}},
    {MAP_STATE_IDLE, "idle",             {ANIM_STATIC,  4,  80, 4, SYSTEM_EFFECTS_MAX_BRIGHTNESS, true}},
};

inline AnimationConfig animationForState(MapVisualState state) {
    for (uint8_t i = 0; i < MAP_STATE_COUNT; i++) {
        if (STATE_ANIMATIONS[i].state == state) return STATE_ANIMATIONS[i].config;
    }
    return STATE_ANIMATIONS[0].config;
}

struct NightConfig {
    bool    enabled;
    uint8_t startHour, startMinute;
    uint8_t endHour,   endMinute;
    uint8_t maxBrightness;      // 0-255: макс яскравість в ночі (обмеження)
    bool    pulseOnAlert;       // Пульсація при ТРИВОЗІ вночі
    bool    pulseOnClear;       // Пульсація при ВІДБОЮ вночі
};

struct BlinkConfig {
    bool    enabled;         // Мигання при втраті MQTT увімкнено?
    uint8_t dayIntensity;    // 0-100: інтенсивність мигання вдень
    uint8_t nightIntensity;  // 0-100: інтенсивність мигання вночі
};
struct BuzzerConfig {
    bool    enabled;
    uint8_t dayVolume, nightVolume;
    bool    regions[REGIONS_COUNT];
};

struct AppConfig {
    int8_t       ledRegion[MAX_LEDS];
    uint8_t      ledCount;
    ModeConfig   dayMode;
    ModeConfig   nightMode;
    NightConfig  night;
    BuzzerConfig buzzer;
    BlinkConfig  blink;        // Налаштування мигання при втраті MQTT
    // MQTT — всі налаштування через веб-інтерфейс
    char         mqttHost[MQTT_HOST_MAXLEN];
    uint16_t     mqttPort;
    char         mqttTopic[MQTT_TOPIC_MAXLEN];
    char         mqttUser[MQTT_USER_MAXLEN];
    char         mqttPass[MQTT_PASS_MAXLEN];
    char         ntpServer1[NTP_SERVER_MAXLEN];
    char         ntpServer2[NTP_SERVER_MAXLEN];
    char         ntpServer3[NTP_SERVER_MAXLEN];
    char         adminPassword[ADMIN_PASS_MAXLEN];
    uint16_t     logMask;
};
