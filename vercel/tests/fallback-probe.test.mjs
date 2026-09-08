import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer, request } from 'node:http';
import ts from 'typescript';

function moduleUrl(source) {
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
  return `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`;
}
const shared = moduleUrl(readFileSync(new URL('../app/fallback-settings.ts', import.meta.url), 'utf8'));
const server = moduleUrl(readFileSync(new URL('../app/fallback-probe.ts', import.meta.url), 'utf8').replace('"./fallback-settings"', JSON.stringify(shared)));
const { isPublicIpv4, probeFallbackUrl } = await import(server);
const { validateFallbackBody, verifyFallbackEndpoint } = await import(shared);
const states = JSON.stringify(Array(25).fill(0));

test('response parser accepts exactly the firmware numeric contract', () => {
  validateFallbackBody(states);
  for (const state of [2,3,4,10,255]) {
    const payload = JSON.stringify(Array(25).fill(state));
    validateFallbackBody(payload);
    assert.throws(() => validateFallbackBody(payload, 1), /2.1.0/);
  }
  for (const state of [256, -1, 1.5, '2', true]) assert.throws(() => validateFallbackBody(JSON.stringify(Array(25).fill(state))));
  assert.throws(() => validateFallbackBody(states.replace('0', '01')));
  validateFallbackBody(' \r\n' + JSON.stringify(Array(25).fill(1)) + '\t');
  for (const body of ['[]', '[0,1]', '{}', 'null', states + 'x', '\uFEFF' + states, states.replace('0', '-0'), states.replace('0', '0.0'), states.replace('0', '1e0'), states.replace('0', 'true'), states.replace('0', '"0"'), JSON.stringify(Array(26).fill(0)), ' '.repeat(256) + states]) {
    assert.throws(() => validateFallbackBody(body), body);
  }
});

test('private, reserved and unusual numeric IP forms never reach a socket', async () => {
  for (const address of ['0.0.0.0','10.1.2.3','127.0.0.1','169.254.169.254','172.16.1.2','172.31.255.255','192.168.1.1','100.64.0.1','198.18.0.1','192.0.0.8','192.0.2.1','198.51.100.2','203.0.113.1','224.0.0.1','255.255.255.255','::1','::ffff:127.0.0.1']) assert.equal(isPublicIpv4(address),false,address);
  for (const address of ['1.1.1.1','8.8.8.8','93.184.216.34','172.32.0.1']) assert.equal(isPublicIpv4(address),true,address);
  for (const host of ['127.1','0x7f000001','2130706433','169.254.169.254']) {
    await assert.rejects(probeFallbackUrl(`http://${host}/`, { request: () => assert.fail('must not connect') }), /публічний URL/);
  }
  await assert.rejects(probeFallbackUrl('https://mixed.test/', {
    resolve: async () => [{address:'1.1.1.1',family:4},{address:'10.0.0.1',family:4}],
    request: () => assert.fail('must not connect'),
  }), /публічний URL/);
});

