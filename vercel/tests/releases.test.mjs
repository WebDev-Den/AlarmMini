import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../app/api/releases/route.ts', import.meta.url), 'utf8');
function handler(fetch) {
  return vm.runInNewContext(source.replace('export async function GET', 'async function GET') + '\nGET;', {
    fetch, Response, AbortSignal, process: { env: {} },
  });
}

test('installer returns only the GitHub latest stable release in its existing array contract', async () => {
  const release = { id: 13, tag_name: 'v2.1.3', draft: false, prerelease: false, assets: [] };
  const get = handler(async (url) => {
    assert.equal(url, 'https://api.github.com/repos/WebDev-Den/AlarmMini/releases/latest');
    return Response.json(release);
  });
  const response = await get();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), [release]);
});

test('no supported release is an empty list; GitHub failures never fall back to old versions', async () => {
  const missing = await handler(async () => new Response(null, { status: 404 }))();
  assert.deepEqual(await missing.json(), []);
  for (const payload of [null, [], {}, { tag_name: 'v3', draft: true }, { tag_name: 'v3-beta', prerelease: true }]) {
    const response = await handler(async () => Response.json(payload))();
    assert.equal(response.status, 502);
  }
  assert.equal((await handler(async () => new Response(null, { status: 403 }))()).status, 502);
  assert.equal((await handler(async () => { throw new Error('offline'); })()).status, 502);
});
