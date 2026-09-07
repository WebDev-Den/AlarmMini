import { test, expect, type Page } from '@playwright/test';

const release = { id: 1, name: 'v2.0.8', tag_name: 'v2.0.8', published_at: '2026-09-07T12:00:00Z', assets: ['esp32c3-firmware', 'esp32c3-littlefs', 'esp32c3-bootloader', 'esp32c3-partitions', 'esp32c3-boot-app0', 'esp8266-firmware', 'esp8266-littlefs'].map((name, id) => ({ id, name: `${name}.bin`, size: 1024, browser_download_url: `https://github.com/WebDev-Den/AlarmMini/releases/download/v2.0.8/${name}.bin` })) };
test.beforeEach(async ({ page }) => {
  await page.route('**/api/releases', route => route.fulfill({ json: [release] }));
});

async function fakeDevice(page: Page) {
  await page.addInitScript(() => {
    const config: any = {
      c: { d: { a: [255,0,0,255], c: [0,80,0,80] }, n: { a: [25,0,0,24], c: [0,0,0,0] } },
      n: { e: true, s: [22,0], x: [8,0], b: 150, p: [false,false] },
      z: { e: false, v: [80,30], r: [20] }, k: { e: true, i: [75,30] },
      o: { a: 60, p: 60, d: 2400, s: 100, c: 60 }, l: Array(27).fill(0),
      m: { h: 'mqtt.test', p: 1883, t: 'alerts', u: '', s: '' }, w: { s: 'Test WiFi', p: 'test-only' }, t: ['', '', ''], g: 0,
    };
    (window as any).serialCommands = [];
    let controller: ReadableStreamDefaultController;
    const reply=(data: object)=>controller.enqueue(new TextEncoder().encode(JSON.stringify(data)+'\n'));
    const port: any = {
      readable: null, writable: null,
      async open() {
        this.readable=new ReadableStream({start(c){controller=c;}});
        this.writable=new WritableStream({write(chunk){
          const command=new TextDecoder().decode(chunk).trim();
          (window as any).serialCommands.push(command);
          if(command==='get:info') reply({event:'device_info',hostname:'alarm-test',fw:'2.0.8',ip:'192.168.1.2'});
          else if(command==='get:config') reply({event:'config',config});
          else if(command.startsWith('{')) {
            const message=JSON.parse(command);
            if(message.cmd==='fallback_set') {
              if(message.url) config.fu=message.url; else delete config.fu;
              reply({status:'ACK',cmd:'fallback_set'});
            }
          }
        }});
      },
      async close(){this.readable=null;this.writable=null;},
    };
    Object.defineProperty(navigator,'serial',{value:{requestPort:async()=>port}});
  });
}

test('manual validation shows success, invalidates changed URLs, and ignores late replies', async ({page}) => {
  let finish: (()=>void) | undefined;
  await page.route('**/api/fallback-validation',async route=>{
    const {url}=route.request().postDataJSON();
    if(url.includes('slow')) await new Promise<void>(resolve=>{finish=resolve;});
    await route.fulfill({json:{ok:true,url,count:25}}).catch(()=>{});
  });
  await page.goto('/'); await page.locator('.reserve-settings summary').click();
  const input=page.locator('#install-fallback-url');
  const check=page.locator('.reserve-settings').getByRole('button',{name:'Перевірити URL',exact:true});
  const result=page.locator('#install-fallback-url-result');
  await input.fill('https://valid.test/alerts'); await check.click();
  await expect(result).toContainText('Перевірено: HTTP 200');
  await input.fill('https://slow.test/alerts'); await expect(result).toBeEmpty(); await check.click();
  await expect(result).toContainText('Перевіряємо');
  await expect.poll(()=>Boolean(finish)).toBe(true);
  await input.fill('https://changed.test/alerts'); finish!();
  await expect(result).toBeEmpty();
  await expect(check).toBeEnabled();
});

test('failed preflight blocks firmware downloads and all device writes', async ({page}) => {
  await fakeDevice(page);
  await page.route('**/api/fallback-validation',route=>route.fulfill({status:422,json:{ok:false,error:'Сервер повернув HTTP 503.'}}));
  let downloads=0;
  await page.route('**/api/release-asset?**',route=>{downloads++;return route.abort();});
  await page.goto('/'); await page.locator('.reserve-settings summary').click();
  await page.locator('#install-fallback-url').fill('https://offline.test/alerts');
  await page.getByRole('button',{name:'Підключити через USB'}).click();
  await page.getByRole('button',{name:'Оновити й зберегти налаштування'}).click();
  await expect(page.locator('.flash-card [role=alert]')).toContainText('HTTP 503');
  expect(downloads).toBe(0);
  expect(await page.evaluate(()=>(window as any).serialCommands.filter((c:string)=>!c.startsWith('get:')))).toEqual([]);
});

test('saving rechecks a previously valid URL, writes only after success and permits clearing offline', async ({page}) => {
  await fakeDevice(page);
  let available=true, checks=0;
  await page.route('**/api/fallback-validation',route=>{
    checks++;const {url}=route.request().postDataJSON();
    return route.fulfill({status:available?200:422,json:available?{ok:true,url,count:25}:{ok:false,error:'Сервер повернув HTTP 503.'}});
  });
  await page.goto('/'); await page.getByRole('button',{name:'Підключити через USB'}).click();
  await page.locator('.advanced-settings > summary').click();
  await page.getByRole('tab',{name:'MQTT',exact:true}).click();
  const input=page.locator('#fallback-url'); const field=page.locator('.fallback-field').filter({has:input});
  await input.fill('https://reserve.test/alerts');
  await field.getByRole('button',{name:'Перевірити URL',exact:true}).click();
  await expect(page.locator('#fallback-url-result')).toContainText('Перевірено');
  available=false;
  const save=page.getByRole('button',{name:'Зберегти резервний URL',exact:true});
  await save.click(); await expect(save).toBeEnabled();
  await expect.poll(()=>checks).toBe(2);
  expect(await page.evaluate(()=>(window as any).serialCommands.filter((c:string)=>c.includes('fallback_set')))).toEqual([]);
  await expect(input).toHaveValue('https://reserve.test/alerts');
  available=true; await save.click(); await expect(save).toBeEnabled();
  await expect.poll(async()=>await page.evaluate(()=>(window as any).serialCommands.filter((c:string)=>c.includes('fallback_set')).length)).toBe(1);
  await expect(input).toHaveValue('https://reserve.test/alerts');
  available=false;const before=checks; await input.fill('');await save.click();await expect(save).toBeEnabled();
  expect(checks).toBe(before);
  expect(await page.evaluate(()=>JSON.parse((window as any).serialCommands.filter((c:string)=>c.includes('fallback_set')).at(-1)).url)).toBe('');
});

test('validation endpoint rejects local destinations and bad request origins', async ({request}) => {
  const response=await request.post('/api/fallback-validation',{data:{url:'http://127.0.0.1/'}});
  expect(response.status()).toBe(422);expect((await response.json()).error).toContain('публічний URL');
  const crossOrigin=await request.post('/api/fallback-validation',{headers:{Origin:'https://unrelated.test'},data:{url:'https://example.com/'}});
  expect(crossOrigin.status()).toBe(403);
});
