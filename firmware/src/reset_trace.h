#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>

void resetTraceInit();
// Flush deferred diagnostics after 30 seconds of uptime; call from loop().
void resetTraceHandle();
void resetTraceSetStage(const char *stage, bool persist = true);

const char *resetTraceReason();
const char *resetTraceInfo();
const char *resetTraceStage();
uint32_t resetTraceBootCount();

void resetTraceFillHealth(JsonDocument &doc);
