#pragma once
#include <stddef.h>
#include <stdint.h>
#include <string.h>

template <size_t Bytes>
class LedFrameCache {
public:
    bool shouldSend(const uint8_t *pixels, uint32_t now, bool force = false) {
        // Refresh a steady frame too: LEDs can lose their own power while the
        // controller keeps running. Changed animation frames are never delayed.
        if (!force && valid_ && uint32_t(now - sentAt_) < 250U &&
            memcmp(previous_, pixels, Bytes) == 0) return false;
        memcpy(previous_, pixels, Bytes);
        sentAt_ = now;
        valid_ = true;
        return true;
    }
private:
    uint8_t previous_[Bytes]{};
    uint32_t sentAt_ = 0;
    bool valid_ = false;
};
