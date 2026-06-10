# AlarmMini

AlarmMini is a commercial firmware and web-installer project for a compact physical Ukraine alert map based on addressable WS2812B LEDs and ESP32-C3 or ESP8266 controllers.

Production installer: [https://alarmmini.vercel.app](https://alarmmini.vercel.app)

## Product Summary

AlarmMini is designed as a ready-to-assemble IoT map controller. A user can connect the board to a computer, flash the latest firmware from the website, restore or update the full configuration, generate QR labels, and deploy the device without installing developer tools.

The project includes:

- embedded firmware for ESP32-C3 SuperMini and ESP8266 / Wemos D1 mini;
- LittleFS web interface served directly from the board;
- UART service protocol for factory setup and recovery;
- Vercel web installer for flashing, config backup/restore, and QR label printing;
- GitHub Actions CI/CD for firmware builds, release binaries, and Vercel deployment;
- STL/manual production assets for enclosure and assembly.

## Supported Hardware

- ESP32-C3 SuperMini, PlatformIO environment `esp32c3`.
- ESP8266 / Wemos D1 mini, PlatformIO environment `esp8266`.
- WS2812B addressable LED strip or PCB LEDs.
- Optional buzzer.
- USB connection for flashing, serial diagnostics, config import/export, and service setup.

The firmware was optimized for small embedded boards: low RAM usage, non-blocking reconnect logic, compact JSON config, LittleFS storage, and safe serial recovery.

## Main Features

- MQTT-based real-time alert map updates.
- Wi-Fi STA mode plus provisioning AP mode.
- AP QR code for first-time setup.
- Device QR labels for IP/mDNS/admin access.
- Full JSON config import/export over UART and web installer.
- Safe config preservation during flashing.
- LittleFS web UI on the device.
- Admin password, mDNS hostname, IP and health information.
- Reset diagnostics and boot counters.
- Day/night LED behavior and brightness limits.
- GitHub Release firmware assets for browser flashing.
- Vercel-hosted installer at `alarmmini.vercel.app`.

## Repository Structure

- `firmware/` - embedded firmware, PlatformIO project, LittleFS web assets, scripts, config schema, STL files.
- `vercel/` - Next.js/Vercel installer for flashing boards and managing full config JSON.
- `.github/workflows/` - CI/CD pipelines for firmware, release assets, security scan, and Vercel deploy.

Generated folders are ignored:

- `firmware/.pio/`
- `firmware/data/`
- `firmware/release_artifacts/`
- `vercel/.next/`
- `vercel/node_modules/`

## Firmware Development

Install PlatformIO, then run from the repository root:

```powershell
cd firmware
platformio run -e esp32c3
platformio run -e esp8266
```

Build LittleFS image:

```powershell
cd firmware
platformio run -t buildfs -e esp32c3
platformio run -t buildfs -e esp8266
```

Flash firmware and filesystem:

```powershell
cd firmware
platformio run -t upload -e esp32c3
platformio run -t uploadfs -e esp32c3
# or
platformio run -t upload -e esp8266
platformio run -t uploadfs -e esp8266
```

Safe flashing with config preservation:

```powershell
cd firmware
platformio run -e esp32c3 -t flash_preserve
# or
platformio run -e esp8266 -t flash_preserve
```

Manual config-preserving flash:

```powershell
cd firmware
python scripts/config_preserve_flash.py --env esp32c3 --port COM7
# or
python scripts/config_preserve_flash.py --env esp8266 --port COM7
```

## Firmware Release Assets

Release binaries are generated from the `firmware/` folder:

```powershell
cd firmware
python scripts/build_release_assets.py
```

Expected output:

- `firmware/release_artifacts/alarmmini-esp32c3-firmware.bin`
- `firmware/release_artifacts/alarmmini-esp32c3-littlefs.bin`
- `firmware/release_artifacts/alarmmini-esp32c3-bootloader.bin`
- `firmware/release_artifacts/alarmmini-esp32c3-partitions.bin`
- `firmware/release_artifacts/alarmmini-esp32c3-boot_app0.bin`
- `firmware/release_artifacts/alarmmini-esp8266-firmware.bin`
- `firmware/release_artifacts/alarmmini-esp8266-littlefs.bin`

These files are attached to GitHub Releases by `.github/workflows/release-assets.yml`. The Vercel installer reads GitHub Releases and uses these assets for browser flashing.

## Vercel Installer

The installer lives in `vercel/` and is deployed to:

[https://alarmmini.vercel.app](https://alarmmini.vercel.app)

Local build:

```powershell
cd vercel
npm install
npm run build
```

Local development:

```powershell
cd vercel
npm run dev
```

The installer supports:

- selecting a GitHub Release;
- flashing firmware and LittleFS from release `.bin` assets;
- reading board info over Web Serial;
- reading and writing full config JSON;
- preserving config before flashing and restoring it after flashing;
- showing IP, mDNS, admin password, reset reason, firmware version, and boot counter;
- generating QR labels for device access;
- generating AP Wi-Fi/setup QR codes when the board is in AP mode.

## Vercel Project Settings

Required Vercel settings:

- Project root directory: `vercel`
- Production branch: `main`
- Production domain: `alarmmini.vercel.app`
- Framework preset: Next.js

Recommended public environment variables:

```env
NEXT_PUBLIC_GITHUB_OWNER=WebDev-Den
NEXT_PUBLIC_GITHUB_REPO=AlarmMini
```

If `https://alarmmini.vercel.app` returns `401 Unauthorized`, disable Deployment Protection for production or allow public access in the Vercel dashboard.

## GitHub Actions CI/CD

Workflows:

- `firmware-ci.yml` validates config, builds firmware, builds LittleFS, builds the installer, and uploads CI `.bin` artifacts for test flashing.
- `release-assets.yml` builds production release `.bin` files and attaches them to GitHub Releases.
- `vercel-deploy.yml` builds and deploys the installer from `vercel/` to Vercel.
- `secret-scan.yml` runs Gitleaks on push, pull requests, and schedule.

Required GitHub repository secrets for Vercel deployment:

- `VERCEL_TOKEN`
- `VERCEL_ORG_ID`
- `VERCEL_PROJECT_ID`

Optional deploy-hook based deployment:

- `VERCEL_DEPLOY_HOOK_URL`

Use deploy hooks only if you want Vercel to be triggered by a secret URL. The preferred commercial flow is GitHub Actions with Vercel token-based deployment.

## Configuration Policy

AlarmMini uses full-config read/write semantics.

The board and installer should follow one rule:

- read the full JSON config;
- edit it in memory/UI;
- write the full JSON config back;
- never partially overwrite unrelated sections.

This prevents accidental loss of Wi-Fi, MQTT, NTP, color, region, admin, or calibration fields when changing only one setting.

Private local configs must not be committed. Use:

- `firmware/.env` for firmware build-time local secrets;
- `firmware/work_data/config.json` for local board defaults, ignored by git;
- Vercel dashboard env vars for production installer settings.

Committed safe defaults:

- `firmware/work_data/config.example.json`
- `firmware/config.schema.json`
- `vercel/.env.production` with public GitHub owner/repo only.

## Serial Service Protocol

The board accepts service commands over USB serial and responds with JSON.

Common commands:

- `hello`
- `get:info`
- `get:config`
- `set:config { ... }`
- `set:wifi {"ssid":"...","password":"..."}`

The installer also uses chunked config restore for large JSON payloads, so full config import/export remains stable even when the config grows.

## Production Workflow

Recommended factory/service workflow:

1. Connect the board by USB.
2. Open [https://alarmmini.vercel.app](https://alarmmini.vercel.app).
3. Connect the board in the browser.
4. Read current device info and config.
5. Flash selected GitHub Release.
6. Restore the full config automatically.
7. Verify board info, firmware version, IP, mDNS, and admin password.
8. Print QR labels from the installer.
9. If the board is in AP mode, print AP setup QR and finish Wi-Fi provisioning.

## Quality Gates

Before release:

```powershell
cd firmware
python scripts/validate_config_contract.py
platformio run -e esp32c3
platformio run -e esp8266
platformio run -t buildfs -e esp32c3
platformio run -t buildfs -e esp8266
python scripts/build_release_assets.py
```

```powershell
cd vercel
npm install
npm run build
```

Expected result:

- firmware build succeeds;
- LittleFS image builds;
- release `.bin` assets are generated;
- Next.js production build succeeds;
- GitHub Actions pass on `main`;
- `https://alarmmini.vercel.app` is publicly accessible.

## Security And Operations

- Do not commit MQTT passwords, Wi-Fi passwords, Vercel tokens, or deploy hook URLs.
- Keep production secrets in GitHub Secrets or Vercel environment variables.
- Keep local config backups outside git.
- Use the serial export/import flow before flashing customer devices.
- Treat deploy hook URLs like passwords.
- Review `npm audit` output before major public releases.

## Commercial Notes

This repository is structured for commercial use:

- hardware firmware and production assets are isolated in `firmware/`;
- customer-facing installer is isolated in `vercel/`;
- release artifacts are generated automatically;
- the website can flash boards without local developer tools;
- full config backup/restore protects customer setup data;
- QR labels simplify deployment and support.

Approximate product cost depends on print quality, LED count, controller board, assembly convenience, and MQTT/server support. The main commercial value is not only the components, but also reliable firmware, safe flashing, configuration recovery, hosted installer, and operational support.

## Useful Links

- Production installer: [https://alarmmini.vercel.app](https://alarmmini.vercel.app)
- Repository: [https://github.com/WebDev-Den/AlarmMini](https://github.com/WebDev-Den/AlarmMini)