test('real HTTP parser: pinned DNS, status, redirects, stream limits and truncation', async () => {
  let body=states, status=200, encoding='', truncate=false, hugeHeader=false;
  let requireAuth=false, seenAuthorization;
  const local=createServer((_req,res) => {
    seenAuthorization=_req.headers.authorization;
    res.statusCode=requireAuth && seenAuthorization!=='Bearer test-only-token' ? 401 : status;
    if (encoding) res.setHeader('Content-Encoding',encoding);
    if (status===302) res.setHeader('Location','http://127.0.0.1/private');
    if (hugeHeader) res.setHeader('X-Large','x'.repeat(5000));
    if (truncate) { res.setHeader('Content-Length',100); res.write(body); setImmediate(()=>res.destroy()); }
    else { res.write(body); res.end(); }
  });
  await new Promise(resolve=>local.listen(0,'127.0.0.1',resolve));
  let lookups=0, connections=0;
  const dependencies = {
    resolve:async()=>{lookups++;return [{address:'93.184.216.34',family:4}];},
    request:(url,options,callback)=>{
      connections++;
      assert.equal(url.hostname,'public.test');
      assert.equal(options.agent,false);
      assert.equal(options.headers['Accept-Encoding'],'identity');
      options.lookup('public.test',{},(error,address,family)=>{assert.equal(error,null);assert.equal(address,'93.184.216.34');assert.equal(family,4);});
      options.lookup('public.test',{all:true},(error,addresses)=>{assert.equal(error,null);assert.deepEqual(addresses,[{address:'93.184.216.34',family:4}]);});
      // Only this test adapter connects to the local fixture. Production always
      // connects to the checked public address using the supplied lookup.
      return request(`http://127.0.0.1:${local.address().port}/`,{...options,lookup:undefined},callback);
    },
  };
  try {
    assert.equal(await probeFallbackUrl('http://public.test/',dependencies),'http://public.test/');
    assert.equal(lookups,1); assert.equal(connections,1);
    assert.equal(seenAuthorization,undefined);
    requireAuth=true;
    await assert.rejects(probeFallbackUrl('http://public.test/',dependencies),/401.*авторизацію/);
    await assert.rejects(probeFallbackUrl('http://public.test/',{...dependencies,token:'wrong-test-token'}),/401.*авторизацію/);
    assert.equal(await probeFallbackUrl('http://public.test/',{...dependencies,token:'test-only-token'}),'http://public.test/');
    assert.equal(seenAuthorization,'Bearer test-only-token');
    requireAuth=false;
    body=JSON.stringify(Array(25).fill(255));
    await assert.rejects(probeFallbackUrl('http://public.test/',{...dependencies,maxState:1}),/2.1.0/);
    assert.equal(await probeFallbackUrl('http://public.test/',{...dependencies,maxState:255}),'http://public.test/');
    body=states;
    status=503; await assert.rejects(probeFallbackUrl('http://public.test/',dependencies),/HTTP 503/);
    status=302; const before=connections; await assert.rejects(probeFallbackUrl('http://public.test/',dependencies),/перенаправляє/); assert.equal(connections,before+1);
    status=200; body='[0,1]'; await assert.rejects(probeFallbackUrl('http://public.test/',dependencies),/25 чисел/);
    body=' '.repeat(257); await assert.rejects(probeFallbackUrl('http://public.test/',dependencies),/256 байтів/);
    body=states; encoding='gzip'; await assert.rejects(probeFallbackUrl('http://public.test/',dependencies),/стискає/);
    encoding=''; truncate=true; await assert.rejects(probeFallbackUrl('http://public.test/',dependencies));
    truncate=false; hugeHeader=true; await assert.rejects(probeFallbackUrl('http://public.test/',dependencies));
  } finally { local.closeAllConnections(); await new Promise(resolve=>local.close(resolve)); }
});

test('DNS and socket deadlines stop checks, TLS failures do not leak details', async () => {
  await assert.rejects(probeFallbackUrl('https://slow.test/', { resolve:()=>new Promise(()=>{}),timeoutMs:20 }),/8 секунд/);
  await assert.rejects(probeFallbackUrl('https://bad-cert.test/', {
    resolve:async()=>[{address:'1.1.1.1',family:4}],
    request:()=>{throw Object.assign(new Error('secret URL'),{code:'CERT_HAS_EXPIRED'});},
  }),/сертифікат/);
  const local=createServer(()=>{});
  await new Promise(resolve=>local.listen(0,'127.0.0.1',resolve));
  try {
    await assert.rejects(probeFallbackUrl('http://slow.test/', {
      timeoutMs:40, resolve:async()=>[{address:'1.1.1.1',family:4}],
      request:(_url,options,callback)=>request(`http://127.0.0.1:${local.address().port}/`,{...options,lookup:undefined},callback),
    }),/8 секунд/);
  } finally {local.closeAllConnections();await new Promise(resolve=>local.close(resolve));}
});

test('client only accepts validation for the exact URL, and clearing skips requests', async () => {
  const original=globalThis.fetch;
  let calls=0;
  try {
    globalThis.fetch=async(_path,options)=>{calls++;assert.equal(JSON.parse(options.body).token,'test-only-token');assert.equal(JSON.parse(options.body).firmwareVersion,'2.1.0');assert.equal(_path,'/api/fallback-validation');return Response.json({ok:true,url:JSON.parse(options.body).url});};
    assert.equal(await verifyFallbackEndpoint(' https://example.com ','test-only-token',undefined,'2.1.0'),'https://example.com/');
    assert.equal(await verifyFallbackEndpoint(''),'');assert.equal(calls,1);
    globalThis.fetch=async()=>Response.json({ok:true,url:'https://different.test/'});
    await assert.rejects(verifyFallbackEndpoint('https://example.com/'));
    globalThis.fetch=async()=>Response.json({ok:false,error:'HTTP 503'},{status:422});
    await assert.rejects(verifyFallbackEndpoint('https://example.com/'),/HTTP 503/);
  } finally {globalThis.fetch=original;}
});
