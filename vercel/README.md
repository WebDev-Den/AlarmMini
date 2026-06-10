# AlarmMini Vercel Installer

Installer/flasher UI for deploying AlarmMini from GitHub Releases on Vercel.

Production URL: [alarmmini.vercel.app](https://alarmmini.vercel.app)

## What it does

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

1. Create a new Vercel project from this `vercel/` folder
2. Add the same environment variables in Vercel
3. Deploy

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
