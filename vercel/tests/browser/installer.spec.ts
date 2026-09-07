import { test, expect } from '@playwright/test';

const release = { id: 1, name: 'v2.0.5', tag_name: 'v2.0.5', published_at: '2026-06-01T12:00:00Z', assets: ['esp32c3-firmware', 'esp32c3-littlefs', 'esp32c3-bootloader', 'esp32c3-partitions', 'esp32c3-boot-app0', 'esp8266-firmware', 'esp8266-littlefs'].map((name, id) => ({ id, name: `${name}.bin`, size: 1024, browser_download_url: `https://github.com/WebDev-Den/AlarmMini/releases/download/v2.0.5/${name}.bin` })) };

test.beforeEach(async ({ page }) => {
  await page.route('**/api/releases', route => route.fulfill({ json: [release] }));
});

test('safe default, explicit erase consent, and advanced settings stay out of the primary flow', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('radio', { name: /Оновлення зі збереженням/ })).toBeChecked();
  await expect(page.getByRole('button', { name: 'Оновити й зберегти налаштування' })).toBeDisabled();
  await expect(page.getByText('Редактор конфігурації', { exact: true })).not.toBeVisible();
  await page.getByRole('radio', { name: /Перше встановлення/ }).check();
  await expect(page.getByRole('checkbox', { name: /Розумію/ })).not.toBeChecked();
  await expect(page.getByRole('button', { name: 'Встановити AlarmMini' })).toBeDisabled();
  await page.getByRole('checkbox', { name: /Розумію/ }).check();
  await page.getByRole('radio', { name: /Оновлення зі збереженням/ }).check();
  await page.getByRole('radio', { name: /Перше встановлення/ }).check();
  await expect(page.getByRole('checkbox', { name: /Розумію/ })).not.toBeChecked();
  expect(errors).toEqual([]);
});

test('unsupported browser explains how to continue and disables USB actions', async ({ page }) => {
  await page.addInitScript(() => { delete (Navigator.prototype as any).serial; });
  await page.goto('/');
  await expect(page.getByText('Для прошивання відкрий сайт на комп’ютері в Chrome або Edge.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Підключити через USB' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Оновити й зберегти налаштування' })).toBeDisabled();
});

test('canceling the port chooser keeps update mode and permits retry', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'serial', { value: { requestPort: async () => { throw new DOMException('No port selected', 'NotFoundError'); } } }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Підключити через USB' }).click();
  await expect(page.getByText(/Порт не вибрано/)).toBeVisible();
  await expect(page.getByRole('radio', { name: /Оновлення зі збереженням/ })).toBeChecked();
  await expect(page.getByRole('button', { name: 'Підключити через USB' })).toBeEnabled();
});

test('release fetch failure has a working retry', async ({ page }) => {
  await page.route('**/api/releases', route => route.fulfill({ status: 502, json: { error: 'offline' } }));
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Спробувати ще раз' })).toBeVisible();
  await page.route('**/api/releases', route => route.fulfill({ json: [release] }));
  await page.getByRole('button', { name: 'Спробувати ще раз' }).click();
  await expect(page.locator('.release-summary')).toContainText('v2.0.5');
});

test('mobile layout remains inside the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('.release-summary')).toContainText('v2.0.5');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/installer-mobile.png', fullPage: true });
});

test('missing board assets block flashing for that release', async ({ page }) => {
  await page.route('**/api/releases', route => route.fulfill({ json: [{ ...release, assets: release.assets.filter(asset => !asset.name.includes('esp8266')) }] }));
  await page.goto('/');
  await page.getByRole('radio', { name: /ESP8266 Wemos/ }).check();
  await expect(page.getByRole('button', { name: 'Оновити й зберегти налаштування' })).toBeDisabled();
});

test('a fresh backup failure never falls back to an older browser backup or starts writing', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const config = {
      c: { d: { a: [255,0,0,255], c: [0,80,0,80] }, n: { a: [25,0,0,24], c: [0,0,0,0] } },
      n: { e: true, s: [22,0], x: [8,0], b: 150, p: [false,false] },
      z: { e: false, v: [80,30], r: [20] }, k: { e: true, i: [75,30] },
      o: { a: 60, p: 60, d: 2400, s: 100, c: 60 }, l: Array(27).fill(0),
      m: { h: '', p: 1883, t: '', u: '', s: '' }, w: { s: 'Test WiFi', p: 'sample-only' }, t: ['', '', ''], g: 0,
    };
    let controller: ReadableStreamDefaultController;
    const port: any = {
      readable: null, writable: null,
      async open() {
        this.readable = new ReadableStream({ start(c) { controller = c; } });
        this.writable = new WritableStream({ write(chunk) {
          const command = new TextDecoder().decode(chunk).trim();
          const data = command === 'get:info' ? { event: 'device_info', hostname: 'alarm-test', fw: '2.0.5', ip: '192.168.4.1' }
            : (window as any).failConfig ? { status: 'NACK', reason: 'unavailable' } : { event: 'config', config };
          controller.enqueue(new TextEncoder().encode(JSON.stringify(data) + '\n'));
        } });
      },
      async close() { this.readable = null; this.writable = null; },
    };
    Object.defineProperty(navigator, 'serial', { value: { requestPort: async () => port } });
  });
  let assetRequests = 0;
  await page.route('**/api/release-asset?**', route => { assetRequests++; return route.abort(); });
  await page.goto('/');
  await page.getByRole('button', { name: 'Підключити через USB' }).click();
  await expect(page.getByText('Плату підключено, налаштування прочитано. Можна оновлювати.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Завантажити резервну копію налаштувань' })).toBeVisible();
  await page.evaluate(() => { (window as any).failConfig = true; });
  await page.getByRole('button', { name: 'Оновити й зберегти налаштування' }).click();
  await expect(page.locator('.flash-card [role=alert]')).toContainText('Запис не розпочато');
  await expect(page.getByRole('radio', { name: /Оновлення зі збереженням/ })).toBeChecked();
  expect(assetRequests).toBe(0);
  expect(errors).toEqual([]);
});
