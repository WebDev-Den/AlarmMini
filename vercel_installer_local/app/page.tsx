"use client";

import { createElement, useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";

type ReleaseAsset = {
  id: number;
  name: string;
  browser_download_url: string;
  size: number;
};

type GithubRelease = {
  id: number;
  name: string;
  tag_name: string;
  published_at: string;
  body: string;
  assets: ReleaseAsset[];
};

type BoardSnapshot = {
  wifiStatus: string;
  mqttStatus: string;
  internetStatus: string;
  ip: string;
  mdnsUrl: string;
  adminPassword: string;
  firmwareVersion: string;
  hostname: string;
  lastLine: string;
};

const owner = process.env.NEXT_PUBLIC_GITHUB_OWNER;
const repo = process.env.NEXT_PUBLIC_GITHUB_REPO;
const SUPPORT_AUTHOR_URL = "https://send.monobank.ua/jar/2PMhPjRk9j";
const TELEGRAM_GROUP_URL = "https://t.me/+j3zFZHE5gGoyNGYy";
const PROJECT_REPO_URL = "https://github.com/WebDev-Den/AlarmMini";

const EMPTY_BOARD: BoardSnapshot = {
  wifiStatus: "Очікує підключення",
  mqttStatus: "Невідомо",
  internetStatus: "Невідомо",
  ip: "-",
  mdnsUrl: "-",
  adminPassword: "-",
  firmwareVersion: "-",
  hostname: "-",
  lastLine: "-",
};

function formatDate(iso: string) {
  try {
    return new Intl.DateTimeFormat("uk-UA", {
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function formatBytes(size: number) {
  if (!size) return "0 B";
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(2)} MB`;
  if (size >= 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${size} B`;
}

function applySerialLine(line: string, current: BoardSnapshot): BoardSnapshot {
  const next = { ...current, lastLine: line };

  const firmwareMatch = line.match(/AlarmMini firmware\s+(.+?)\s*=*$/i);
  if (firmwareMatch) next.firmwareVersion = firmwareMatch[1].trim();

  const wifiMatch = line.match(/\[WiFi\]\s+OK IP:\s*([0-9.]+)/i);
  if (wifiMatch) {
    next.wifiStatus = "Підключено";
    next.internetStatus = "Ймовірно онлайн";
    next.ip = wifiMatch[1];
  }

  if (/\[WiFi\].*AP/i.test(line)) next.wifiStatus = "AP режим";
  if (/\[WiFi\].*(disconnect|failed|lost)/i.test(line))
    next.wifiStatus = "Немає Wi‑Fi";

  const adminMatch = line.match(/\[Admin\]\s+Password:\s*(\S+)/i);
  if (adminMatch) next.adminPassword = adminMatch[1];

  const mdnsMatch = line.match(/\[mDNS\]\s+(https?:\/\/\S+)/i);
  if (mdnsMatch) {
    next.mdnsUrl = mdnsMatch[1];
    try {
      next.hostname = new URL(mdnsMatch[1]).hostname;
    } catch {
      next.hostname = mdnsMatch[1];
    }
  }

  if (/\[MQTT\].*Connected/i.test(line)) next.mqttStatus = "Підключено";
  if (/\[MQTT\].*(Disconnected|offline|failed|lost)/i.test(line))
    next.mqttStatus = "Немає з'єднання";

  if (/\[Internet\].*(online|ok)/i.test(line)) next.internetStatus = "Онлайн";
  if (/\[Internet\].*(offline|lost|failed)/i.test(line))
    next.internetStatus = "Немає інтернету";

  return next;
}

function applyStructuredSerialLine(
  line: string,
  current: BoardSnapshot,
): BoardSnapshot {
  const next = { ...current };
  const structured = line.match(/^\[LOG\]\[(.+?)\]\[(.+?)\]\s+(.+)$/i);
  if (!structured) return next;

  const category = structured[1].toLowerCase();
  const message = structured[3];

  if (category === "system" && /AlarmMini firmware/i.test(message)) {
    next.firmwareVersion = message
      .replace(/^AlarmMini firmware\s+/i, "")
      .trim();
  }

  if (category === "system") {
    const adminMatch = message.match(/^Admin password:\s*(\S+)/i);
    if (adminMatch) next.adminPassword = adminMatch[1];

    const mdnsMatch = message.match(/^mDNS\s+(https?:\/\/\S+)/i);
    if (mdnsMatch) {
      next.mdnsUrl = mdnsMatch[1];
      try {
        next.hostname = new URL(mdnsMatch[1]).hostname;
      } catch {
        next.hostname = mdnsMatch[1];
      }
    }
  }

  if (category === "wifi") {
    const ipMatch = message.match(/^OK IP:\s*([0-9.]+)/i);
    if (ipMatch) {
      next.wifiStatus = "Підключено";
      next.internetStatus = "Ймовірно онлайн";
      next.ip = ipMatch[1];
    }

    if (/AP mode/i.test(message)) next.wifiStatus = "AP режим";
    if (/(disconnect|failed|lost)/i.test(message))
      next.wifiStatus = "Немає Wi‑Fi";
  }

  if (category === "mqtt") {
    if (/Connected/i.test(message)) next.mqttStatus = "Підключено";
    if (/(disconnected|offline|failed|lost|error)/i.test(message))
      next.mqttStatus = "Немає з'єднання";
  }

  if (category === "internet") {
    if (/(online|ok)/i.test(message)) next.internetStatus = "Онлайн";
    if (/(offline|lost|failed)/i.test(message))
      next.internetStatus = "Немає інтернету";
  }

  return next;
}

export default function Page() {
  const [releases, setReleases] = useState<GithubRelease[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedReleaseId, setSelectedReleaseId] = useState<number | null>(
    null,
  );
  const [serialSupported, setSerialSupported] = useState(false);
  const [portState, setPortState] = useState<
    "idle" | "connecting" | "connected"
  >("idle");
  const [board, setBoard] = useState<BoardSnapshot>(EMPTY_BOARD);
  const [serialLog, setSerialLog] = useState<string[]>([]);
  const [supportQrSrc, setSupportQrSrc] = useState("");
  const [installManifestUrl, setInstallManifestUrl] = useState("");

  const portRef = useRef<any>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<string> | null>(null);
  const readLoopRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    setSerialSupported(
      typeof navigator !== "undefined" && "serial" in navigator,
    );
  }, []);

  useEffect(() => {
    void import("esp-web-tools/dist/web/install-button.js");
  }, []);

  useEffect(() => {
    QRCode.toDataURL(SUPPORT_AUTHOR_URL, {
      width: 176,
      margin: 1,
      color: { dark: "#0b2a4f", light: "#ffffff" },
    })
      .then(setSupportQrSrc)
      .catch((error) => console.error("[support-qr]", error));
  }, []);

  useEffect(() => {
    if (!owner || !repo) {
      setError("Заповни NEXT_PUBLIC_GITHUB_OWNER і NEXT_PUBLIC_GITHUB_REPO.");
      setLoading(false);
      return;
    }

    fetch(`https://api.github.com/repos/${owner}/${repo}/releases`, {
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`GitHub API ${response.status}`);
        return response.json();
      })
      .then((data: GithubRelease[]) => {
        setReleases(data);
        setSelectedReleaseId(data[0]?.id ?? null);
      })
      .catch((err: unknown) => {
        setError(
          err instanceof Error ? err.message : "Не вдалося отримати релізи",
        );
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    return () => {
      void disconnectPort();
    };
  }, []);

  const selectedRelease = useMemo(
    () => releases.find((release) => release.id === selectedReleaseId) ?? null,
    [releases, selectedReleaseId],
  );

  const firmwareAsset =
    selectedRelease?.assets.find((asset) =>
      asset.name.toLowerCase().includes("firmware"),
    ) ?? null;
  const littlefsAsset =
    selectedRelease?.assets.find((asset) =>
      asset.name.toLowerCase().includes("littlefs"),
    ) ?? null;
  const canFlashSelectedRelease =
    Boolean(selectedRelease) &&
    Boolean(firmwareAsset) &&
    Boolean(littlefsAsset) &&
    Boolean(installManifestUrl) &&
    serialSupported &&
    portState !== "connected" &&
    portState !== "connecting";

  useEffect(() => {
    if (!selectedRelease || !firmwareAsset || !littlefsAsset) {
      setInstallManifestUrl("");
      return;
    }

    const manifest = {
      name: "AlarmMini",
      version:
        selectedRelease.tag_name || selectedRelease.name || "unversioned",
      new_install_prompt_erase: false,
      builds: [
        {
          chipFamily: "ESP8266",
          parts: [
            {
              path: `/api/release-asset?source=${encodeURIComponent(firmwareAsset.browser_download_url)}`,
              offset: 0,
            },
            {
              path: `/api/release-asset?source=${encodeURIComponent(littlefsAsset.browser_download_url)}`,
              offset: 2097152,
            },
          ],
        },
      ],
    };

    const nextUrl = URL.createObjectURL(
      new Blob([JSON.stringify(manifest)], { type: "application/json" }),
    );
    setInstallManifestUrl(nextUrl);

    return () => URL.revokeObjectURL(nextUrl);
  }, [selectedRelease, firmwareAsset, littlefsAsset]);

  async function disconnectPort() {
    try {
      await readerRef.current?.cancel();
    } catch {}
    try {
      await portRef.current?.close();
    } catch {}
    readerRef.current = null;
    portRef.current = null;
    readLoopRef.current = null;
    setPortState("idle");
  }

  async function startReadLoop(port: any) {
    const decoder = new TextDecoderStream();
    const readableClosed = port.readable
      .pipeTo(decoder.writable)
      .catch(() => {});
    const reader = decoder.readable.getReader();
    readerRef.current = reader;

    let buffer = "";
    readLoopRef.current = (async () => {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value ?? "";
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? "";

        lines
          .map((line) => line.trim())
          .filter(Boolean)
          .forEach((line) => {
            setSerialLog((prev) => [line, ...prev].slice(0, 60));
            setBoard((prev) =>
              applyStructuredSerialLine(line, applySerialLine(line, prev)),
            );
          });
      }
    })()
      .catch((error) => {
        console.error("[serial-read]", error);
      })
      .finally(async () => {
        try {
          reader.releaseLock();
        } catch {}
        await readableClosed;
      });
  }

  async function handleConnect() {
    if (!("serial" in navigator)) return;

    try {
      setPortState("connecting");
      setBoard(EMPTY_BOARD);
      setSerialLog([]);
      const serial = (navigator as Navigator & { serial: any }).serial;
      const port = await serial.requestPort();
      await port.open({ baudRate: 115200 });
      portRef.current = port;
      setPortState("connected");
      await startReadLoop(port);
    } catch (error) {
      console.error("[serial-connect]", error);
      await disconnectPort();
    }
  }

  return (
    <main className="installer-shell">
      <aside className="installer-sidebar">
        <div className="brand-card">
          <div className="brand-mark">AM</div>
          <div className="brand-copy">
            <div className="brand-title">AlarmMini</div>
            <div className="brand-subtitle">Installer console</div>
          </div>
        </div>

        <div className="sidebar-card">
          <div className="panel-label">COM / Browser</div>
          <h2 className="panel-title">Підключення плати</h2>
          <p className="panel-text">
            Працює в Chrome або Edge на ПК. Сторінка зчитує сервісну інформацію
            з serial ще до етапу прошивки.
          </p>
          <div
            className={`status-pill ${serialSupported ? "is-ok" : "is-warn"}`}
          >
            {serialSupported
              ? "Web Serial доступний"
              : "Потрібен Chromium-браузер"}
          </div>
          <div className="button-stack">
            <button
              className="primary-btn"
              onClick={handleConnect}
              disabled={!serialSupported || portState === "connecting"}
            >
              {portState === "connected"
                ? "Порт підключено"
                : portState === "connecting"
                  ? "Підключення..."
                  : "Підключити плату"}
            </button>
            <button
              className="ghost-btn"
              onClick={() => void disconnectPort()}
              disabled={portState !== "connected"}
            >
              Від'єднати
            </button>
          </div>
        </div>

        <div className="sidebar-card">
          <div className="panel-label">GitHub</div>
          <h2 className="panel-title">Проєкт AlarmMini</h2>
          <p className="panel-text">
            Офіційний репозиторій з кодом, документацією та релізами прошивки.
          </p>
          <div className="button-stack">
            <a
              className="ghost-btn support-link"
              href={PROJECT_REPO_URL}
              target="_blank"
              rel="noreferrer"
            >
              Відкрити GitHub
            </a>
          </div>
        </div>

        <div className="sidebar-card">
          <div className="panel-label">Support</div>
          <h2 className="panel-title">Підтримати автора</h2>

          <div className="support-qr-shell">
            {supportQrSrc ? (
              <img
                className="support-qr-image"
                src={supportQrSrc}
                alt="Mono QR для донату"
              />
            ) : (
              <div className="support-qr-placeholder">Готуємо QR...</div>
            )}
          </div>
          <div className="button-stack">
            <a
              className="primary-btn support-link"
              href={SUPPORT_AUTHOR_URL}
              target="_blank"
              rel="noreferrer"
            >
              Підтримати автора
            </a>
            <a
              className="ghost-btn support-link"
              href={TELEGRAM_GROUP_URL}
              target="_blank"
              rel="noreferrer"
            >
              Telegram група
            </a>
          </div>
        </div>
      </aside>

      <section className="installer-content">
        <header className="hero-card">
          <div className="hero-copy">
            <div className="content-eyebrow">Прошивка</div>
            <h1 className="content-title">Вибір релізу та підключення плати</h1>
          </div>

          <div className="hero-side">
            <div className="panel-label">Обраний реліз</div>
            <div className="hero-release">
              {selectedRelease?.name ||
                selectedRelease?.tag_name ||
                "Ще не вибрано"}
            </div>
            <div className="hero-assets">
              <span>
                {firmwareAsset
                  ? firmwareAsset.name
                  : "firmware.bin не знайдено"}
              </span>
              <span>
                {littlefsAsset
                  ? littlefsAsset.name
                  : "littlefs.bin не знайдено"}
              </span>
            </div>
            <div className="button-stack hero-action-stack">
              {createElement(
                "esp-web-install-button" as any,
                {
                  manifest: installManifestUrl,
                  class: "install-button-host",
                },
                createElement(
                  "button",
                  {
                    slot: "activate",
                    className: "primary-btn install-trigger-btn",
                    type: "button",
                    disabled: !canFlashSelectedRelease,
                  },
                  "Прошити плату",
                ),
              )}
            </div>
            <div className="hero-hint">
              {portState === "connected"
                ? "Для прошивки спершу натисни «Від'єднати», щоб звільнити COM-порт."
                : "Кнопка стане активною, коли реліз вибрано, обидва файли знайдені і браузер підтримує Web Serial."}
            </div>
          </div>
        </header>

        <div className="content-grid">
          <section className="panel-card installer-panel">
            <div className="panel-head">
              <div>
                <div className="panel-label">GitHub Releases</div>
                <h2 className="panel-title">Список доступних версій</h2>
              </div>
            </div>

            {loading && (
              <div className="state-box">Завантаження релізів...</div>
            )}
            {error && <div className="state-box state-box-error">{error}</div>}
            {!loading && !error && releases.length === 0 && (
              <div className="state-box">Релізи не знайдено.</div>
            )}

            {!loading && !error && releases.length > 0 && (
              <div className="release-list">
                {releases.map((release) => {
                  const isActive = release.id === selectedReleaseId;
                  return (
                    <article
                      key={release.id}
                      className={`release-card ${isActive ? "is-active" : ""}`}
                    >
                      <div className="release-head">
                        <div>
                          <div className="release-title">
                            {release.name || release.tag_name}
                          </div>
                          <div className="release-date">
                            {formatDate(release.published_at)}
                          </div>
                        </div>
                        <button
                          className={isActive ? "ghost-btn" : "inline-btn"}
                          onClick={() => setSelectedReleaseId(release.id)}
                        >
                          {isActive ? "Обрано" : "Вибрати"}
                        </button>
                      </div>

                      <div className="asset-list">
                        {release.assets.map((asset) => (
                          <div key={asset.id} className="asset-item">
                            <div>
                              <div className="asset-name">{asset.name}</div>
                              <div className="asset-size">
                                {formatBytes(asset.size)}
                              </div>
                            </div>
                            <a
                              href={asset.browser_download_url}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Відкрити
                            </a>
                          </div>
                        ))}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          <section className="panel-card installer-panel">
            <div className="panel-head">
              <div>
                <div className="panel-label">COM status</div>
                <h2 className="panel-title">Службова інформація з плати</h2>
              </div>
            </div>

            <div className="board-grid">
              <div className="info-tile">
                <span>Wi‑Fi</span>
                <strong>{board.wifiStatus}</strong>
              </div>
              <div className="info-tile">
                <span>Internet</span>
                <strong>{board.internetStatus}</strong>
              </div>
              <div className="info-tile">
                <span>MQTT</span>
                <strong>{board.mqttStatus}</strong>
              </div>
              <div className="info-tile">
                <span>IP</span>
                <strong>{board.ip}</strong>
              </div>
              <div className="info-tile">
                <span>mDNS</span>
                <strong>{board.mdnsUrl}</strong>
              </div>
              <div className="info-tile">
                <span>Пароль</span>
                <strong>{board.adminPassword}</strong>
              </div>
              <div className="info-tile">
                <span>Firmware</span>
                <strong>{board.firmwareVersion}</strong>
              </div>
              <div className="info-tile">
                <span>Останній рядок</span>
                <strong>{board.lastLine}</strong>
              </div>
            </div>

            <div className="serial-log">
              <div className="serial-head">
                <span className="panel-label">Serial log</span>
                <span
                  className={`status-pill ${portState === "connected" ? "is-ok" : "is-muted"}`}
                >
                  {portState === "connected" ? "Streaming" : "Не читається"}
                </span>
              </div>
              <div className="serial-lines">
                {serialLog.length === 0 ? (
                  <div className="serial-empty">
                    Підключи плату, щоб побачити лог.
                  </div>
                ) : (
                  serialLog.map((line, index) => (
                    <div key={`${line}-${index}`} className="serial-line">
                      {line}
                    </div>
                  ))
                )}
              </div>
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}
