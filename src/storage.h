#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>

#include "config.h"
#include "logger.h"

extern AppConfig gConfig;

constexpr size_t CONFIG_JSON_CAPACITY = 4096;
constexpr uint8_t CONFIG_SCHEMA_VERSION = 2;

void storagePopulateJson(JsonDocument &doc);
void storageApplyJson(JsonVariantConst doc);

bool storageSaveCurrentConfig(bool forceWrite = false);
bool storageSaveConfigFromJson(JsonVariantConst configJson, bool forceWrite, char *error, size_t errorSize);
bool storageLoadConfigFromJson(JsonVariantConst configJson, char *error, size_t errorSize);

bool storageSyncWifiCredentials();
bool storageInit();

