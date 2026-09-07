#pragma once
#include "fallback_contract.h"

struct FallbackHttpResult {
    char url[fallbackContract::URL_CAPACITY] = {};
    char body[fallbackContract::BODY_CAPACITY + 1] = {};
    int status = 0;
};

// One request at a time. ESP32 performs transport work in a separate task.
bool fallbackHttpStart(const char *url);
bool fallbackHttpTakeResult(FallbackHttpResult &out);
bool fallbackHttpBusy();
