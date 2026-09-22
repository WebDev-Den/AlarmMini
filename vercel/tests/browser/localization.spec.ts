import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const release = { id: 1, name: 'v2.1.3', tag_name: 'v2.1.3', published_at: '2026-09-22T12:00:00Z', assets: ['esp32c3-firmware', 'esp32c3-littlefs', 'esp32c3-bootloader', 'esp32c3-partitions', 'esp32c3-boot-app0', 'esp8266-firmware', 'esp8266-littlefs'].map((name, id) => ({ id, name: `${name}.bin`, size: 1024, browser_download_url: `https://example.com/${name}.bin` })) };
const webRoot = path.resolve('../firmware/work_data');
const config = JSON.parse(readFileSync(path.join(webRoot, 'config.example.json'), 'utf8'));

test('language changes preserve form data and consent, translate errors, and persist after reload', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/releases', route => route.fulfill({ json: [release] }));
  await page.route('**/api/fallback-validation', route => route.fulfill({ status: 400, json: { error: 'Сервер повернув HTTP 503. Потрібна відповідь HTTP 200.' } }));
  await page.goto('/');
  await page.getByRole('radio', { name: /Перше встановлення/ }).check();
  await page.getByRole('checkbox', { name: /Розумію/ }).check();
  await page.locator('.reserve-settings > summary').click();
  await page.locator('#install-fallback-url').fill('https://example.com/alerts.json');
  await page.locator('#install-fallback-url-token').fill('keep-this-token');
  await page.getByRole('button', { name: 'English', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('radio', { name: /First installation/ })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: /I understand/ })).toBeChecked();
  await expect(page.locator('#install-fallback-url')).toHaveValue('https://example.com/alerts.json');
  await expect(page.locator('#install-fallback-url-token')).toHaveValue('keep-this-token');
  await page.getByRole('button', { name: 'Check URL', exact: true }).click();
  await expect(page.locator('#install-fallback-url-result')).toHaveText('The server returned HTTP 503. An HTTP 200 response is required.');
  await page.getByRole('button', { name: 'Українська', exact: true }).click();
  await expect(page.locator('#install-fallback-url-result')).toHaveText('Сервер повернув HTTP 503. Потрібна відповідь HTTP 200.');
  await page.getByRole('button', { name: 'English', exact: true }).click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Your map.');
  expect(errors).toEqual([]);
});

