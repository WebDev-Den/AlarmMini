# AlarmMini Vercel Installer

Local-only starter project for deploying a release picker and future Web Serial flasher to Vercel.

## What it does

- fetches public GitHub Releases
- shows firmware versions
- shows attached `.bin` assets
- checks whether `Web Serial` is available in the browser
- backs up config from device over UART via `{"cmd":"export_config"}`
- restores config over UART via `{"cmd":"import_config","config":{...}}`
- updates board snapshot from UART `device_info` events

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

1. Create a new Vercel project from this folder
2. Add the same environment variables in Vercel
3. Deploy

## Next step to make it a real flasher

Add a client-side flashing layer using:

- `esptool-js`
- or `ESP Web Tools`

The current UI already separates:

- release selection
- asset selection
- serial capability detection

You only need to attach the actual write-to-flash logic.
