# AlarmMini

AlarmMini is firmware + web tooling for a physical WS2812 Ukraine alarm map.

Current firmware version: **1.0.5**

Production installer: [alarmmini.vercel.app](https://alarmmini.vercel.app)

## Supported boards

- ESP8266 (`env:esp8266`, board `d1_mini`)
- ESP32-C3 SuperMini (`env:esp32c3`, board `esp32-c3-devkitm-1`)
- Legacy alias for CI/scripts: `env:esp8266e12` (extends `esp8266`)

## Main features

- Real-time alarm map rendering by regions (MQTT input)
- Day/night modes with brightness limits
- Web UI from LittleFS
- Serial JSON protocol for installer and service tasks
- Config backup/restore during flashing
- mDNS, Wi-Fi manager, MQTT reconnect logic
- Release assets for both boards

## Repository layout

- `src/` - firmware sources
- `work_data/` - editable web assets
- `data/` - generated/minified LittleFS assets (generated)
- `scripts/` - build/flash/release helper scripts
- `vercel_installer_local/` - Next.js web installer
- `.github/workflows/` - CI/release pipelines

## Environment variables

Use only one env file in project root: **`.env`**.

- Template: `.env.example`
- `.env` is ignored by git

Used by:

- web asset placeholders during `buildfs`
- installer public links
- release default MQTT template values
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
platformio run -e esp8266
platformio run -e esp32c3
```

### 2) Build filesystem

```powershell
platformio run -t buildfs -e esp8266
platformio run -t buildfs -e esp32c3
```

### 3) Upload to board

```powershell
platformio run -t upload -e esp8266
platformio run -t uploadfs -e esp8266

platformio run -t upload -e esp32c3
platformio run -t uploadfs -e esp32c3
```

## Safe flashing with config restore

Custom targets back up config from serial, flash firmware/filesystem, then restore config.

```powershell
# firmware + fs + restore config
platformio run -e esp8266 -t flash_preserve
platformio run -e esp32c3 -t flash_preserve

# firmware only + restore config
platformio run -e esp8266 -t flash_preserve_fw
platformio run -e esp32c3 -t flash_preserve_fw
```

Manual mode:

```powershell
python scripts/config_preserve_flash.py --env esp32c3 --port COM7
```

## Release artifacts

Create all binaries locally:

```powershell
python scripts/build_release_assets.py
```

Output folder:

- `release_artifacts/alarmmini-esp8266-firmware.bin`
- `release_artifacts/alarmmini-esp8266-littlefs.bin`
- `release_artifacts/alarmmini-esp32c3-firmware.bin`
- `release_artifacts/alarmmini-esp32c3-littlefs.bin`
- `release_artifacts/alarmmini-esp32c3-bootloader.bin`
- `release_artifacts/alarmmini-esp32c3-partitions.bin`
- `release_artifacts/alarmmini-esp32c3-boot_app0.bin`

GitHub workflow `release-assets.yml` attaches these files to published releases.

## Config validation

Validate compact config contract before build/release:

```powershell
python scripts/validate_config_contract.py
```

Checks:

- `work_data/config.example.json` (always)
- `work_data/config.json` (if exists locally)

## Vercel installer

Project root for installer: `vercel_installer_local/`

Build:

```powershell
cd vercel_installer_local
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
- firmware build for `esp8266` and `esp32c3`
- LittleFS build for `esp8266` and `esp32c3`
- Next.js installer build (`vercel_installer_local`)

`secret-scan.yml` runs Gitleaks on push/PR and daily schedule.

## Notes

- `server.json` is intentionally not part of this firmware/release flow.
- Keep private tokens and MQTT credentials only in root `.env` or GitHub secrets.
