import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { request as httpRequest, type RequestOptions } from "node:http";
import { request as httpsRequest } from "node:https";
import { normalizeFallbackUrl, normalizeFallbackToken, validateFallbackBody } from "./fallback-settings";

export function isPublicIpv4(address: string): boolean {
  if (isIP(address) !== 4) return false;
  const [a, b, c] = address.split(".").map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113));
}

const privateMessage = "Сайт може перевірити лише публічний URL. Локальні адреси на кшталт 192.168.x.x або localhost недоступні серверу перевірки.";
const timeoutMessage = "Сервер не відповів за 8 секунд. Перевір його доступність і повтори спробу.";
type Dependencies = {
  token?: string;
  resolve?: (host: string) => Promise<{ address: string; family: number }[]>;
  request?: typeof httpRequest;
  timeoutMs?: number;
};

export async function probeFallbackUrl(value: string, dependencies: Dependencies = {}): Promise<string> {
  const normalized = normalizeFallbackUrl(value);
  const token = normalizeFallbackToken(dependencies.token ?? "");
  if (!normalized) throw new Error("Введи резервний URL для перевірки.");
  const url = new URL(normalized);
  if (isIP(url.hostname) && !isPublicIpv4(url.hostname)) throw new Error(privateMessage);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), dependencies.timeoutMs ?? 8000);
  let abortDns: () => void = () => {};
  try {
    const resolve = dependencies.resolve ?? ((host: string) => dnsLookup(host, { all: true, family: 4 }));
    const addresses = await Promise.race([
      isIP(url.hostname) ? Promise.resolve([{ address: url.hostname, family: 4 }]) : resolve(url.hostname),
      new Promise<never>((_, reject) => {
        abortDns = () => reject(new Error(timeoutMessage));
        controller.signal.addEventListener("abort", abortDns, { once: true });
      }),
    ]);
    // Reject mixed public/private answers as well. The HTTP connection uses this
    // exact checked address; a second DNS lookup cannot rebind it to a private IP.
    if (!addresses.length || addresses.some(({ address }) => !isPublicIpv4(address))) throw new Error(privateMessage);
    const pinned = addresses[0];
    const lookup: RequestOptions["lookup"] = (_hostname, options, callback) => {
      if (options.all) callback(null, [pinned]);
      else callback(null, pinned.address, 4);
    };
    const transport = dependencies.request ?? (url.protocol === "https:" ? httpsRequest : httpRequest);
    await new Promise<void>((resolveRequest, reject) => {
      const req = transport(url, {
        method: "GET", agent: false, lookup, family: 4, maxHeaderSize: 4096,
        signal: controller.signal,
        headers: { Accept: "application/json", "Accept-Encoding": "identity", "Cache-Control": "no-cache", Connection: "close", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      }, (response) => {
        void (async () => {
          try {
            if (response.statusCode !== 200) {
              if (response.statusCode === 401 || response.statusCode === 403) throw new Error(`HTTP ${response.statusCode}: сервер відхилив авторизацію. Перевір токен та його права доступу.`);
              if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400) throw new Error("URL перенаправляє на іншу адресу. Введи кінцевий URL без перенаправлення.");
              throw new Error(`Сервер повернув HTTP ${response.statusCode ?? "помилку"}. Потрібна відповідь HTTP 200.`);
            }
            const encoding = response.headers["content-encoding"];
            if (encoding && encoding !== "identity") throw new Error("Сервер стискає відповідь. Для плати потрібна відповідь без gzip або іншого стиснення.");
            if (Number(response.headers["content-length"]) > 256) throw new Error("Відповідь перевищує 256 байтів — плата не зможе її прийняти.");
            const chunks: Buffer[] = [];
            let length = 0;
            for await (const chunk of response) {
              length += chunk.length;
              if (length > 256) throw new Error("Відповідь перевищує 256 байтів — плата не зможе її прийняти.");
              chunks.push(Buffer.from(chunk));
            }
            if (!response.complete) throw new Error("Сервер надіслав неповну відповідь. Повтори перевірку.");
            validateFallbackBody(Buffer.concat(chunks).toString("utf8"));
            resolveRequest();
          } catch (error) { reject(error); }
          finally { response.destroy(); }
        })();
      });
      req.once("error", reject);
      req.once("upgrade", (_response, socket) => { socket.destroy(); reject(new Error("Потрібна звичайна HTTP-відповідь з JSON-масивом.")); });
      req.end();
    });
    return normalized;
  } catch (error) {
    if (controller.signal.aborted) throw new Error(timeoutMessage);
    // Do not expose upstream URLs, credentials, response bodies, or raw socket errors.
    if (error && typeof error === "object" && "code" in error) {
      const code = String(error.code);
      if (/CERT|TLS|SSL|SELF_SIGNED/.test(code)) throw new Error("HTTPS-сертифікат сервера не пройшов перевірку. Виправ сертифікат перед записом URL.");
      throw new Error("Не вдалося підключитися до сервера. Перевір домен, порт і доступність через інтернет.");
    }
    throw error;
  } finally {
    clearTimeout(timer);
    controller.signal.removeEventListener("abort", abortDns);
  }
}
