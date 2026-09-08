export function normalizeFallbackUrl(value: string): string {
  const input = value.trim();
  if (!input) return "";
  let url: URL;
  try { url = new URL(input); } catch { throw new Error("Введи повну адресу резервного API: https://example.com/alerts.json"); }
  if (!/^https?:\/\//i.test(input) || !["http:", "https:"].includes(url.protocol) || url.username || url.password || input.includes("#") || /[\s\\]/.test(input) || url.port === "0") {
    throw new Error("Резервний URL має починатися з http:// або https://, без логіна, пароля, пробілів чи #.");
  }
  if (url.hostname.includes(":")) throw new Error("Для резерву використай домен або IPv4-адресу.");
  if (new TextEncoder().encode(url.href).length > 255) throw new Error("Резервний URL має вміщуватися у 255 байтів.");
  return url.href;
}

export function validateFallbackBody(body: string, maxState = 255): void {
  if (new TextEncoder().encode(body).length > 256) throw new Error("Відповідь перевищує 256 байтів — плата не зможе її прийняти.");
  // Match the firmware parser exactly, including JSON whitespace and numeric tokens.
  if (!/^[ \t\r\n]*\[[ \t\r\n]*(?:0|[1-9][0-9]{0,2})(?:[ \t\r\n]*,[ \t\r\n]*(?:0|[1-9][0-9]{0,2})){24}[ \t\r\n]*\][ \t\r\n]*$/.test(body) || JSON.parse(body).some((state: number) => state > 255)) {
    throw new Error("Сервер має повернути JSON-масив рівно з 25 чисел від 0 до 255, без інших полів.");
  }
  if (JSON.parse(body).some((state: number) => state > maxState)) throw new Error("Сервер повертає стани 2–255. Потрібна прошивка 2.1.0 або новіша; для старої плати використай URL зі станами 0/1.");
}

export function normalizeFallbackToken(value: string): string {
  const token = value.trim();
  if (token.length > 511 || /[^\x21-\x7e]/.test(token)) throw new Error("Введи лише токен без Bearer: до 511 символів ASCII, без пробілів і перенесень рядка.");
  return token;
}

export async function verifyFallbackEndpoint(value: string, tokenValue = "", signal?: AbortSignal, firmwareVersion = ""): Promise<string> {
  const url = normalizeFallbackUrl(value);
  if (!url) return ""; // Clearing an existing reserve never needs the old server.
  const token = normalizeFallbackToken(tokenValue);
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, 12000);
  try {
    const response = await fetch("/api/fallback-validation", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, token, firmwareVersion }), cache: "no-store", signal: controller.signal,
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || result?.ok !== true || result.url !== url) {
      throw new Error(result?.error || "Не вдалося перевірити сервер. Спробуй ще раз перед записом URL.");
    }
    return url;
  } catch (error) {
    if (controller.signal.aborted && !signal?.aborted) throw new Error("Перевірка триває задовго. Спробуй ще раз перед записом URL.");
    if (error instanceof TypeError) throw new Error("Немає зв’язку із сервісом перевірки. Перевір інтернет і повтори спробу.");
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

export function supportsFallback(version: string): boolean {
  const match = version.match(/^v?(\d+)\.(\d+)\.(\d+)(?:$|-)/);
  if (!match) return false;
  const [, major, minor, patch] = match.map(Number);
  return major > 2 || (major === 2 && (minor > 0 || patch >= 7));
}

export function supportsFallbackToken(version: string): boolean {
  const match = version.match(/^v?(\d+)\.(\d+)\.(\d+)(?:$|-)/);
  if (!match) return false;
  const [, major, minor, patch] = match.map(Number);
  return major > 2 || (major === 2 && (minor > 0 || patch >= 9));
}

export function supportsMultiState(version: string): boolean {
  const match = version.match(/^v?(\d+)\.(\d+)\.(\d+)(?:$|-)/);
  if (!match) return false;
  return Number(match[1]) > 2 || (Number(match[1]) === 2 && Number(match[2]) >= 1);
}
