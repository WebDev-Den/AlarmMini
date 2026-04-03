#pragma once
#include <Arduino.h>
#include "config.h"
#include "logger.h"
#include "storage.h"
#include "alerts.h"

#define NOTE_C4 262
#define NOTE_D4 294
#define NOTE_E4 330
#define NOTE_F4 349
#define NOTE_G4 392
#define NOTE_A4 440
#define NOTE_B4 494
#define NOTE_C5 523

// Тривога — висхідна тривожна
const int ALERT_MELODY[]    = {NOTE_E4, NOTE_E4, NOTE_G4, NOTE_E4, NOTE_G4, NOTE_A4, NOTE_C5, NOTE_C5};
const int ALERT_DURATIONS[] = {100,     50,      150,     100,     100,     200,     300,     200};
#define ALERT_NOTES 8

// Відбій — спадна заспокійлива
const int CLEAR_MELODY[]    = {NOTE_C5, NOTE_B4, NOTE_A4, NOTE_G4, NOTE_E4, NOTE_C4};
const int CLEAR_DURATIONS[] = {200,     150,     150,     200,     200,     400};
#define CLEAR_NOTES 6

bool gBuzzerInitialized = false;
bool gPlaying    = false;
bool gPlayAlert  = false;
int  gNoteIndex  = 0;
unsigned long gNoteStart = 0;

void buzzerInit() {
    pinMode(BUZZER_PIN, OUTPUT);
    digitalWrite(BUZZER_PIN, LOW);
    LOG_INFO(LOG_CAT_SYSTEM, "Buzzer initialized");
}

void buzzerPlay(bool isAlert) {
    noTone(BUZZER_PIN);
    gPlaying   = true;
    gPlayAlert = isAlert;
    gNoteIndex = 0;
    gNoteStart = 0;
    LOG_INFO(LOG_CAT_TEST, "%s buzzer test", isAlert ? "Alert" : "Clear");
}

void buzzerTest(bool isAlert) {
    buzzerPlay(isAlert);
}

void buzzerHandle() {
    // перевіряємо зміни тривог у відстежуваних регіонах
    if (gBuzzerInitialized && gConfig.buzzer.enabled && gAlertsChanged) {
        bool wasAlert = false, nowAlert = false;
        for (int i = 0; i < REGIONS_COUNT; i++) {
            if (!gConfig.buzzer.regions[i]) continue;
            if (gPrevAlerts[i]) wasAlert = true;
            if (gAlerts[i])     nowAlert = true;
        }
        if (!wasAlert && nowAlert)  buzzerPlay(true);
        if (wasAlert  && !nowAlert) buzzerPlay(false);
        gAlertsChanged = false;
    }
    gBuzzerInitialized = true;

    if (!gPlaying) return;

    const int* melody    = gPlayAlert ? ALERT_MELODY    : CLEAR_MELODY;
    const int* durations = gPlayAlert ? ALERT_DURATIONS : CLEAR_DURATIONS;
    int        total     = gPlayAlert ? ALERT_NOTES     : CLEAR_NOTES;

    unsigned long now = millis();

    if (gNoteIndex < total) {
        if (gNoteStart == 0 || now - gNoteStart >= (unsigned long)durations[gNoteIndex]) {
            tone(BUZZER_PIN, melody[gNoteIndex]);
            gNoteStart = now;
            gNoteIndex++;
        }
    } else {
        noTone(BUZZER_PIN);
        gPlaying = false;
    }
}
