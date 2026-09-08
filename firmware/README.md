# AlarmMini

AlarmMini is firmware + web tooling for a physical WS2812 Ukraine alarm map.

Current firmware version: **2.1.0**

MQTT and HTTP accept state codes 0..255. Configure up to 16 additional day/night
colors alongside states 0 and 1 in **Кольори**, using **+ Додати стан**. Sound
support is removed. New installs use `ukraine/alarm/map/full_v2`; existing backups
preserve their MQTT topic (`ukraine/alarm/map/full` remains the legacy 0/1 feed).
Both ESP32-C3 and
ESP8266 builds support this. Upgrade firmware and LittleFS together, preserving
the config. See [compatibility and migration](../docs/multistate.md).

Production installer: [alarmmini.vercel.app](https://alarmmini.vercel.app)

## Supported boards

- ESP32-C3 SuperMini (`env:esp32c3`, board `esp32-c3-devkitm-1`)
- ESP8266 / Wemos D1 mini (`env:esp8266`, board `d1_mini`)

## Main features

- Real-time alarm map rendering by regions (MQTT input)
- Day/night modes with brightness limits
- Web UI from LittleFS
- Serial JSON protocol for installer and service tasks
- Config backup/restore during flashing
- mDNS, custom Wi-Fi provisioning portal, MQTT reconnect logic
- Release assets for ESP32-C3 and ESP8266

## Repository layout

- `src/` - firmware sources
- `work_data/` - editable web assets
- `data/` - generated/minified LittleFS assets (generated)
- `scripts/` - build/flash/release helper scripts
- `../vercel/` - Next.js web installer
- `.github/workflows/` - CI/release pipelines

## Environment variables

Use only one firmware env file in this folder: **`firmware/.env`**.

- Template: `.env.example`
- `.env` is ignored by git

Used by:

- web asset placeholders during `buildfs`
- installer public links
- optional release-safe MQTT template values (`ALARMMINI_RELEASE_MQTT_*`)
- CI/release safe build mode (`ALARMMINI_CONFIG_MODE=release`)

## Serial protocol (device)

Device accepts text commands and responds with JSON.

- `get:info`
- `get:config`
- `set:config { ... }`
- `set:wifi {"ssid":"...","password":"..."}`

## Local development

### 1) Build firmware

```powershell
platformio run -e esp32c3
platformio run -e esp8266
```

### 2) Build filesystem

```powershell
platformio run -t buildfs -e esp32c3
platformio run -t buildfs -e esp8266
```

### 3) Upload to board

```powershell
platformio run -t upload -e esp32c3
platformio run -t uploadfs -e esp32c3
# or
platformio run -t upload -e esp8266
platformio run -t uploadfs -e esp8266
```

## Safe flashing with config restore

Custom targets back up config from serial, flash firmware/filesystem, then restore config.

```powershell
# firmware + fs + restore config
platformio run -e esp32c3 -t flash_preserve
platformio run -e esp8266 -t flash_preserve

# firmware only + restore config
platformio run -e esp32c3 -t flash_preserve_fw
platformio run -e esp8266 -t flash_preserve_fw
```

Manual mode:

```powershell
python scripts/config_preserve_flash.py --env esp32c3 --port COM7
python scripts/config_preserve_flash.py --env esp8266 --port COM7
```

## Release artifacts

Create all binaries locally:

```powershell
python scripts/build_release_assets.py
```

Output folder:

- `release_artifacts/alarmmini-esp32c3-firmware.bin`
- `release_artifacts/alarmmini-esp32c3-littlefs.bin`
- `release_artifacts/alarmmini-esp32c3-bootloader.bin`
- `release_artifacts/alarmmini-esp32c3-partitions.bin`
- `release_artifacts/alarmmini-esp32c3-boot_app0.bin`
- `release_artifacts/alarmmini-esp8266-firmware.bin`
- `release_artifacts/alarmmini-esp8266-littlefs.bin`

GitHub workflow `release-assets.yml` attaches these files to published releases.

## Config validation

Validate compact config contract before build/release:

```powershell
python scripts/validate_config_contract.py
```

Checks:

- `work_data/config.example.json` (always)
- `work_data/config.json` (if exists locally)

## Stability regression tests

After installing/building the PlatformIO dependencies, run:

```powershell
python tests/storage_fault_injection.py
python tests/runtime_regressions.py
python tests/wifi_runtime_test.py
node tests/provision_ui_test.js
```

The native tests need MSVC C++ Build Tools (x86) on Windows, or `g++-multilib`
on Linux. They execute production code with simulated flash, radio, serial and
time; they do not replace tests on physical boards. Run them after PlatformIO
finishes installing dependencies.

The [stability audit](../docs/firmware-stability-audit.md) documents the fixes and
the hardware acceptance checklist. Setup remains available while saved Wi-Fi is
retried, including when a router starts after the device. After a runtime outage
of 30 seconds, the setup AP opens again; it closes after 30 seconds of stable
Wi-Fi. Connection attempts have a 20-second deadline and a 30-second retry pause.
The setup API returns HTTP 202 while connecting; `/api/provision/status` reports
completion or failure. Credentials entered through the portal are committed only
after a successful connection. Diagnostic flash writes start after 30 seconds,
so very short boots may be absent from the persistent boot counter.

Build dependencies are pinned to the versions used for this audit. Update them
explicitly and repeat both platform builds and regression tests.

## Vercel installer

Project root for installer: `../vercel/`

Build:

```powershell
cd ..\vercel
npm install
npm run build
```

Deploy production:

```powershell
vercel --prod
vercel alias set <deployment-url> alarmmini.vercel.app
```

## CI

`firmware-ci.yml` does:

- compact config validation (`scripts/validate_config_contract.py`)
- firmware build for `esp32c3` and `esp8266`
- LittleFS build for `esp32c3` and `esp8266`
- CI `.bin` artifact upload for test flashing
- Next.js installer build (`vercel`)

`secret-scan.yml` runs Gitleaks on push/PR and daily schedule.

## Notes

### Optimization regression checks

Run `python tests/optimization_test.py` after installing PlatformIO dependencies. It exercises the production UART serializer, HTTP writer, legacy config migration, and LED frame cache for both chip configurations. See `../docs/firmware-optimization.md` for measured RAM/flash changes and hardware verification limits.

- `server.json` is intentionally not part of this firmware/release flow.
- Keep private tokens and MQTT credentials only in root `.env` or GitHub secrets.
