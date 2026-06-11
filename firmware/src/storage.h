#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>

#include "config.h"
#include "logger.h"

extern AppConfig gConfig;

#if defined(ESP8266)
constexpr size_t CONFIG_JSON_CAPACITY = 3584;
#else
constexpr size_t CONFIG_JSON_CAPACITY = 4096;
#endif
constexpr uint8_t CONFIG_SCHEMA_VERSION = 5;
constexpr uint8_t CONFIG_DOCUMENT_VERSION = 1;

void storagePopulateJson(JsonDocument &doc);
void storageApplyJson(JsonVariantConst doc);

bool storageSaveCurrentConfig(bool forceWrite = false);
bool storageSaveConfigFromJson(JsonVariantConst configJson, bool forceWrite, char *error, size_t errorSize);
bool storageLoadConfigFromJson(JsonVariantConst configJson, char *error, size_t errorSize);

bool storageSyncWifiCredentials();
bool storageInit();
