# ESP32-C3 SuperMini: Wi-Fi authentication failure

Bench: 2026-09-07, COM7, hostname `alarm-9E248C`, ESP32-C3 revision 0.4.

## Observed cause and controlled comparison

The configured SSID and password matched the user-provided values. A scan from the board found the configured network on channel 7, WPA2-PSK, RSSI -42 dBm. The driver held the correct SSID. At the SDK default TX limit of 80 quarter-dBm (20 dBm), connection attempts repeatedly ended with reason 2 (`AUTH_EXPIRE`).

Changing only the TX limit over UART to 34 quarter-dBm (8.5 dBm) allowed the board to connect and obtain `192.168.1.108`. Returning to 20 dBm and requesting reconnection reproduced the failure over a 25-second observation. Returning to 8.5 dBm restored the connection within approximately five seconds. This establishes a repeatable dependence on TX power for this board. It does not distinguish power-supply behavior from RF hardware behavior; that requires electrical/RF measurements.

## Change

The `esp32c3` SuperMini build profile now explicitly sets `ALARMMINI_WIFI_TX_POWER_QUARTER_DBM=34`. The limit is applied after radio mode/country setup and before connection attempts. ESP8266 retains its previous radio policy. Lower TX power can reduce range; the confirmed result is for this board and router, not every ESP32-C3 design. Other hardware profiles can use a separately validated limit.

Diagnostic build `2.0.7-dev` adds the last disconnect/failure reason, disconnect count, driver SSID, radio mode and TX limit to `get:diagnostics`. Event callback values use atomics. Factory scan output reports whether the configured SSID is visible and its channel/RSSI/authentication mode; a failed/busy scan does not claim that the target is absent. The temporary UART `wifi_tx_power` command accepts an integer from 8 to 80 quarter-dBm and does not persist configuration. Normal connection setup reapplies the board profile.

## Validation

- ESP32-C3 and ESP8266 firmware builds passed.
- Existing production Wi-Fi runtime and recovery tests passed.
- Firmware-only upload preserved, restored and compared the full configuration successfully.
- On boot with the fixed profile: Wi-Fi, MQTT and internet connected, alert data received, `/health` HTTP 200, no Wi-Fi disconnect events; TX limit confirmed as 34 quarter-dBm.
- Repeated software restarts reconnected to Wi-Fi and MQTT; the final check reached both at uptime 12.1 seconds and compared the full configuration against the backup successfully. Boot count is persisted with a delay, so rapid restart verification must use uptime reset rather than require a count increment. Power interruption and long-duration RF testing are separate from this check.

References: [Espressif Wi-Fi connection states and reason codes](https://docs.espressif.com/projects/esp-idf/en/release-v5.0/esp32c3/api-guides/wifi.html), [Espressif TX power units](https://docs.espressif.com/projects/esp-techpedia/en/latest/esp-friends/advanced-development/performance/modify-tx-power.html).
