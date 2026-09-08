# AlarmMini Vercel Installer

Installer/flasher UI for deploying AlarmMini from GitHub Releases on Vercel.

Production URL: [alarmmini.vercel.app](https://alarmmini.vercel.app)

## What it does

The main flow has three steps: select the board and installation mode, connect USB, and start writing. Updating with configuration preservation is the default. A first installation requires a separate acknowledgement that settings will be erased. Unsupported browsers receive desktop Chrome/Edge instructions and cannot start writing.

First installation selects the **UkraineAlarm AIR · 6 states** preset by default.
It includes day/night colors for states 0–5, the 22:00–07:00 night schedule,
27-LED mapping, effects and MQTT topic `ukraine/alarm/map/full_v2` on port 1883.
Wi-Fi credentials, MQTT host/user/password and fallback URL/token are empty.
The full public template is downloadable at `/profiles/ukrainealarm-air-6-states.json`.
It is written through the existing chunked USB protocol after flashing, then
read back and compared before installation is reported as successful. An optional
fallback URL entered by the user is verified and applied afterward. The preset
requires firmware 2.1.0+; older releases are blocked before erasing unless the
user disables the preset. Updates always restore the board's own backup.

An update reads a fresh configuration from the selected board before writing. A read failure stops the operation; a previous browser backup is never substituted automatically. ESP Web Tools' low-level `flash()` terminal event confirms completion before reconnecting, restoring the full configuration in one transaction, and comparing the result. Recovery after an interrupted update checks the board hostname against the current attempt. Backup downloads contain credentials and stay local to the browser.

MQTT, JSON editing, QR labels, and logs are under the collapsed additional settings. Stable GitHub releases are fetched through a cached server endpoint with retry controls.

- fetches public GitHub Releases
- shows firmware versions
- shows attached `.bin` assets
- checks whether `Web Serial` is available in the browser
- reads device info over UART via `get:info`
- reads config over UART via `get:config`
- writes config over UART via chunked `cmd=set_begin` / `data=HEX` / `cmd=set_end` restore protocol
- applies Wi-Fi over UART via `set:wifi {"ssid":"...","password":"..."}`
- updates board snapshot from UART `device_info` events
- preserves config during browser flashing flow (backup -> flash -> reconnect -> chunked restore -> verify)

## Release assets expected by UI

For each GitHub Release attach these files:

ESP32-C3:

- `alarmmini-esp32c3-firmware.bin`
- `alarmmini-esp32c3-littlefs.bin`
- `alarmmini-esp32c3-bootloader.bin`
- `alarmmini-esp32c3-partitions.bin`
- `alarmmini-esp32c3-boot_app0.bin`

ESP8266 / Wemos D1 mini:

- `alarmmini-esp8266-firmware.bin`
- `alarmmini-esp8266-littlefs.bin`

## Environment

Copy `.env.example` to `.env.local` and set:

```env
NEXT_PUBLIC_GITHUB_OWNER=your-github-user-or-org
NEXT_PUBLIC_GITHUB_REPO=your-repo-name
```

## Install

```powershell
npm install
```

## Run locally

```powershell
npm run dev
```

## Deploy to Vercel

Use the existing project linked by `.vercel/project.json`, from this directory:

```powershell
npx vercel deploy --prod --yes
```

If the CLI reports an invalid token, run `npx vercel login` with the account that owns the existing project, then retry. Deploying this site does not publish local firmware binaries; the installer continues using published GitHub release assets.

## Verification

```powershell
npm ci
npm test
npm run typecheck
npm run build
```

With the app running locally, use `npm run test:browser`. Windows tests use installed Edge; CI uses Chromium (`npx playwright install --with-deps chromium`). `TEST_BASE_URL` selects a different server. Browser tests mock USB where needed and never write to a physical board. The flasher tests exercise the actual completion/error gate with an injected transport implementation. Physical Web Serial flashing still requires a separate hardware check.

## GitHub Actions deployment

Production and preview deployments are handled by `.github/workflows/vercel-deploy.yml`.

Required GitHub repository secrets:

- `VERCEL_TOKEN`
- `VERCEL_ORG_ID`
- `VERCEL_PROJECT_ID`

Production URL:

- `https://alarmmini.vercel.app/`

If the production URL returns `401 Unauthorized`, disable Vercel Deployment Protection for production or allow public access for this project in the Vercel dashboard.

## Flashing layer

The installer uses ESP Web Tools plus Web Serial. The production flow supports reading config, choosing ESP32-C3 or ESP8266 firmware, flashing firmware + LittleFS, restoring Wi-Fi/MQTT/config, and verifying restored JSON after reboot.