test('language selection works when persistent storage is unavailable', async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => { throw new DOMException('Blocked', 'SecurityError'); };
    Storage.prototype.setItem = () => { throw new DOMException('Blocked', 'SecurityError'); };
  });
  await page.route('**/api/releases', route => route.fulfill({ json: [release] }));
  await page.goto('/');
  await page.getByRole('button', { name: 'English', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Your map.');
  await page.getByRole('button', { name: 'Українська', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Твоя карта.');
});

test('both languages fit mobile, tablet and desktop, including the expanded settings and editor', async ({ page }) => {
  await page.route('**/api/releases', route => route.fulfill({ json: [release] }));
  await page.addInitScript(() => { delete (Navigator.prototype as any).serial; });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.locator('.advanced-settings > summary').click();
  for (const language of ['English', 'Українська']) {
    await page.getByRole('button', { name: language, exact: true }).click();
    for (const width of [320, 390, 768, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      for (const button of await page.locator('.language-switcher button').all()) {
        const box = await button.boundingBox();
        expect(box!.width).toBeGreaterThanOrEqual(44); expect(box!.height).toBeGreaterThanOrEqual(44);
      }
    }
  }
  await page.setViewportSize({ width: 320, height: 640 });
  await page.getByRole('button', { name: 'English', exact: true }).click();
  await page.getByRole('tab', { name: 'Wi‑Fi', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'MQTT', exact: true })).toBeFocused();
  await expect(page.getByRole('tab', { name: 'MQTT', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Home');
  await expect(page.getByRole('tab', { name: 'Wi‑Fi', exact: true })).toBeFocused();
  await expect(page.getByText('To flash firmware, open this site in Chrome or Edge on a computer.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Open configuration editor', exact: true }).click();
  await expect(page.locator('.cm-editor')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
});

async function mockDevice(page: import('@playwright/test').Page, authenticated = true) {
  await page.route('http://device.test/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/session') return route.fulfill({ json: { authenticated } });
    if (url.pathname === '/api/info') return route.fulfill({ json: { hostname: 'alarmmini', ip: '192.168.1.10', adminPassword: 'Пароль', apSsid: 'Відбій', regions: ['Вінницька область', 'Волинська область'], maxLeds: 27, mqttHost: 'mqtt.example.com', mqttPort: 1883, mqttTopic: 'ukraine/alarm/map/full_v2' } });
    if (url.pathname === '/api/config') return route.fulfill({ json: config });
    if (url.pathname === '/health') return route.fulfill({ json: { wifiConnected: true, mqttConnected: true, alertsFresh: true } });
    if (url.pathname === '/api/alerts') return route.fulfill({ json: Array(25).fill(0) });
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: { ok: true } });
    const file = path.join(webRoot, url.pathname === '/' ? 'index.html' : url.pathname);
    return existsSync(file) ? route.fulfill({ path: file }) : route.fulfill({ status: 404 });
  });
}

test('device languages preserve credentials, unsaved drafts and region identifiers on mobile', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const fillText = CanvasRenderingContext2D.prototype.fillText;
    (window as any).labelTexts = [];
    CanvasRenderingContext2D.prototype.fillText = function (...args: Parameters<typeof fillText>) {
      (window as any).labelTexts.push(args[0]);
      return fillText.apply(this, args);
    };
  });
  await mockDevice(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('http://device.test/');
  await expect(page.locator('body')).not.toHaveClass(/is-loading|auth-locked/);
  await page.locator('[data-tab="mqtt"]').click();
  await page.locator('#mqttHost').fill('draft.example.com');
  await page.locator('.sidebar [data-locale="en"]').click();
  await expect(page.locator('#mqttHost')).toHaveValue('draft.example.com');
  await expect(page.locator('#saveBtn')).toHaveText('Save');
  for (const tab of ['overview', 'colors', 'night', 'mqtt', 'system', 'calibration', 'label']) {
    await page.locator(`[data-tab="${tab}"]`).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const cyrillic = await page.locator(`#tab-${tab}`).evaluate(root => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const result: string[] = [];
      while (walker.nextNode()) {
        const el = walker.currentNode.parentElement!;
        if (el.closest('[translate="no"], script, style, code, textarea')) continue;
        if (el.getBoundingClientRect().height && /[А-Яа-яІіЇїЄє]/.test(walker.currentNode.textContent || '')) result.push(walker.currentNode.textContent!);
      }
      return result;
    });
    expect(cyrillic, tab).toEqual([]);
  }
  await expect(page.locator('#labelAdminPassword')).toHaveText('Пароль');
  await expect(page.locator('#labelApSsid')).toHaveText('Відбій');
  await expect.poll(() => page.evaluate(() => (window as any).labelTexts.includes('No password'))).toBe(true);
  expect(await page.evaluate(() => (window as any).labelTexts.includes('Пароль'))).toBe(true);
  await expect(page.locator('#supportAuthorBtn')).not.toBeVisible();
  await page.locator('.sidebar-tools > summary').click();
  await expect(page.locator('#supportAuthorBtn')).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.locator('.sidebar-tools > summary')).not.toBeVisible();
  await expect(page.locator('#supportAuthorBtn')).toBeVisible();
  await page.setViewportSize({ width: 320, height: 740 });
  await page.locator('[data-tab="colors"]').click();
  await expect(page.getByRole('textbox', { name: 'RGBA: state 0, day', exact: true })).toBeVisible();
  await page.locator('[data-tab="calibration"]').click();
  await page.locator('#calStartBtn').click();
  await page.locator('[data-view="regions"]').click();
  await page.locator('#calRegionSearch').fill('Vinnytsia');
  await expect(page.locator('.cal-region-item:visible')).toHaveCount(1);
  await expect(page.locator('.cal-region-item:visible')).toHaveAttribute('data-region', 'Вінницька область');
  await page.locator('.sidebar [data-locale="ua"]').click();
  await expect(page.locator('#mqttHost')).toHaveValue('draft.example.com');
  expect(errors).toEqual([]);
});

