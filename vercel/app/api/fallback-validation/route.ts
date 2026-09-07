import { probeFallbackUrl } from "../../fallback-probe";

export const runtime = "nodejs";
export const maxDuration = 15;
const requests = new Map<string, { count: number; until: number }>();
const reply = (body: object, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return reply({ ok: false, error: "Перевірку потрібно запускати зі сторінки інсталятора." }, 403);
  if (!request.headers.get("content-type")?.startsWith("application/json")) return reply({ ok: false, error: "Очікується JSON з URL." }, 415);
  const now = Date.now();
  for (const [key, value] of requests) if (value.until < now) requests.delete(key);
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
  const budget = requests.get(ip) || { count: 0, until: now + 60000 };
  if (budget.count >= 20 || (requests.size >= 2048 && !requests.has(ip))) return reply({ ok: false, error: "Забагато перевірок. Спробуй через хвилину." }, 429);
  budget.count++; requests.set(ip, budget);
  try {
    // Bound chunked request bodies too, not only the Content-Length header.
    if (Number(request.headers.get("content-length")) > 2048) throw new Error("Запит завеликий.");
    const reader = request.body?.getReader();
    if (!reader) throw new Error("Введи URL для перевірки.");
    let body = "", length = 0;
    const decoder = new TextDecoder();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > 2048) throw new Error("Запит завеликий.");
        body += decoder.decode(value, { stream: true });
      }
      body += decoder.decode();
    } finally { await reader.cancel(); }
    let input;
    try { input = JSON.parse(body); } catch { throw new Error("Очікується JSON з URL."); }
    if (typeof input?.url !== "string") throw new Error("Введи URL для перевірки.");
    const url = await probeFallbackUrl(input.url);
    return reply({ ok: true, url, count: 25 });
  } catch (error) {
    return reply({ ok: false, error: error instanceof Error ? error.message : "Не вдалося перевірити URL." }, 422);
  }
}
