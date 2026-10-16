import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';

export function secureEqual(a, b) {
  const hash = text => createHash('sha256').update(text).digest();
  return timingSafeEqual(hash(a), hash(b));
}

function privateAddress(address = '') {
  const ip = address.toLowerCase().replace(/^\[|\]$/g, '').replace(/^::ffff:/, '');
  if (isIP(ip) === 4) {
    const [a,b] = ip.split('.').map(Number);
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  return isIP(ip) === 6 && (ip === '::1' || /^(fc|fd|fe[89ab])/.test(ip));
}

export function isLocalRequest(req, allowedHosts = []) {
  if (!privateAddress(req.socket.remoteAddress)) return false;
  // A tunnel connection can come from a LAN/loopback address. Do not treat it as local administration.
  if (['cf-connecting-ip', 'cf-ray', 'x-forwarded-for', 'x-forwarded-host', 'forwarded'].some(h => req.headers[h])) return false;
  const host = req.headers.host;
  if (!host || /[@/\\]/.test(host)) return false;
  try {
    const hostname = new URL(`http://${host}`).hostname.toLowerCase();
    return hostname === 'localhost' || privateAddress(hostname) || allowedHosts.includes(hostname);
  } catch { return false; }
}

export function createAdminAuth(config, now = Date.now) {
  const sessions = new Map();
  const failures = new Map();
  const salt = randomBytes(16);
  const passwordHash = scryptSync(config.adminPassword || '', salt, 32);
  const ttl = 8 * 60 * 60 * 1000;
  const enabled = Boolean(config.adminUser && config.adminPassword);
  function prune() {
    for (const [id, session] of sessions) if (session.expiresAt <= now()) sessions.delete(id);
    for (const [ip, entry] of failures) if (entry.expiresAt <= now()) failures.delete(ip);
  }
  function getSession(req) {
    prune();
    const id = (req.headers.cookie || '').split(';').map(v => v.trim()).find(v => v.startsWith('alarmmini_session='))?.slice(18);
    return id ? sessions.get(id) : undefined;
  }
  function cookie(id, secure, expires = ttl / 1000) {
    return `alarmmini_session=${id}; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=${expires}${secure ? '; Secure' : ''}`;
  }
  return {
    enabled, getSession,
    sameOrigin(req) {
      if (req.headers['sec-fetch-site'] === 'cross-site') return false;
      const origin = req.headers.origin;
      if (!origin) return true; // CLI clients are also supported, with JSON and a CSRF token.
      try { return new URL(origin).host === req.headers.host && /^https?:/.test(origin); }
      catch { return false; }
    },
    login(req, username, password) {
      prune();
      const ip = req.socket.remoteAddress;
      const previous = failures.get(ip);
      if (previous?.count >= 10) return {code:429};
      if (typeof username !== 'string' || typeof password !== 'string' || username.length > 256 || password.length > 1024) return {code:401};
      const validPassword = timingSafeEqual(scryptSync(password, salt, 32), passwordHash);
      if (!validPassword || !secureEqual(username, config.adminUser)) {
        if (failures.size >= 1000) failures.delete(failures.keys().next().value);
        failures.set(ip, {count:(previous?.count || 0) + 1, expiresAt:previous?.expiresAt || now() + 900000});
        return {code:401};
      }
      failures.delete(ip);
      const old = getSession(req);
      if (old) sessions.delete(old.id);
      if (sessions.size >= 100) sessions.delete(sessions.keys().next().value);
      const id = randomBytes(32).toString('hex');
      const session = {id, csrf:randomBytes(24).toString('hex'), expiresAt:now() + ttl};
      sessions.set(id, session);
      return {code:200, session, cookie:cookie(id, req.socket.encrypted)};
    },
    logout(req) {
      const session = getSession(req);
      if (session) sessions.delete(session.id);
      return cookie('', req.socket.encrypted, 0);
    },
    validCsrf(req, session) {
      const csrf = req.headers['x-csrf-token'];
      return typeof csrf === 'string' && secureEqual(csrf, session.csrf);
    },
  };
}