test('device language is available before login and persists on reload', async ({ page }) => {
  await mockDevice(page, false);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('http://device.test/');
  await page.locator('.auth-card [data-locale="en"]').click();
  await expect(page.locator('.auth-title')).toHaveText('Sign in to the admin panel');
  await page.locator('#loginPassword').fill('never-translate');
  await page.locator('.auth-card [data-locale="ua"]').click();
  await expect(page.locator('#loginPassword')).toHaveValue('never-translate');
  await page.locator('.auth-card [data-locale="en"]').click();
  await page.reload();
  await expect(page.locator('.auth-title')).toHaveText('Sign in to the admin panel');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('Wi-Fi setup works in both languages without filesystem or internet access', async ({ page }) => {
  const startup = readFileSync(path.join(webRoot, '../src/startup.h'), 'utf8');
  const script = startup.match(/R"portaljs\((<script>[\s\S]*?<\/script>)\)portaljs"/)![1];
  const embedded = execFileSync('python', [path.join(webRoot, '../scripts/prepare_i18n.py')], { encoding: 'utf8' });
  // Render the actual ESP32 portal fragments, supplying only its dynamic device values.
  const fragment = startup.slice(startup.indexOf('    page.reserve(9000);'), startup.indexOf('    server.sendContent(page);'));
  let html = '';
  for (const match of fragment.matchAll(/page \+= (?:F\(("(?:[^"\\]|\\.)*")\)|R"rawliteral\(([\s\S]*?)\)rawliteral"|(_htmlEscape\([^;]+|savedSsid));/g)) {
    html += match[1] ? JSON.parse(match[1]) : match[2] ?? (match[3] === 'savedSsid' ? '' : 'AlarmMap-Setup-TEST');
  }
  html += embedded + script + '</main></body></html>';
  const errors: string[] = [], unexpected: string[] = [];
  let posted: any;
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', async route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/') return route.fulfill({ contentType: 'text/html; charset=utf-8', body: html });
    if (pathname === '/api/provision/status') return route.fulfill({ json: { ok: true, apSsid: 'AlarmMap-Setup-TEST', apIp: '192.168.4.1', connecting: false } });
    if (pathname === '/api/provision/networks') return route.fulfill({ json: { ok: true, scanning: false, networks: [{ ssid: 'Відбій', rssi: -40, auth: 'WPA2' }] } });
    if (pathname === '/api/provision/wifi') { posted = route.request().postDataJSON(); return route.fulfill({ status: 202, json: { ok: true, connecting: true } }); }
    unexpected.push(pathname); return route.abort();
  });
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('http://setup.test/');
  await page.getByRole('button', { name: 'English', exact: true }).click();
  await expect(page.locator('#scan')).toHaveText('Refresh Wi-Fi list');
  await expect(page.locator('#s')).toContainText('Select or enter a Wi-Fi network.');
  await page.locator('.net').click();
  await expect(page.locator('#ssid')).toHaveValue('Відбій');
  await page.locator('#password').fill('sample-password');
  await page.getByRole('button', { name: 'Українська', exact: true }).click();
  await expect(page.locator('#s')).toContainText('Вибери або введи Wi-Fi мережу.');
  await page.getByRole('button', { name: 'English', exact: true }).click();
  await page.locator('#f button').click();
  await expect.poll(() => posted).toEqual({ ssid: 'Відбій', password: 'sample-password' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(unexpected).toEqual([]);
  expect(errors).toEqual([]);
});
