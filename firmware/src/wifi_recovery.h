#pragma once
#include <stdint.h>

// Unsigned elapsed times remain valid across the millis() wrap at ~49 days.
struct WifiRecoverySchedule
{
    static constexpr uint32_t ATTEMPT_MS = 20000;
    static constexpr uint32_t RETRY_MS = 30000;
    static constexpr uint32_t FALLBACK_MS = 30000;
    static constexpr uint32_t AP_GRACE_MS = 30000;

    bool attempting = false;
    bool connected = false;
    uint32_t attemptSince = 0;
    uint32_t idleSince = 0;
    uint32_t offlineSince = 0;
    uint32_t connectedSince = 0;

    void observe(bool ready, uint32_t now)
    {
        if (ready && !connected)
            connectedSince = now;
        if (!ready && connected)
        {
            offlineSince = now;
            idleSince = now - RETRY_MS; // Retry immediately on a new link loss.
        }
        connected = ready;
        if (ready)
            attempting = false;
    }

    void start(uint32_t now)
    {
        attempting = true;
        attemptSince = now;
    }

    void finish(uint32_t now)
    {
        attempting = false;
        idleSince = now;
    }

    bool timedOut(uint32_t now) const
    {
        return attempting && uint32_t(now - attemptSince) >= ATTEMPT_MS;
    }
    bool retryDue(uint32_t now) const
    {
        return !connected && !attempting && uint32_t(now - idleSince) >= RETRY_MS;
    }
    bool fallbackDue(uint32_t now) const
    {
        return !connected && uint32_t(now - offlineSince) >= FALLBACK_MS;
    }
    bool closeApDue(uint32_t now) const
    {
        return connected && uint32_t(now - connectedSince) >= AP_GRACE_MS;
    }
};
