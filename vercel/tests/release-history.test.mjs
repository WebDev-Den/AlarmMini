import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const history = JSON.parse(readFileSync(new URL('../app/release-history.json', import.meta.url), 'utf8'));
const firmware = readFileSync(new URL('../../firmware/src/config.h', import.meta.url), 'utf8').match(/FIRMWARE_VERSION\s+"([^"]+)"/)[1];

test('every new firmware release has dated Ukrainian and English notes', () => {
  assert.equal(history[0].version, firmware, 'Add release notes before publishing a new firmware version');
  assert.equal(new Set(history.map(entry => entry.version)).size, history.length);
  for (const entry of history) {
    assert.match(entry.version, /^\d+\.\d+\.\d+$/);
    assert.ok(Number.isFinite(Date.parse(entry.date)));
    assert.ok(entry.ua.length > 0);
    assert.equal(entry.ua.length, entry.en.length);
    for (const text of [...entry.ua, ...entry.en]) assert.ok(text.trim());
  }
});
