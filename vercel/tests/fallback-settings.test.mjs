import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const source = readFileSync(new URL('../app/fallback-settings.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } });
const { normalizeFallbackUrl, supportsFallback } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
test('reserve URL normalization and transport restrictions', () => {
  assert.equal(normalizeFallbackUrl('  '), '');
  assert.equal(normalizeFallbackUrl(' https://example.com '), 'https://example.com/');
  assert.equal(normalizeFallbackUrl('http://192.168.1.2:8766/alerts'), 'http://192.168.1.2:8766/alerts');
  for (const url of ['ftp://host/x', 'https://user:pass@host/', 'https://host/#x', 'http://[::1]/', 'http://host:99999/', 'http://host/a b', 'http://host/\\x', 'https://host/' + 'x'.repeat(255)]) {
    assert.throws(() => normalizeFallbackUrl(url), url);
  }
});
test('only compatible firmware can receive reserve settings', () => {
  for (const version of ['2.0.7', 'v2.0.7', '2.0.7-dev', '2.1.0', '3.0.0']) assert.ok(supportsFallback(version), version);
  for (const version of ['2.0.6', '1.9.9', '', 'unknown', '2.0.7garbage']) assert.ok(!supportsFallback(version), version);
});
