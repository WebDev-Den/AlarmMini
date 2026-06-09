# AlarmMini

Commercial AlarmMini project split into two independent work areas.

## Folders

- `firmware/` - ESP32-C3 firmware, LittleFS web UI assets, serial/config tools, release scripts, STL files.
- `vercel/` - Vercel/Next.js installer for flashing boards, reading/writing full config JSON, and printing QR labels.

## Firmware

```powershell
cd firmware
platformio run -e esp32c3
platformio run -t buildfs -e esp32c3
```

Release binaries:

```powershell
cd firmware
python scripts/build_release_assets.py
```

## Vercel Installer

Production URL: [alarmmini.vercel.app](https://alarmmini.vercel.app)

```powershell
cd vercel
npm install
npm run build
```

Deploy:

```powershell
cd vercel
vercel --prod
```

## CI/CD

GitHub Actions:

- `firmware-ci.yml` validates config, builds firmware, builds LittleFS, and uploads CI `.bin` artifacts.
- `release-assets.yml` builds release `.bin` files from `firmware/` and attaches them to GitHub Releases.
- `vercel-deploy.yml` builds and deploys the installer from `vercel/` to Vercel.

Required GitHub repository secrets for Vercel deployment:

- `VERCEL_TOKEN`
- `VERCEL_ORG_ID`
- `VERCEL_PROJECT_ID`

The Vercel project must have production domain [alarmmini.vercel.app](https://alarmmini.vercel.app).

## Notes

- Keep firmware secrets in `firmware/.env`.
- Keep Vercel public settings in `vercel/.env.local` or the Vercel dashboard.
- Generated folders such as `firmware/.pio`, `firmware/data`, `firmware/release_artifacts`, `vercel/.next`, and `vercel/node_modules` are ignored.
