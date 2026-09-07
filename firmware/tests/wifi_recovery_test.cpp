#include "../src/wifi_recovery.h"

#include <cstdlib>
#include <iostream>
#include <limits>

static void require(bool condition, const char* message)
{
    if (!condition)
    {
        std::cerr << "FAIL: " << message << '\n';
        std::exit(EXIT_FAILURE);
    }
}

static void routerReturnsAfterBootPortal()
{
    WifiRecoverySchedule schedule;
    schedule.start(0);
    // Boot switches to the portal after its shorter, bounded initial wait.
    schedule.finish(15000);
    schedule.observe(false, 30000);
    require(schedule.fallbackDue(30000), "missing router must permit fallback AP");
    require(!schedule.retryDue(44999), "portal must have an idle interval between scans");
    require(schedule.retryDue(45000), "portal must retry saved network without user input");

    schedule.start(45000);
    require(!schedule.retryDue(64000), "an active attempt must not be restarted");
    require(!schedule.timedOut(64999), "connection attempt must get its complete time budget");
    require(schedule.timedOut(65000), "missing router attempt must have a finite timeout");
    schedule.finish(65000);

    // The router becomes available at 90s, well after the old blocking portal.
    require(schedule.retryDue(95000), "a late router must get another connection attempt");
    schedule.start(95000);
    schedule.observe(true, 98000);
    require(schedule.connected && !schedule.attempting, "DHCP success must complete the active attempt");
    require(!schedule.retryDue(150000), "connected Wi-Fi must not be periodically restarted");
    require(!schedule.fallbackDue(150000), "connected Wi-Fi must not open fallback AP");
}

static void establishedConnectionDropsAndRecovers()
{
    WifiRecoverySchedule schedule;
    schedule.observe(true, 1000);
    schedule.observe(false, 1000000);
    require(schedule.retryDue(1000000), "a fresh runtime drop must retry immediately");
    require(!schedule.fallbackDue(1000000), "long uptime must not bypass new outage grace");
    schedule.start(1000000);
    require(schedule.timedOut(1020000), "runtime attempt must expire");
    schedule.finish(1020000);
    require(!schedule.fallbackDue(1029999), "short drop must not expose fallback AP");
    require(schedule.fallbackDue(1030000), "prolonged runtime outage must expose fallback AP");
    require(!schedule.retryDue(1049999), "failed runtime attempt must back off");
    require(schedule.retryDue(1050000), "failed runtime attempt must eventually retry");

    schedule.start(1050000);
    schedule.observe(true, 1052000);
    require(!schedule.closeApDue(1081999), "portal must stay up while connection settles");
    require(schedule.closeApDue(1082000), "stable connection must eventually close setup AP");
}

static void connectionFlapsResetPortalGrace()
{
    WifiRecoverySchedule schedule;
    schedule.observe(true, 100);
    schedule.observe(true, 20100);
    require(schedule.closeApDue(30100), "healthy observations must not keep extending AP grace");
    schedule.observe(false, 30200);
    require(!schedule.closeApDue(100000), "offline state must never close fallback AP");
    require(schedule.retryDue(30200), "flapping link still needs immediate recovery");
    schedule.start(30200);
    schedule.observe(true, 35000);
    require(!schedule.closeApDue(60000), "new connection must restart the full AP grace");
    require(schedule.closeApDue(65000), "grace must end after sustained reconnection");
    schedule.observe(false, 70000);
    require(!schedule.fallbackDue(99999), "new outage must have its own fallback deadline");
    require(schedule.fallbackDue(100000), "new outage must eventually reopen the portal");
}

static void failedAttemptsDoNotResetOutageAge()
{
    WifiRecoverySchedule schedule;
    schedule.observe(true, 10);
    schedule.observe(false, 1000);
    schedule.start(1000);
    schedule.finish(21000);
    require(schedule.fallbackDue(31000), "failure must not restart outage grace");
    schedule.start(51000);
    schedule.finish(71000);
    require(schedule.fallbackDue(71000), "later attempts must not hide an extended outage");
}

static void millisWrapDoesNotStallRecovery()
{
    constexpr uint32_t nearWrap = std::numeric_limits<uint32_t>::max() - 9999;
    WifiRecoverySchedule schedule;
    schedule.observe(true, nearWrap - 10);
    schedule.observe(false, nearWrap);
    require(schedule.retryDue(nearWrap), "immediate retry must work before wrap");
    schedule.start(nearWrap);
    require(!schedule.timedOut(uint32_t(nearWrap + 19999)), "attempt must not expire early across wrap");
    require(schedule.timedOut(uint32_t(nearWrap + 20000)), "attempt must expire across wrap");
    schedule.finish(uint32_t(nearWrap + 20000));
    require(!schedule.fallbackDue(uint32_t(nearWrap + 29999)), "fallback must not expire early across wrap");
    require(schedule.fallbackDue(uint32_t(nearWrap + 30000)), "fallback must work across wrap");
    require(!schedule.retryDue(uint32_t(nearWrap + 49999)), "retry backoff must survive wrap");
    require(schedule.retryDue(uint32_t(nearWrap + 50000)), "retry must resume after wrap");

    WifiRecoverySchedule portal;
    portal.observe(true, nearWrap);
    require(!portal.closeApDue(uint32_t(nearWrap + 29999)), "AP grace must not end early across wrap");
    require(portal.closeApDue(uint32_t(nearWrap + 30000)), "AP grace must end across wrap");
}

static void disconnectNearBootAvoidsUnsignedUnderflowDelay()
{
    WifiRecoverySchedule schedule;
    schedule.observe(true, 0);
    schedule.observe(false, 10);
    require(schedule.retryDue(10), "drop before first 30s must retry despite unsigned subtraction");
    require(!schedule.fallbackDue(10), "early drop must not trigger immediate fallback");
}

int main()
{
    routerReturnsAfterBootPortal();
    establishedConnectionDropsAndRecovers();
    connectionFlapsResetPortalGrace();
    failedAttemptsDoNotResetOutageAge();
    millisWrapDoesNotStallRecovery();
    disconnectNearBootAvoidsUnsignedUnderflowDelay();
    std::cout << "PASS: Wi-Fi recovery, late router, backoff, AP grace, flaps, millis wrap\n";
    return EXIT_SUCCESS;
}
