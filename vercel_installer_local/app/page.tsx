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
  wifiStatus: "РћС‡С–РєСѓС” РїС–РґРєР»СЋС‡РµРЅРЅСЏ",
  mqttStatus: "РќРµРІС–РґРѕРјРѕ",
  internetStatus: "РќРµРІС–РґРѕРјРѕ",
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
    next.wifiStatus = "РџС–РґРєР»СЋС‡РµРЅРѕ";
    next.internetStatus = "Р™РјРѕРІС–СЂРЅРѕ РѕРЅР»Р°Р№РЅ";
    next.ip = wifiMatch[1];
  }

  if (/\[WiFi\].*AP/i.test(line)) next.wifiStatus = "AP СЂРµР¶РёРј";
  if (/\[WiFi\].*(disconnect|failed|lost)/i.test(line))
    next.wifiStatus = "РќРµРјР°С” WiвЂ‘Fi";

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

  if (/\[MQTT\].*Connected/i.test(line)) next.mqttStatus = "РџС–РґРєР»СЋС‡РµРЅРѕ";
  if (/\[MQTT\].*(Disconnected|offline|failed|lost)/i.test(line))
    next.mqttStatus = "РќРµРјР°С” Р·'С”РґРЅР°РЅРЅСЏ";

  if (/\[Internet\].*(online|ok)/i.test(line)) next.internetStatus = "РћРЅР»Р°Р№РЅ";
  if (/\[Internet\].*(offline|lost|failed)/i.test(line))
    next.internetStatus = "РќРµРјР°С” С–РЅС‚РµСЂРЅРµС‚Сѓ";

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
      next.wifiStatus = "РџС–РґРєР»СЋС‡РµРЅРѕ";
      next.internetStatus = "Р™РјРѕРІС–СЂРЅРѕ РѕРЅР»Р°Р№РЅ";
      next.ip = ipMatch[1];
    }

    if (/AP mode/i.test(message)) next.wifiStatus = "AP СЂРµР¶РёРј";
    if (/(disconnect|failed|lost)/i.test(message))
      next.wifiStatus = "РќРµРјР°С” WiвЂ‘Fi";
  }

  if (category === "mqtt") {
    if (/Connected/i.test(message)) next.mqttStatus = "РџС–РґРєР»СЋС‡РµРЅРѕ";
    if (/(disconnected|offline|failed|lost|error)/i.test(message))
      next.mqttStatus = "РќРµРјР°С” Р·'С”РґРЅР°РЅРЅСЏ";
  }

  if (category === "internet") {
    if (/(online|ok)/i.test(message)) next.internetStatus = "РћРЅР»Р°Р№РЅ";
    if (/(offline|lost|failed)/i.test(message))
      next.internetStatus = "РќРµРјР°С” С–РЅС‚РµСЂРЅРµС‚Сѓ";
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
  const [flashStage, setFlashStage] = useState<"" | "flashed" | "restoring" | "done">("");
  const [configBackupReady, setConfigBackupReady] = useState(false);
  const [defaultConfigMode, setDefaultConfigMode] = useState(false);

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
      setError("Р—Р°РїРѕРІРЅРё NEXT_PUBLIC_GITHUB_OWNER С– NEXT_PUBLIC_GITHUB_REPO.");
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
          err instanceof Error ? err.message : "РќРµ РІРґР°Р»РѕСЃСЏ РѕС‚СЂРёРјР°С‚Рё СЂРµР»С–Р·Рё",
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
  const hasSelectedReleaseAssets =
    Boolean(selectedRelease) &&
    Boolean(firmwareAsset) &&
    Boolean(littlefsAsset) &&
    Boolean(installManifestUrl);
  const canFlashSelectedRelease =
    hasSelectedReleaseAssets && serialSupported && !flashBusy;

  const flashHint = !serialSupported
    ? "Р”Р»СЏ РїСЂРѕС€РёРІРєРё РїРѕС‚СЂС–Р±РµРЅ Chrome Р°Р±Рѕ Edge Р· РїС–РґС‚СЂРёРјРєРѕСЋ Web Serial."
    : flashBusy
      ? "РўСЂРёРІР°С” РїС–РґРіРѕС‚РѕРІРєР° Р°Р±Рѕ Р·Р°РІРµСЂС€РµРЅРЅСЏ РїСЂРѕС€РёРІРєРё. Р—Р°С‡РµРєР°Р№ РєС–Р»СЊРєР° СЃРµРєСѓРЅРґ."
      : portState === "connecting"
        ? "РўСЂРёРІР°С” РїС–РґРєР»СЋС‡РµРЅРЅСЏ РґРѕ РїР»Р°С‚Рё. Р—Р°С‡РµРєР°Р№ РєС–Р»СЊРєР° СЃРµРєСѓРЅРґ."
        : !selectedRelease
          ? "РЎРїРµСЂС€Сѓ РІРёР±РµСЂРё СЂРµР»С–Р· РґР»СЏ РїСЂРѕС€РёРІРєРё."
          : !firmwareAsset || !littlefsAsset
            ? "РЈ СЂРµР»С–Р·С– РјР°СЋС‚СЊ Р±СѓС‚Рё firmware.bin С– littlefs.bin."
            : defaultConfigMode
              ? "РљРѕРЅС„С–Рі РЅРµ Р·С‡РёС‚Р°РЅРѕ. РџСЂРѕС€РёРІРєР° РїС–РґРµ Р· С‚РёРїРѕРІРѕСЋ РєРѕРЅС„С–РіСѓСЂР°С†С–С”СЋ Р· СЂРµР»С–Р·Сѓ."
              : configBackupReady
                ? "РљРѕРЅС„С–Рі Р·С‡РёС‚Р°РЅРѕ. РџС–СЃР»СЏ РїСЂРѕС€РёРІРєРё СЃС‚РѕСЂС–РЅРєР° РїРѕРІРµСЂРЅРµ Р№РѕРіРѕ РЅР°Р·Р°Рґ РЅР° РїР»Р°С‚Сѓ."
                : "РљРЅРѕРїРєР° СЃР°РјР° РїС–РґРєР»СЋС‡РёС‚СЊ РїР»Р°С‚Сѓ, СЃРїСЂРѕР±СѓС” Р·С‡РёС‚Р°С‚Рё РєРѕРЅС„С–Рі С– Р»РёС€Рµ РїРѕС‚С–Рј Р·Р°РїСѓСЃС‚РёС‚СЊ РїСЂРѕС€РёРІРєСѓ.";

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

  async function disconnectPort(options?: { preserveBackupState?: boolean }) {
    try {
      await readerRef.current?.cancel();
    } catch {}
    try {
      await portRef.current?.close();
    } catch {}
    readerRef.current = null;
    portRef.current = null;
    readLoopRef.current = null;
    if (!options?.preserveBackupState) {
      setConfigBackupReady(false);
      configBackupRef.current = null;
    }
    setPortState("idle");
  }

  function isPortOpen(port: any) {
    return Boolean(port?.readable || port?.writable);
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
    const activePort = rememberedPortRef.current ?? portRef.current;
    if (!activePort?.readable || !activePort?.writable) return null;

    setFlashStatus("Р—С‡РёС‚СѓС”РјРѕ РєРѕРЅС„С–РіСѓСЂР°С†С–СЋ Р· РїР»Р°С‚Рё...");

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
    setFlashStatus("РџРѕРІРµСЂС‚Р°С”РјРѕ РєРѕРЅС„С–РіСѓСЂР°С†С–СЋ РЅР° РїР»Р°С‚Сѓ...");

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
    if (!isPortOpen(port)) {
      await port.open({ baudRate: 115200 });
    }
    portRef.current = port;
    rememberedPortRef.current = port;
    setPortState("connected");
    setConfigBackupReady(false);
    if (!readerRef.current) {
      await startReadLoop(port);
    }
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
    if (portState === "connected" && isPortOpen(portRef.current ?? rememberedPortRef.current)) {
      return;
    }

    try {
      setPortState("connecting");
      setBoard(EMPTY_BOARD);
      setSerialLog([]);
      const serial = (navigator as Navigator & { serial: any }).serial;
      const port = await serial.requestPort();
      await openBoardPort(port);
      await new Promise((resolve) => setTimeout(resolve, 500));
      try {
        configBackupRef.current = await backupConfigViaSerial();
        setConfigBackupReady(Boolean(configBackupRef.current));
        setDefaultConfigMode(false);
        setFlashStatus("РљРѕРЅС„С–РіСѓСЂР°С†С–СЋ Р·С‡РёС‚Р°РЅРѕ. РњРѕР¶РЅР° Р·Р°РїСѓСЃРєР°С‚Рё РїСЂРѕС€РёРІРєСѓ.");
      } catch (error) {
        console.error("[config-backup-init]", error);
        configBackupRef.current = null;
        setConfigBackupReady(false);
        setDefaultConfigMode(true);
        setFlashStatus("РљРѕРЅС„С–РіСѓСЂР°С†С–СЋ РЅРµ РІРґР°Р»РѕСЃСЏ Р·С‡РёС‚Р°С‚Рё. РњРѕР¶РЅР° РїСЂРѕС€РёС‚Рё РїР»Р°С‚Сѓ Р· С‚РёРїРѕРІРѕСЋ РєРѕРЅС„С–РіСѓСЂР°С†С–С”СЋ.");
      }
    } catch (error) {
      console.error("[serial-connect]", error);
      await disconnectPort();
    }
  }

  async function ensureConnectedAndBackedUp() {
    if (!("serial" in navigator)) throw new Error("serial_unsupported");

    if (portState !== "connected") {
      setFlashStatus("РџС–РґРєР»СЋС‡Р°С”РјРѕ РїР»Р°С‚Сѓ...");
      setPortState("connecting");
      setBoard(EMPTY_BOARD);
      setSerialLog([]);

      const serial = (navigator as Navigator & { serial: any }).serial;
      const knownPorts = await serial.getPorts();
      const port = knownPorts[0] ?? (await serial.requestPort());
      await openBoardPort(port);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    if (!configBackupRef.current && !defaultConfigMode) {
      try {
        const backup = await backupConfigViaSerial();
        configBackupRef.current = backup;
        setConfigBackupReady(Boolean(backup));
        setDefaultConfigMode(false);
      } catch (error) {
        console.error("[config-backup-check]", error);
        configBackupRef.current = null;
        setConfigBackupReady(false);
        setDefaultConfigMode(true);
      }
    }

    if (!configBackupRef.current && !defaultConfigMode) {
      setFlashStatus("РљРѕРЅС„С–РіСѓСЂР°С†С–СЋ РЅРµ РІРґР°Р»РѕСЃСЏ Р·С‡РёС‚Р°С‚Рё. РњРѕР¶РЅР° РїСЂРѕРґРѕРІР¶РёС‚Рё Р· С‚РёРїРѕРІРѕСЋ РєРѕРЅС„С–РіСѓСЂР°С†С–С”СЋ.");
      return null;
    }

    if (configBackupRef.current) {
      setFlashStatus("РљРѕРЅС„С–РіСѓСЂР°С†С–СЋ Р·С‡РёС‚Р°РЅРѕ. Р—Р°РїСѓСЃРєР°С”РјРѕ РїСЂРѕС€РёРІРєСѓ...");
    }

    return configBackupRef.current;
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
      if (isPortOpen(port)) {
        try {
          portRef.current = port;
          rememberedPortRef.current = port;
          setPortState("connected");
          if (!readerRef.current) {
            await startReadLoop(port);
          }
          return;
        } catch {}
      }
      await disconnectPort();
    }
  }

  async function handleFlashDialogClosed() {
    setFlashStage("flashed");
    setFlashStatus("РџСЂРѕС€РёС‚Рѕ");
    if (!reconnectAfterFlashRef.current) return;
    reconnectAfterFlashRef.current = false;
    restoreAfterReconnectRef.current = Boolean(configBackupRef.current);
    await new Promise((resolve) => setTimeout(resolve, 500));
    await reconnectBoardAfterFlash();
    if (!restoreAfterReconnectRef.current) {
      setFlashBusy(false);
      setFlashStage("done");
      setFlashStatus("Р“РѕС‚РѕРІРѕ. РџР»Р°С‚Сѓ РїСЂРѕС€РёС‚Рѕ Р· С‚РёРїРѕРІРѕСЋ РєРѕРЅС„С–РіСѓСЂР°С†С–С”СЋ.");
    }
  }

  async function handleFlashStart() {
    if (!canFlashSelectedRelease || !installButtonRef.current) return;

    reconnectAfterFlashRef.current = true;
    setFlashBusy(true);
    setFlashStage("");
    setFlashStatus("Р“РѕС‚СѓС”РјРѕ РїСЂРѕС€РёРІРєСѓ...");

    try {
      const backup = await ensureConnectedAndBackedUp();

      if (!backup) {
        const continueWithDefault = window.confirm("Конфігурацію не вдалося зчитати. Продовжити прошивку з типовою конфігурацією?");
        if (!continueWithDefault) {
          reconnectAfterFlashRef.current = false;
          setFlashBusy(false);
          setFlashStatus("РџСЂРѕС€РёРІРєСѓ СЃРєР°СЃРѕРІР°РЅРѕ. РџРµСЂРµРІС–СЂ Р·С‡РёС‚СѓРІР°РЅРЅСЏ РєРѕРЅС„С–РіСѓ Р№ СЃРїСЂРѕР±СѓР№ С‰Рµ СЂР°Р·.");
          return;
        }

        configBackupRef.current = null;
        setConfigBackupReady(false);
        setDefaultConfigMode(true);
        setFlashStatus("РџСЂРѕРґРѕРІР¶СѓС”РјРѕ Р· С‚РёРїРѕРІРѕСЋ РєРѕРЅС„С–РіСѓСЂР°С†С–С”СЋ Р· СЂРµР»С–Р·Сѓ...");
      }

      if (rememberedPortRef.current || portRef.current) {
        await disconnectPort({ preserveBackupState: Boolean(configBackupRef.current) });
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
      setFlashStatus("Р’С–РґРєСЂРёРІР°С”РјРѕ РґС–Р°Р»РѕРі РїСЂРѕС€РёРІРєРё...");
      await startEspInstall(installButtonRef.current);
    } catch (error) {
      reconnectAfterFlashRef.current = false;
      setFlashBusy(false);
      setConfigBackupReady(Boolean(configBackupRef.current));
      setFlashStage("");
      setFlashStatus(
        defaultConfigMode
          ? "РќРµ РІРґР°Р»РѕСЃСЏ Р·Р°РїСѓСЃС‚РёС‚Рё РїСЂРѕС€РёРІРєСѓ. РЎРїСЂРѕР±СѓР№ С‰Рµ СЂР°Р· Р· РїС–РґРєР»СЋС‡РµРЅРѕСЋ РїР»Р°С‚РѕСЋ."
          : "РќРµ РІРґР°Р»РѕСЃСЏ РїС–РґРіРѕС‚СѓРІР°С‚Рё РїСЂРѕС€РёРІРєСѓ Р°Р±Рѕ Р·С‡РёС‚Р°С‚Рё РєРѕРЅС„С–РіСѓСЂР°С†С–СЋ. РџРµСЂРµРІС–СЂ РєР°Р±РµР»СЊ С– СЃРїСЂРѕР±СѓР№ С‰Рµ СЂР°Р·.",
      );
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
          setFlashStage("restoring");
          await restoreConfigViaSerial(configBackupRef.current);
          await disconnectPort({ preserveBackupState: true });
          await new Promise((resolve) => setTimeout(resolve, 2500));
          await reconnectBoardAfterFlash();
          try {
            configBackupRef.current = await backupConfigViaSerial();
            setConfigBackupReady(Boolean(configBackupRef.current));
            setDefaultConfigMode(false);
          } catch (_) {
            configBackupRef.current = null;
            setConfigBackupReady(false);
          }
          setFlashStage("done");
          setFlashStatus("Р“РѕС‚РѕРІРѕ");
        } catch (error) {
          console.error("[config-restore]", error);
          setFlashStage("");
          setFlashStatus("РџСЂРѕС€РёРІРєР° Р·Р°РІРµСЂС€РµРЅР°, Р°Р»Рµ РєРѕРЅС„С–РіСѓСЂР°С†С–СЋ РЅРµ РІРґР°Р»РѕСЃСЏ РїРѕРІРµСЂРЅСѓС‚Рё Р°РІС‚РѕРјР°С‚РёС‡РЅРѕ.");
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
          <h2 className="panel-title">РџС–РґРєР»СЋС‡РµРЅРЅСЏ РїР»Р°С‚Рё</h2>
          <p className="panel-text">
            РџСЂР°С†СЋС” РІ Chrome Р°Р±Рѕ Edge РЅР° РџРљ. РЎС‚РѕСЂС–РЅРєР° Р·С‡РёС‚СѓС” СЃРµСЂРІС–СЃРЅСѓ С–РЅС„РѕСЂРјР°С†С–СЋ
            Р· serial С‰Рµ РґРѕ РµС‚Р°РїСѓ РїСЂРѕС€РёРІРєРё.
          </p>
          <div
            className={`status-pill ${serialSupported ? "is-ok" : "is-warn"}`}
          >
            {serialSupported
              ? "Web Serial РґРѕСЃС‚СѓРїРЅРёР№"
              : "РџРѕС‚СЂС–Р±РµРЅ Chromium-Р±СЂР°СѓР·РµСЂ"}
          </div>
          <div className="button-stack">
            <button
              className="primary-btn"
              onClick={handleConnect}
              disabled={!serialSupported || portState === "connecting" || flashBusy}
            >
              {portState === "connected"
                ? "РџРѕСЂС‚ РїС–РґРєР»СЋС‡РµРЅРѕ"
                : portState === "connecting"
                  ? "РџС–РґРєР»СЋС‡РµРЅРЅСЏ..."
                  : "РџС–РґРєР»СЋС‡РёС‚Рё РїР»Р°С‚Сѓ"}
            </button>
            <button
              className="ghost-btn"
              onClick={() => void disconnectPort()}
              disabled={portState !== "connected" || flashBusy}
            >
              Р’С–Рґ'С”РґРЅР°С‚Рё
            </button>
          </div>
        </div>

        <div className="sidebar-card">
          <div className="panel-label">Support</div>
          <h2 className="panel-title">РџС–РґС‚СЂРёРјР°С‚Рё Р°РІС‚РѕСЂР°</h2>

          <div className="support-qr-shell">
            {supportQrSrc ? (
              <img
                className="support-qr-image"
                src={supportQrSrc}
                alt="Mono QR РґР»СЏ РґРѕРЅР°С‚Сѓ"
              />
            ) : (
              <div className="support-qr-placeholder">Р“РѕС‚СѓС”РјРѕ QR...</div>
            )}
          </div>
          <div className="button-stack">
            <a
              className="primary-btn support-link"
              href={SUPPORT_AUTHOR_URL}
              target="_blank"
              rel="noreferrer"
            >
              РџС–РґС‚СЂРёРјР°С‚Рё Р°РІС‚РѕСЂР°
            </a>
            <a
              className="ghost-btn support-link"
              href={TELEGRAM_GROUP_URL}
              target="_blank"
              rel="noreferrer"
            >
              Telegram РіСЂСѓРїР°
            </a>
          </div>
        </div>

        <div className="sidebar-card">
          <div className="panel-label">GitHub</div>
          <h2 className="panel-title">РџСЂРѕС”РєС‚ AlarmMini</h2>
          <p className="panel-text">
            РћС„С–С†С–Р№РЅРёР№ СЂРµРїРѕР·РёС‚РѕСЂС–Р№ Р· РєРѕРґРѕРј, РґРѕРєСѓРјРµРЅС‚Р°С†С–С”СЋ С‚Р° СЂРµР»С–Р·Р°РјРё РїСЂРѕС€РёРІРєРё.
          </p>
          <div className="button-stack">
            <a
              className="ghost-btn support-link"
              href={PROJECT_REPO_URL}
              target="_blank"
              rel="noreferrer"
            >
              Р’С–РґРєСЂРёС‚Рё GitHub
            </a>
          </div>
        </div>
      </aside>

      <section className="installer-content">
        <header className="hero-card">
          <div className="hero-copy">
            <div className="content-eyebrow">РџСЂРѕС€РёРІРєР°</div>
            <h1 className="content-title">Р’РёР±С–СЂ СЂРµР»С–Р·Сѓ С‚Р° РїС–РґРєР»СЋС‡РµРЅРЅСЏ РїР»Р°С‚Рё</h1>
          </div>

        </header>

        <div className="content-grid">
          <section className="panel-card installer-panel">
            <div className="panel-head">
              <div>
                <div className="panel-label">GitHub Releases</div>
                <h2 className="panel-title">РЎРїРёСЃРѕРє РґРѕСЃС‚СѓРїРЅРёС… РІРµСЂСЃС–Р№</h2>
              </div>
            </div>

            {loading && (
              <div className="state-box">Р—Р°РІР°РЅС‚Р°Р¶РµРЅРЅСЏ СЂРµР»С–Р·С–РІ...</div>
            )}
            {error && <div className="state-box state-box-error">{error}</div>}
            {!loading && !error && releases.length === 0 && (
              <div className="state-box">Р РµР»С–Р·Рё РЅРµ Р·РЅР°Р№РґРµРЅРѕ.</div>
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
                          {isActive ? "РћР±СЂР°РЅРѕ" : "Р’РёР±СЂР°С‚Рё"}
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
                              Р’С–РґРєСЂРёС‚Рё
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


          <div className="hero-side">
            <div className="panel-label">РћР±СЂР°РЅРёР№ СЂРµР»С–Р·</div>
            <div className="hero-release">
              {selectedRelease?.name ||
                selectedRelease?.tag_name ||
                "Р©Рµ РЅРµ РІРёР±СЂР°РЅРѕ"}
            </div>
            <div className="hero-assets">
              <span>
                {firmwareAsset
                  ? firmwareAsset.name
                  : "firmware.bin РЅРµ Р·РЅР°Р№РґРµРЅРѕ"}
              </span>
              <span>
                {littlefsAsset
                  ? littlefsAsset.name
                  : "littlefs.bin РЅРµ Р·РЅР°Р№РґРµРЅРѕ"}
              </span>
            </div>
            <div
              className={`status-pill ${configBackupReady ? "is-ok" : "is-warn"}`}
            >
              {configBackupReady
                ? "РљРѕРЅС„С–Рі Р·Р±РµСЂРµР¶РµРЅРѕ РїРµСЂРµРґ РїСЂРѕС€РёРІРєРѕСЋ"
                : "РџРѕС‚СЂС–Р±РµРЅ backup РєРѕРЅС„С–РіСѓ"}
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
                {flashBusy ? "РџС–РґРіРѕС‚РѕРІРєР° РґРѕ РїСЂРѕС€РёРІРєРё..." : "РџСЂРѕС€РёС‚Рё РїР»Р°С‚Сѓ"}
              </button>
            </div>
            <div className="hero-hint">{flashHint}</div>
            {flashStatus ? (
              <div className={`hero-hint ${flashStage ? `flash-stage flash-stage-${flashStage}` : ""}`}>
                {flashStatus}
              </div>
            ) : null}
          </div>

            <div className="panel-head">
              <div>
                <div className="panel-label">COM status</div>
                <h2 className="panel-title">РЎР»СѓР¶Р±РѕРІР° С–РЅС„РѕСЂРјР°С†С–СЏ Р· РїР»Р°С‚Рё</h2>
              </div>
            </div>

            <div className="board-grid">
              <div className="info-tile">
                <span>WiвЂ‘Fi</span>
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
                <span>РџР°СЂРѕР»СЊ</span>
                <strong>{board.adminPassword}</strong>
              </div>
              <div className="info-tile">
                <span>Firmware</span>
                <strong>{board.firmwareVersion}</strong>
              </div>
              <div className="info-tile">
                <span>РћСЃС‚Р°РЅРЅС–Р№ СЂСЏРґРѕРє</span>
                <strong>{board.lastLine}</strong>
              </div>
            </div>

            <div className="serial-log">
              <div className="serial-head">
                <span className="panel-label">Serial log</span>
                <span
                  className={`status-pill ${portState === "connected" ? "is-ok" : "is-muted"}`}
                >
                  {portState === "connected" ? "Streaming" : "РќРµ С‡РёС‚Р°С”С‚СЊСЃСЏ"}
                </span>
              </div>
              <div className="serial-lines">
                {serialLog.length === 0 ? (
                  <div className="serial-empty">
                    РџС–РґРєР»СЋС‡Рё РїР»Р°С‚Сѓ, С‰РѕР± РїРѕР±Р°С‡РёС‚Рё Р»РѕРі.
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


