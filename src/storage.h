#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>

#include "config.h"
#include "logger.h"

extern AppConfig gConfig;

constexpr size_t CONFIG_JSON_CAPACITY = 6144;
constexpr uint8_t CONFIG_SCHEMA_VERSION = 2;

void storagePopulateJson(JsonDocument &doc);
void storageApplyJson(DynamicJsonDocument &doc);

bool storageSaveCurrentConfig(bool forceWrite = false);
bool storageSaveConfigFromJson(JsonVariantConst configJson, bool forceWrite, char *error, size_t errorSize);
bool storageLoadConfigFromJson(JsonVariantConst configJson, char *error, size_t errorSize);

bool storageSyncWifiCredentials();
bool storageInit();

