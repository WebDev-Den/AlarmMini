#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>

void resetTraceInit();
void resetTraceSetStage(const char *stage, bool persist = true);

const char *resetTraceReason();
const char *resetTraceInfo();
const char *resetTraceStage();
uint32_t resetTraceBootCount();

void resetTraceFillHealth(JsonDocument &doc);
