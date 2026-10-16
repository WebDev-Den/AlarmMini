import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { createHash, verify } from 'node:crypto';
import { createAdminAuth, isLocalRequest, secureEqual } from './admin.js';
import { AdminError, createSettings } from './settings.js';
import { createMonitor } from './monitor.js';
import { createDuckDns } from './duckdns.js';
import { createResources } from './resources.js';

const assets = new Map([
  ['/admin', ['index.html', 'text/html; charset=utf-8']],
  ['/admin/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/admin/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/admin/theme.js', ['theme.js', 'text/javascript; charset=utf-8']],
  ['/admin/map.svg', ['map.svg', 'image/svg+xml']],
].map(([path, [file, type]]) => [path, {type, body:readFileSync(new URL(`../public/${file}`, import.meta.url))}]));

export function createHttpServer(service, config, options = {}) {
  const now = options.now || Date.now;
  const monitor = options.monitor || service.monitor || createMonitor({now, log:options.log});
  const settings = options.settings || createSettings(config, {...options, monitor});
  const duckDns = options.duckDns || createDuckDns(config, {...options, monitor});
  const auth = createAdminAuth(config, now);
  const resources = options.resources || createResources(config);
  const seen = new Map();

  function tokenAuthorized(req, url, token) {
    if (!token) return false;
    if (req.headers.authorization) return secureEqual(req.headers.authorization, `Bearer ${token}`);
    const supplied = url.searchParams.getAll('token');
    return supplied.length === 1 && secureEqual(supplied[0], token);
  }

  async function readBody(req, limit = 65536) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > limit) throw new AdminError(413, 'BODY_TOO_LARGE');
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  async function readJson(req) {
    if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') throw new AdminError(415, 'JSON_REQUIRED');
    const body = await readBody(req, 8192);
    try {
      const parsed = JSON.parse(body.toString('utf8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
      return parsed;
    } catch { throw new AdminError(400, 'INVALID_JSON'); }
  }

  function verifyWebhook(req, body, key) {
    const signature = req.headers['x-webhook-signature'];
    const timestamp = req.headers['x-webhook-timestamp'];
    const algorithm = req.headers['x-webhook-signature-alg'];
    if (typeof signature !== 'string' || typeof timestamp !== 'string' || !/^\d+$/.test(timestamp)) return false;
    if (algorithm && (typeof algorithm !== 'string' || algorithm.toLowerCase() !== 'rsa-sha256')) return false;
    if (Math.abs(now() / 1000 - Number(timestamp)) > 300) return false;
    try { return verify('RSA-SHA256', Buffer.concat([Buffer.from(`${timestamp}.`), body]), key, Buffer.from(signature, 'base64')); }
    catch { return false; }
  }

  const server = createServer({requestTimeout:10000, headersTimeout:10000, maxHeaderSize:16384}, async (req, res) => {
    function raw(code, body, type, extraHeaders = {}) {
      res.writeHead(code, {
        'Content-Type':type, 'Cache-Control':'no-store', 'Content-Length':Buffer.byteLength(body),
        'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'no-referrer',
        'Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
        ...extraHeaders,
      });
      res.end(req.method === 'HEAD' ? undefined : body);
    }
    const send = (code, value, extraHeaders) => raw(code, JSON.stringify(value), 'application/json; charset=utf-8', extraHeaders);
    const methodAllowed = methods => {
      if (methods.includes(req.method)) return true;
      send(405, {error:{code:'METHOD_NOT_ALLOWED'}}, {Allow:methods.join(', ')});
      return false;
    };
    try {
      const url = new URL(req.url, 'http://localhost');
      const path = url.pathname.replace(/\/$/, '') || '/';
      const publicRoute = path === '/public/status' || path === '/public/webhook';
      // A tunnel can connect from a LAN IP; it is not local administration.
      if (!publicRoute && !isLocalRequest(req, config.adminAllowedHosts)) return send(404, {error:{code:'NOT_FOUND'}});
      if (path === '/') {
        if (!methodAllowed(['GET', 'HEAD'])) return;
        return raw(302, '', 'text/plain', {Location:'/admin'});
      }
      if (assets.has(path)) {
        if (!methodAllowed(['GET', 'HEAD'])) return;
        const asset = assets.get(path);
        return raw(200, asset.body, asset.type);
      }
      if (path.startsWith('/admin/api/')) {
        if (req.method !== 'GET' && !auth.sameOrigin(req)) return send(403, {error:{code:'ORIGIN_REJECTED'}});
        if (path === '/admin/api/login') {
          if (!methodAllowed(['POST'])) return;
          if (!auth.enabled) return send(503, {error:{code:'ADMIN_NOT_CONFIGURED'}});
          const body = await readJson(req);
          const result = auth.login(req, body.username, body.password);
          if (result.code !== 200) return send(result.code, {error:{code:result.code === 429 ? 'LOGIN_RATE_LIMITED' : 'INVALID_CREDENTIALS'}});
          return send(200, {username:config.adminUser, csrf:result.session.csrf}, {'Set-Cookie':result.cookie});
        }
        const session = auth.getSession(req);
        if (!session) return send(401, {error:{code:'LOGIN_REQUIRED'}});
        if (req.method !== 'GET' && !auth.validCsrf(req, session)) return send(403, {error:{code:'CSRF_REJECTED'}});
        if (path === '/admin/api/session') {
          if (!methodAllowed(['GET'])) return;
          return send(200, {username:config.adminUser, csrf:session.csrf});
        }
        if (path === '/admin/api/logout') {
          if (!methodAllowed(['POST'])) return;
          return send(200, {ok:true}, {'Set-Cookie':auth.logout(req)});
        }
        if (path === '/admin/api/state') {
          if (!methodAllowed(['GET'])) return;
          return send(200, service.status());
        }
        if (path === '/admin/api/diagnostics') {
          if (!methodAllowed(['GET'])) return;
          return send(200, {...monitor.view(), ...service.diagnostics?.(), resources:resources.view(), state:service.status()});
        }
        if (path === '/admin/api/logs/clear') {
          if (!methodAllowed(['POST'])) return;
          return send(200, monitor.clear());
        }
        if (path === '/admin/api/settings') {
          if (!methodAllowed(['GET', 'PUT'])) return;
          if (req.method === 'GET') return send(200, settings.view());
          const body = await readJson(req);
          if (typeof body.publicBaseUrl !== 'string') throw new AdminError(400, 'INVALID_PUBLIC_URL');
          return send(200, await settings.save(body.publicBaseUrl.trim()));
        }
        if (path === '/admin/api/duckdns') {
          if (!methodAllowed(['GET', 'PUT'])) return;
          return send(200, req.method === 'GET' ? duckDns.view() : await duckDns.save(await readJson(req)));
        }
        if (path === '/admin/api/duckdns/check' || path === '/admin/api/duckdns/update') {
          if (!methodAllowed(['POST'])) return;
          return send(200, await duckDns.run(path.endsWith('/check') ? 'check' : 'update'));
        }
        if (path === '/admin/api/webhook') {
          if (!methodAllowed(['POST'])) return;
          const body = await readJson(req);
          return send(200, await settings.manageWebhook(body.action));
        }
        if (path === '/admin/api/webhook-key') {
          if (!methodAllowed(['POST', 'PUT'])) return;
          if (req.method === 'PUT') {
            const body = await readJson(req);
            return send(200, await settings.importKey(body.pem));
          }
          return send(200, await settings.updateKey());
        }
        if (path === '/admin/api/webhook-check') {
          if (!methodAllowed(['POST'])) return;
          return send(200, await settings.checkWebhook());
        }
        return send(404, {error:{code:'NOT_FOUND'}});
      }
      if (path === '/public/webhook' || path === '/webhook/action') {
        if (!methodAllowed(['POST'])) return;
        function reject(code, reason) {
          monitor.receivedWebhook('rejected', reason);
          return send(code, {error:{code:reason}});
        }
        if (path === '/public/webhook') {
          if (!config.webhookToken) return reject(503, 'WEBHOOK_TOKEN_NOT_CONFIGURED');
          if (!tokenAuthorized(req, url, config.webhookToken)) return reject(401, 'UNAUTHORIZED');
        }
        if (path === '/public/webhook' && req.headers['x-alarmmini-probe'] !== undefined) {
          // Only an in-flight, single-use self-test can use this branch. It never changes alerts,
          // refreshes the API, or increments real provider webhook counters.
          const body = await readBody(req, 512);
          const proof = settings.acceptProbe(req.headers['x-alarmmini-probe'], body);
          return proof ? send(200, proof) : send(401, {error:{code:'WEBHOOK_PROBE_INVALID'}});
        }
        const key = settings.getPublicKey();
        if (!key) return reject(503, 'WEBHOOK_KEY_NOT_CONFIGURED');
        let body;
        try { body = await readBody(req); }
        catch (error) { return reject(error instanceof AdminError ? error.status : 400, error instanceof AdminError ? error.code : 'BODY_READ_FAILED'); }
        if (!verifyWebhook(req, body, key)) return reject(401, 'INVALID_SIGNATURE');
        try {
          const event = JSON.parse(body.toString('utf8'));
          if (!event || typeof event !== 'object' || Array.isArray(event)) throw new Error();
        } catch { return reject(400, 'INVALID_JSON'); }
        for (const [id, expiresAt] of seen) if (expiresAt <= now()) seen.delete(id);
        const id = createHash('sha256').update(req.headers['x-webhook-timestamp']).update(body).digest('hex');
        if (seen.has(id)) {
          monitor.receivedWebhook('duplicate');
          return send(200, {accepted:true, duplicate:true});
        }
        if (seen.size >= 1000) seen.delete(seen.keys().next().value);
        seen.set(id, now() + 600000);
        monitor.receivedWebhook('accepted');
        service.requestRefresh();
        return send(202, {accepted:true});
      }
      if (!['/health', '/alerts', '/api/status', '/public/status'].includes(path)) return send(404, {error:{code:'NOT_FOUND'}});
      if (!methodAllowed(['GET', 'HEAD'])) return;
      if (path !== '/health') {
        const token = config.publicStatusToken || config.httpToken;
        if (!token) return send(503, {error:{code:'PUBLIC_STATUS_TOKEN_NOT_CONFIGURED'}});
        if (!tokenAuthorized(req, url, token)) return send(401, {error:{code:'UNAUTHORIZED'}}, {'WWW-Authenticate':'Bearer'});
      }
      const status = service.status();
      if (path === '/health') {
        const ready = status.fresh && status.mqtt !== 'disconnected';
        return send(ready ? 200 : 503, {ready, fresh:status.fresh, mqtt:status.mqtt, updatedAt:status.updatedAt});
      }
      if (path === '/api/status') return send(200, status);
      if (!status.fresh) return send(503, {error:{code:'DATA_UNAVAILABLE_OR_STALE'}}, {'Retry-After':'5'});
      return send(200, status.states);
    } catch (error) {
      if (!res.headersSent) send(error instanceof AdminError ? error.status : 500, {error:{code:error instanceof AdminError ? error.code : 'REQUEST_FAILED'}});
      else res.destroy();
    }
  });
  server.once('listening', () => { duckDns.start(); resources.start(); });
  server.once('close', () => { duckDns.stop(); resources.stop(); });
  return server;
}
