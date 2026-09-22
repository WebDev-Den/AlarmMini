import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import core from '../../firmware/work_data/i18n-core.js';

const read = locale => JSON.parse(readFileSync(new URL(`../../firmware/work_data/locales/${locale}.json`, import.meta.url), 'utf8'));
const ua = read('ua'), en = read('en');
const t = core.createTranslator({ ua, en });

test('both editable JSON catalogs cover the same messages and preserve interpolation slots', () => {
  assert.deepEqual(Object.keys(ua).sort(), Object.keys(en).sort());
  for (const [key, value] of Object.entries(en)) {
    assert.ok(value.trim(), key);
    assert.doesNotMatch(value, /[А-Яа-яІіЇїЄєҐґ]/u, key);
    const slots = text => [...text.matchAll(/\{\d+\}/g)].map(match => match[0]).sort();
    assert.deepEqual(slots(value), slots(key), key);
    assert.deepEqual(slots(ua[key]), slots(key), key);
  }
});

test('messages translate after an asynchronous operation, including nested validation errors', () => {
  assert.equal(t('Записуємо прошивку: 42%. Не відключай USB.', 'en'), 'Writing firmware: 42%. Keep USB connected.');
  assert.equal(t('Помилка перевірки: JSON має помилки валідації', 'en'), 'Validation error: JSON has validation errors');
  assert.equal(t('Вінницька область: стан 3', 'en'), 'Vinnytsia Oblast: state 3');
  assert.equal(t('HTTP 401: сервер відхилив авторизацію. Перевір токен та його права доступу.', 'en'), 'HTTP 401: the server rejected authorization. Check the token and its permissions.');
  assert.equal(t('Web UI доступний: http://192.168.1.10 · heap=12000', 'en'), 'Web UI available: http://192.168.1.10 · heap=12000');
});

test('unsupported preferences fall back to Ukrainian and unknown technical content stays intact', () => {
  for (const value of [null, undefined, '', 'uk', 'de', '../en', {}]) assert.equal(core.normalizeLocale(value), 'ua');
  assert.equal(core.htmlLanguage('ua'), 'uk');
  assert.equal(core.htmlLanguage('en'), 'en');
  assert.equal(t('Зберегти', 'en'), 'Save');
  assert.equal(t('Зберегти', 'de'), 'Зберегти');
  for (const value of ['ukraine/alarm/map/full_v2', 'My Wi-Fi', 'http://alarmmini.local/?p=abc', 'rgba(255,160,0,0.5)']) assert.equal(t(value, 'en'), value);
});
