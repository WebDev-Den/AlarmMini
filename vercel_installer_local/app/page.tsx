"use client";

import { createElement, useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import { connect as startEspInstall } from "esp-web-tools/dist/connect.js";

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

type ConfigTransferState = {
  mode: "backup" | "restore";
  resolve: (value: any) => void;
  reject: (reason?: unknown) => void;
  buffer: string;
  timeoutId: ReturnType<typeof setTimeout> | null;
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
  const [flashBusy, setFlashBusy] = useState(false);
  const [flashStatus, setFlashStatus] = useState("");
  const [configBackupReady, setConfigBackupReady] = useState(false);

  const portRef = useRef<any>(null);
  const rememberedPortRef = useRef<any>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<string> | null>(null);
  const readLoopRef = useRef<Promise<void> | null>(null);
  const installButtonRef = useRef<HTMLElement | null>(null);
  const reconnectAfterFlashRef = useRef(false);
  const configBackupRef = useRef<any | null>(null);
  const restoreAfterReconnectRef = useRef(false);
  const configTransferRef = useRef<ConfigTransferState | null>(null);

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
    portState === "connected" &&
    !flashBusy;

  const flashHint = !serialSupported
    ? "Для прошивки потрібен Chrome або Edge з підтримкою Web Serial."
    : flashBusy
      ? "Триває підготовка або завершення прошивки. Зачекай кілька секунд."
      : portState === "connecting"
        ? "Дочекайся завершення підключення або скасуй його перед прошивкою."
      : portState !== "connected"
        ? "Спершу підключи плату, щоб зчитати й зберегти конфігурацію перед прошивкою."
        : !configBackupReady
          ? "Плата підключена, але конфіг ще не підтверджено для безпечної прошивки."
        : !selectedRelease
            ? "Спершу вибери реліз для прошивки."
          : !firmwareAsset || !littlefsAsset
              ? "У релізі мають бути firmware.bin і littlefs.bin."
              : "Сторінка збереже конфіг, відкриє прошивку, а потім поверне налаштування на плату.";

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
    setConfigBackupReady(false);
    setPortState("idle");
  }

  async function writeSerialLine(line: string) {
    const port = rememberedPortRef.current ?? portRef.current;
    if (!port?.writable) throw new Error("Serial port is not writable");
    const writer = port.writable.getWriter();
    try {
      const encoder = new TextEncoder();
      await writer.write(encoder.encode(`${line}\n`));
    } finally {
      writer.releaseLock();
    }
  }

  function clearConfigTransferTimeout() {
    const transfer = configTransferRef.current;
    if (transfer?.timeoutId) clearTimeout(transfer.timeoutId);
    if (transfer) transfer.timeoutId = null;
  }

  function rejectConfigTransfer(reason: string) {
    const transfer = configTransferRef.current;
    if (!transfer) return;
    clearConfigTransferTimeout();
    configTransferRef.current = null;
    transfer.reject(new Error(reason));
  }

  function handleConfigProtocolLine(line: string): boolean {
    if (!line.startsWith("AMCFG ")) return false;

    const transfer = configTransferRef.current;
    if (!transfer) return true;

    if (line.startsWith("AMCFG ERROR ")) {
      rejectConfigTransfer(line.replace("AMCFG ERROR ", "").trim());
      return true;
    }

    if (line === "AMCFG READY") {
      clearConfigTransferTimeout();
      return true;
    }

    if (line.startsWith("AMCFG BEGIN ")) {
      transfer.buffer = "";
      clearConfigTransferTimeout();
      return true;
    }

    if (line.startsWith("AMCFG DATA ")) {
      transfer.buffer += line.slice("AMCFG DATA ".length);
      clearConfigTransferTimeout();
      return true;
    }

    if (line === "AMCFG END" && transfer.mode === "backup") {
      try {
        const parsed = JSON.parse(transfer.buffer || "{}");
        clearConfigTransferTimeout();
        configTransferRef.current = null;
        transfer.resolve(parsed);
      } catch (error) {
        rejectConfigTransfer("invalid_backup_json");
      }
      return true;
    }

    if (line === "AMCFG OK" && transfer.mode === "restore") {
      clearConfigTransferTimeout();
      configTransferRef.current = null;
      transfer.resolve(true);
      return true;
    }

    return true;
  }

  async function backupConfigViaSerial() {
    if (portState !== "connected") return null;

    setFlashStatus("Зчитуємо конфігурацію з плати...");

    return await new Promise<any>(async (resolve, reject) => {
      configTransferRef.current = {
        mode: "backup",
        resolve,
        reject,
        buffer: "",
        timeoutId: setTimeout(() => rejectConfigTransfer("backup_timeout"), 5000),
      };

      try {
        await writeSerialLine("AMCFG GET");
      } catch (error) {
        rejectConfigTransfer("backup_write_failed");
      }
    });
  }

  async function restoreConfigViaSerial(configPayload: any) {
    const serialized = JSON.stringify(configPayload || {});
    setFlashStatus("Повертаємо конфігурацію на плату...");

    await new Promise<boolean>(async (resolve, reject) => {
      configTransferRef.current = {
        mode: "restore",
        resolve,
        reject,
        buffer: "",
        timeoutId: setTimeout(() => rejectConfigTransfer("restore_timeout"), 7000),
      };

      try {
        await writeSerialLine("AMCFG SET BEGIN");
        const chunkSize = 192;
        for (let offset = 0; offset < serialized.length; offset += chunkSize) {
          await writeSerialLine(`AMCFG SET DATA ${serialized.slice(offset, offset + chunkSize)}`);
        }
        await writeSerialLine("AMCFG SET END");
      } catch (error) {
        rejectConfigTransfer("restore_write_failed");
      }
    });
  }

  async function openBoardPort(port: any) {
    await port.open({ baudRate: 115200 });
    portRef.current = port;
    rememberedPortRef.current = port;
    setPortState("connected");
    setConfigBackupReady(false);
    await startReadLoop(port);
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
            if (handleConfigProtocolLine(line)) return;
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
      await openBoardPort(port);
      try {
        configBackupRef.current = await backupConfigViaSerial();
        setConfigBackupReady(Boolean(configBackupRef.current));
        setFlashStatus("Конфігурацію зчитано. Можна запускати прошивку.");
      } catch (error) {
        console.error("[config-backup-init]", error);
        configBackupRef.current = null;
        setConfigBackupReady(false);
        setFlashStatus("Не вдалося зчитати конфіг. Безпечна прошивка недоступна.");
      }
    } catch (error) {
      console.error("[serial-connect]", error);
      await disconnectPort();
    }
  }

  async function reconnectBoardAfterFlash() {
    if (!("serial" in navigator)) return;

    const serial = (navigator as Navigator & { serial: any }).serial;
    const port =
      rememberedPortRef.current ??
      (await serial.getPorts()).find(Boolean);

    if (!port) return;

    try {
      setPortState("connecting");
      setBoard(EMPTY_BOARD);
      setSerialLog([]);
      await openBoardPort(port);
    } catch (error) {
      console.error("[serial-reconnect]", error);
      await disconnectPort();
    }
  }

  async function handleFlashDialogClosed() {
    setFlashStatus("Прошивка завершена. Повертаємо підключення до плати...");
    if (!reconnectAfterFlashRef.current) return;
    reconnectAfterFlashRef.current = false;
    restoreAfterReconnectRef.current = Boolean(configBackupRef.current);
    await new Promise((resolve) => setTimeout(resolve, 500));
    await reconnectBoardAfterFlash();
    if (!restoreAfterReconnectRef.current) {
      setFlashBusy(false);
      setFlashStatus("Плату перепрошито.");
    }
  }

  async function handleFlashStart() {
    if (!canFlashSelectedRelease || !installButtonRef.current) return;

    reconnectAfterFlashRef.current = true;
    setFlashBusy(true);
    setFlashStatus("Готуємо прошивку...");
    if (!configBackupRef.current) {
      setFlashBusy(false);
      setFlashStatus("Конфігурацію не зчитано. Спершу перепідключи плату.");
      return;
    }

    if (portState === "connected" || portState === "connecting") {
      await disconnectPort();
      await new Promise((resolve) => setTimeout(resolve, 150));
    }

    const observer = new MutationObserver((mutations, obs) => {
      for (const mutation of mutations) {
        for (const node of Array.from(mutation.addedNodes)) {
          if (node instanceof HTMLElement && node.tagName.toLowerCase() === "ewt-install-dialog") {
            node.addEventListener(
              "closed",
              () => {
                void handleFlashDialogClosed();
              },
              { once: true },
            );
            obs.disconnect();
            return;
          }
        }
      }
    });

    observer.observe(document.body, { childList: true });

    try {
      setFlashStatus("Відкриваємо діалог прошивки...");
      await startEspInstall(installButtonRef.current);
    } catch (error) {
      observer.disconnect();
      reconnectAfterFlashRef.current = false;
      setFlashBusy(false);
      setFlashStatus("Не вдалося запустити прошивку.");
      console.error("[flash-start]", error);
      await reconnectBoardAfterFlash();
    }
  }

  useEffect(() => {
    if (
      flashBusy &&
      portState === "connected" &&
      restoreAfterReconnectRef.current &&
      configBackupRef.current
    ) {
      restoreAfterReconnectRef.current = false;
      void (async () => {
        try {
          await new Promise((resolve) => setTimeout(resolve, 1500));
          await restoreConfigViaSerial(configBackupRef.current);
          setFlashStatus("Конфігурацію відновлено. Чекаємо перезапуск плати...");
          await disconnectPort();
          await new Promise((resolve) => setTimeout(resolve, 2500));
          await reconnectBoardAfterFlash();
          try {
            configBackupRef.current = await backupConfigViaSerial();
            setConfigBackupReady(Boolean(configBackupRef.current));
          } catch (_) {
            configBackupRef.current = null;
            setConfigBackupReady(false);
          }
          setFlashStatus("Плату перепрошито, конфігурацію повернуто.");
        } catch (error) {
          console.error("[config-restore]", error);
          setFlashStatus("Прошивка завершена, але конфігурацію не вдалося повернути автоматично.");
        } finally {
          configBackupRef.current = null;
          setFlashBusy(false);
        }
      })();
    }
  }, [flashBusy, portState]);

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
              disabled={!serialSupported || portState === "connecting" || flashBusy}
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
              disabled={portState !== "connected" || flashBusy}
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
            <div
              className={`status-pill ${configBackupReady ? "is-ok" : "is-warn"}`}
            >
              {configBackupReady
                ? "Конфіг збережено перед прошивкою"
                : "Потрібен backup конфігу"}
            </div>
            <div className="button-stack hero-action-stack">
              {createElement("esp-web-install-button" as any, {
                manifest: installManifestUrl,
                class: "install-button-host",
                ref: installButtonRef,
              })}
              <button
                className="primary-btn install-trigger-btn"
                type="button"
                disabled={!canFlashSelectedRelease}
                title={flashHint}
                onClick={() => void handleFlashStart()}
              >
                {flashBusy ? "Підготовка до прошивки..." : "Прошити плату"}
              </button>
            </div>
            <div className="hero-hint">{flashHint}</div>
            {flashStatus ? <div className="hero-hint">{flashStatus}</div> : null}
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
