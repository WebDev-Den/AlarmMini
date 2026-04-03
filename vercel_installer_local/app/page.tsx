"use client";

import { createElement, useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import { connect as startEspInstall } from "esp-web-tools/dist/connect.js";
import { getMessages } from "./lang";

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

type DeviceConfig = {
  wifiSsid: string;
  wifiPass: string;
  mqttHost: string;
  mqttPort: number;
  mqttTopic: string;
  mqttUser: string;
  mqttPass: string;
  [key: string]: any;
};

type ConfigTransferState = {
  mode: "backup" | "restore";
  resolve: (value: any) => void;
  reject: (reason?: unknown) => void;
  buffer: string;
  timeoutId: ReturnType<typeof setTimeout> | null;
  readyResolve: (() => void) | null;
};

const owner = process.env.NEXT_PUBLIC_GITHUB_OWNER;
const repo = process.env.NEXT_PUBLIC_GITHUB_REPO;
const SUPPORT_AUTHOR_URL = "https://send.monobank.ua/jar/2PMhPjRk9j";
const TELEGRAM_GROUP_URL = "https://t.me/+j3zFZHE5gGoyNGYy";
const PROJECT_REPO_URL = "https://github.com/WebDev-Den/AlarmMini";
const CONFIG_STORAGE_KEY = "alarmmini.installer.config";
const t = getMessages();

const DEFAULT_DEVICE_CONFIG: DeviceConfig = {
  wifiSsid: "",
  wifiPass: "",
  mqttHost: "",
  mqttPort: 1883,
  mqttTopic: "alerts/status",
  mqttUser: "",
  mqttPass: "",
};

function getEmptyBoard(): BoardSnapshot {
  return {
    wifiStatus: t.board.waitingForConnection,
    mqttStatus: t.common.unknown,
    internetStatus: t.common.unknown,
    ip: "-",
    mdnsUrl: "-",
    adminPassword: "-",
    firmwareVersion: "-",
    hostname: "-",
    lastLine: "-",
  };
}

function normalizeDeviceConfig(config: Partial<DeviceConfig> | null | undefined): DeviceConfig {
  const source = config || {};
  return {
    ...DEFAULT_DEVICE_CONFIG,
    ...source,
    wifiSsid: String(source.wifiSsid || ""),
    wifiPass: String(source.wifiPass || ""),
    mqttHost: String(source.mqttHost || ""),
    mqttPort: Number(source.mqttPort || 1883) || 1883,
    mqttTopic: String(source.mqttTopic || DEFAULT_DEVICE_CONFIG.mqttTopic),
    mqttUser: String(source.mqttUser || ""),
    mqttPass: String(source.mqttPass || ""),
  };
}

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
    next.wifiStatus = t.board.connected;
    next.internetStatus = t.board.probablyOnline;
    next.ip = wifiMatch[1];
  }

  if (/\[WiFi\].*AP/i.test(line)) next.wifiStatus = t.board.apMode;
  if (/\[WiFi\].*(disconnect|failed|lost)/i.test(line)) {
    next.wifiStatus = t.board.noWifi;
  }

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

  if (/\[MQTT\].*Connected/i.test(line)) next.mqttStatus = t.board.connected;
  if (/\[MQTT\].*(Disconnected|offline|failed|lost)/i.test(line)) {
    next.mqttStatus = t.board.noMqtt;
  }

  if (/\[Internet\].*(online|ok)/i.test(line)) {
    next.internetStatus = t.board.online;
  }
  if (/\[Internet\].*(offline|lost|failed)/i.test(line)) {
    next.internetStatus = t.board.noInternet;
  }

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
      next.wifiStatus = t.board.connected;
      next.internetStatus = t.board.probablyOnline;
      next.ip = ipMatch[1];
    }

    if (/AP mode/i.test(message)) next.wifiStatus = t.board.apMode;
    if (/(disconnect|failed|lost)/i.test(message)) {
      next.wifiStatus = t.board.noWifi;
    }
  }

  if (category === "mqtt") {
    if (/Connected/i.test(message)) next.mqttStatus = t.board.connected;
    if (/(disconnected|offline|failed|lost|error)/i.test(message)) {
      next.mqttStatus = t.board.noMqtt;
    }
  }

  if (category === "internet") {
    if (/(online|ok)/i.test(message)) next.internetStatus = t.board.online;
    if (/(offline|lost|failed)/i.test(message)) {
      next.internetStatus = t.board.noInternet;
    }
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
  const [board, setBoard] = useState<BoardSnapshot>(getEmptyBoard());
  const [serialLog, setSerialLog] = useState<string[]>([]);
  const [supportQrSrc, setSupportQrSrc] = useState("");
  const [installManifestUrl, setInstallManifestUrl] = useState("");
  const [flashBusy, setFlashBusy] = useState(false);
  const [flashStatus, setFlashStatus] = useState("");
  const [flashStage, setFlashStage] = useState<
    "" | "flashed" | "restoring" | "done"
  >("");
  const [configBackupReady, setConfigBackupReady] = useState(false);
  const [defaultConfigMode, setDefaultConfigMode] = useState(false);
  const [boardConfig, setBoardConfig] = useState<DeviceConfig>(
    normalizeDeviceConfig(DEFAULT_DEVICE_CONFIG),
  );
  const [configDraft, setConfigDraft] = useState<DeviceConfig>(
    normalizeDeviceConfig(DEFAULT_DEVICE_CONFIG),
  );
  const [configModalOpen, setConfigModalOpen] = useState(false);

  const portRef = useRef<any>(null);
  const rememberedPortRef = useRef<any>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<string> | null>(null);
  const readLoopRef = useRef<Promise<void> | null>(null);
  const installButtonRef = useRef<HTMLElement | null>(null);
  const reconnectAfterFlashRef = useRef(false);
  const configBackupRef = useRef<any | null>(null);
  const restoreAfterReconnectRef = useRef(false);
  const configTransferRef = useRef<ConfigTransferState | null>(null);
  const configOverridesRef = useRef<Partial<DeviceConfig> | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setSerialSupported(
      typeof navigator !== "undefined" && "serial" in navigator,
    );
  }, []);

  useEffect(() => {
    void import("esp-web-tools/dist/web/install-button.js");
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(CONFIG_STORAGE_KEY);
      if (!raw) return;
      const parsed = normalizeDeviceConfig(JSON.parse(raw));
      configOverridesRef.current = parsed;
      setBoardConfig(parsed);
      setConfigDraft(parsed);
      setConfigBackupReady(true);
      setDefaultConfigMode(false);
      setFlashStatus(t.config.localLoaded);
    } catch (storageError) {
      console.error("[config-storage-load]", storageError);
    }
  }, []);

  useEffect(() => {
    QRCode.toDataURL(SUPPORT_AUTHOR_URL, {
      width: 176,
      margin: 1,
      color: { dark: "#0b2a4f", light: "#ffffff" },
    })
      .then(setSupportQrSrc)
      .catch((qrError) => console.error("[support-qr]", qrError));
  }, []);

  useEffect(() => {
    if (!owner || !repo) {
      setError(t.common.fillGithubEnv);
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
      .catch((fetchError: unknown) => {
        setError(
          fetchError instanceof Error
            ? fetchError.message
            : t.common.releasesLoadFailed,
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
    ? t.flash.serialUnsupported
    : flashBusy
      ? t.flash.busy
      : portState === "connecting"
        ? t.flash.connecting
        : !selectedRelease
          ? t.flash.chooseRelease
          : !firmwareAsset || !littlefsAsset
            ? t.flash.requireAssets
            : defaultConfigMode
              ? t.flash.defaultConfig
              : configBackupReady
                ? t.flash.restoreConfig
                : t.flash.autoFlow;

  function syncBoardConfig(configPayload: any) {
    const normalized = normalizeDeviceConfig(configPayload);
    setBoardConfig(normalized);
    setConfigDraft(normalized);
    return normalized;
  }

  function persistConfigToLocal(configPayload: Partial<DeviceConfig> | null) {
    if (typeof window === "undefined") return;
    try {
      if (!configPayload) {
        window.localStorage.removeItem(CONFIG_STORAGE_KEY);
        return;
      }
      const normalized = normalizeDeviceConfig(configPayload);
      window.localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(normalized));
    } catch (storageError) {
      console.error("[config-storage-save]", storageError);
    }
  }

  function getMergedConfigPayload(baseConfig: any) {
    const normalized = {
      ...(baseConfig || {}),
      ...normalizeDeviceConfig(baseConfig),
      ...(configOverridesRef.current || {}),
    };
    normalized.mqttPort = Number(normalized.mqttPort || 1883) || 1883;
    delete normalized.adminPassword;
    return normalized;
  }

  function hasConfigOverrides() {
    return Boolean(configOverridesRef.current);
  }

  function openConfigModal() {
    const draft = normalizeDeviceConfig({
      ...boardConfig,
      ...(configOverridesRef.current || {}),
    });
    setConfigDraft(draft);
    setConfigModalOpen(true);
  }

  function updateConfigDraft(field: keyof DeviceConfig, value: string) {
    setConfigDraft((prev) =>
      normalizeDeviceConfig({
        ...prev,
        [field]: field === "mqttPort" ? Number(value || 1883) : value,
      }),
    );
  }

  async function saveConfigDraft() {
    const normalized = normalizeDeviceConfig(configDraft);
    const overrides: Partial<DeviceConfig> = {
      wifiSsid: normalized.wifiSsid,
      wifiPass: normalized.wifiPass,
      mqttHost: normalized.mqttHost,
      mqttPort: normalized.mqttPort,
      mqttTopic: normalized.mqttTopic,
      mqttUser: normalized.mqttUser,
      mqttPass: normalized.mqttPass,
    };

    configOverridesRef.current = overrides;
    persistConfigToLocal(overrides);

    const merged = getMergedConfigPayload({
      ...boardConfig,
      ...overrides,
    });

    configBackupRef.current = merged;
    syncBoardConfig(merged);
    setConfigBackupReady(true);
    setDefaultConfigMode(false);

    try {
      if (
        portState === "connected" &&
        isPortOpen(rememberedPortRef.current ?? portRef.current) &&
        !flashBusy
      ) {
        setFlashBusy(true);
        setFlashStatus(t.config.applying);
        await restoreConfigViaSerial(merged);
        await disconnectPort({ preserveBackupState: true });
        await new Promise((resolve) => setTimeout(resolve, 3000));
        await reconnectBoardAfterFlash();
        await new Promise((resolve) => setTimeout(resolve, 1800));
        try {
          configBackupRef.current = getMergedConfigPayload(
            await backupConfigWithRetry(2),
          );
          syncBoardConfig(configBackupRef.current);
        } catch {
          configBackupRef.current = merged;
        }
        setFlashStatus(t.config.applied);
      } else {
        setFlashStatus(t.config.staged);
      }
      setConfigModalOpen(false);
    } catch (configApplyError) {
      console.error("[config-apply]", configApplyError);
      setFlashStatus(t.config.applyFailed);
    } finally {
      setFlashBusy(false);
    }
  }

  function exportConfigDraft() {
    const payload = getMergedConfigPayload({
      ...boardConfig,
      ...(configOverridesRef.current || {}),
    });
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "alarmmini-config.json";
    link.click();
    URL.revokeObjectURL(url);
  }

  async function importConfigFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const parsed = normalizeDeviceConfig(JSON.parse(text));
      configOverridesRef.current = parsed;
      configBackupRef.current = getMergedConfigPayload({
        ...boardConfig,
        ...parsed,
      });
      syncBoardConfig(configBackupRef.current);
      setConfigBackupReady(true);
      setDefaultConfigMode(false);
      persistConfigToLocal(parsed);
      setFlashStatus(t.config.imported);
      setConfigModalOpen(true);
    } catch (importError) {
      console.error("[config-import]", importError);
      setFlashStatus(t.config.importFailed);
    } finally {
      event.target.value = "";
    }
  }

  useEffect(() => {
    if (!selectedRelease || !firmwareAsset || !littlefsAsset) {
      setInstallManifestUrl("");
      return;
    }

    const origin =
      typeof window !== "undefined" ? window.location.origin : "";
    const firmwarePath = `${origin}/api/release-asset?source=${encodeURIComponent(
      firmwareAsset.browser_download_url,
    )}`;
    const littlefsPath = `${origin}/api/release-asset?source=${encodeURIComponent(
      littlefsAsset.browser_download_url,
    )}`;

    const manifest = {
      name: "AlarmMini",
      version:
        selectedRelease.tag_name || selectedRelease.name || "unversioned",
      new_install_prompt_erase: false,
      new_install_improv_wait_time: 0,
      builds: [
        {
          chipFamily: "ESP8266",
          parts: [
            {
              path: firmwarePath,
              offset: 0,
            },
            {
              path: littlefsPath,
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
    const activePort = portRef.current ?? rememberedPortRef.current;

    try {
      await readerRef.current?.cancel();
    } catch {}

    try {
      await readLoopRef.current;
    } catch {}

    try {
      await activePort?.close();
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

  function resetConfigTransferState() {
    clearConfigTransferTimeout();
    configTransferRef.current = null;
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
      if (transfer.readyResolve) {
        const readyResolve = transfer.readyResolve;
        transfer.readyResolve = null;
        readyResolve();
      }
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
      } catch {
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

    setFlashStatus(t.flash.readingConfig);
    resetConfigTransferState();

    return await new Promise<any>(async (resolve, reject) => {
      configTransferRef.current = {
        mode: "backup",
        resolve,
        reject,
        buffer: "",
        timeoutId: setTimeout(
          () => rejectConfigTransfer("backup_timeout"),
          15000,
        ),
        readyResolve: null,
      };

      try {
        await writeSerialLine("AMCFG GET");
      } catch {
        rejectConfigTransfer("backup_write_failed");
      }
    });
  }

  async function restoreConfigViaSerial(configPayload: any) {
    const serialized = JSON.stringify(configPayload || {});
    setFlashStatus(t.flash.restoringConfig);
    resetConfigTransferState();

    await new Promise<boolean>(async (resolve, reject) => {
      configTransferRef.current = {
        mode: "restore",
        resolve,
        reject,
        buffer: "",
        timeoutId: setTimeout(
          () => rejectConfigTransfer("restore_timeout"),
          15000,
        ),
        readyResolve: null,
      };

      try {
        await writeSerialLine("AMCFG SET BEGIN");
        await new Promise<void>((readyResolve, readyReject) => {
          const transfer = configTransferRef.current;
          if (!transfer) {
            readyReject(new Error("restore_not_initialized"));
            return;
          }
          transfer.timeoutId = setTimeout(
            () => rejectConfigTransfer("restore_ready_timeout"),
            5000,
          );
          transfer.readyResolve = readyResolve;
        });
        const chunkSize = 192;
        for (let offset = 0; offset < serialized.length; offset += chunkSize) {
          await writeSerialLine(
            `AMCFG SET DATA ${serialized.slice(offset, offset + chunkSize)}`,
          );
          await new Promise((resolve) => setTimeout(resolve, 12));
        }
        clearConfigTransferTimeout();
        if (configTransferRef.current) {
          configTransferRef.current.timeoutId = setTimeout(
            () => rejectConfigTransfer("restore_timeout"),
            15000,
          );
        }
        await writeSerialLine("AMCFG SET END");
      } catch {
        rejectConfigTransfer("restore_write_failed");
      }
    });
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
      .catch((readError) => {
        console.error("[serial-read]", readError);
      })
      .finally(async () => {
        try {
          reader.releaseLock();
        } catch {}
        if (readerRef.current === reader) {
          readerRef.current = null;
        }
        await readableClosed;
      });
  }

  async function backupConfigWithRetry(attempts = 3) {
    let lastError: unknown = null;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        if (attempt > 0) {
          await new Promise((resolve) => setTimeout(resolve, 1200));
        }
        const backup = await backupConfigViaSerial();
        if (backup) return backup;
      } catch (backupError) {
        lastError = backupError;
        resetConfigTransferState();
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error("backup_timeout");
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

  async function handleConnect() {
    if (!("serial" in navigator)) return;
    if (
      portState === "connected" &&
      isPortOpen(portRef.current ?? rememberedPortRef.current)
    ) {
      return;
    }

    try {
      setPortState("connecting");
      setBoard(getEmptyBoard());
      setSerialLog([]);
      const serial = (navigator as Navigator & { serial: any }).serial;
      const port = await serial.requestPort();
      await openBoardPort(port);
      await new Promise((resolve) => setTimeout(resolve, 2500));
      try {
        configBackupRef.current = getMergedConfigPayload(
          await backupConfigWithRetry(),
        );
        syncBoardConfig(configBackupRef.current);
        setConfigBackupReady(Boolean(configBackupRef.current));
        setDefaultConfigMode(false);
        setFlashStatus(t.flash.configReadOk);
      } catch (backupError) {
        console.error("[config-backup-init]", backupError);
        configBackupRef.current = null;
        setConfigBackupReady(false);
        setDefaultConfigMode(true);
        setFlashStatus(t.flash.configReadFailedCanContinue);
      }
    } catch (connectError) {
      console.error("[serial-connect]", connectError);
      await disconnectPort();
    }
  }

  async function ensureConnectedAndBackedUp() {
    if (!("serial" in navigator)) throw new Error("serial_unsupported");

    if (portState !== "connected") {
      setFlashStatus(t.flash.connectingBoard);
      setPortState("connecting");
      setBoard(getEmptyBoard());
      setSerialLog([]);

      const serial = (navigator as Navigator & { serial: any }).serial;
      const knownPorts = await serial.getPorts();
      const port = knownPorts[0] ?? (await serial.requestPort());
      await openBoardPort(port);
      await new Promise((resolve) => setTimeout(resolve, 2500));
    }

    if (!configBackupRef.current && !defaultConfigMode) {
      try {
        const backup = getMergedConfigPayload(await backupConfigWithRetry());
        configBackupRef.current = backup;
        syncBoardConfig(backup);
        setConfigBackupReady(Boolean(backup));
        setDefaultConfigMode(false);
      } catch (backupError) {
        console.error("[config-backup-check]", backupError);
        configBackupRef.current = null;
        setConfigBackupReady(false);
        setDefaultConfigMode(true);
      }
    }

    if (!configBackupRef.current && !defaultConfigMode) {
      setFlashStatus(t.flash.configNotReadContinue);
      return null;
    }

    if (configBackupRef.current) {
      setFlashStatus(t.flash.configReadOkStarting);
    }

    return configBackupRef.current;
  }

  async function reconnectBoardAfterFlash() {
    if (!("serial" in navigator)) return;

    const serial = (navigator as Navigator & { serial: any }).serial;
    const port =
      rememberedPortRef.current ?? (await serial.getPorts()).find(Boolean);

    if (!port) return;

    try {
      setPortState("connecting");
      setBoard(getEmptyBoard());
      setSerialLog([]);
      await openBoardPort(port);
    } catch (reconnectError) {
      console.error("[serial-reconnect]", reconnectError);
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
    setFlashStatus(t.flash.stageFlashed);
    if (!reconnectAfterFlashRef.current) return;
    reconnectAfterFlashRef.current = false;
    restoreAfterReconnectRef.current =
      Boolean(configBackupRef.current || hasConfigOverrides());
    await new Promise((resolve) => setTimeout(resolve, 500));
    await reconnectBoardAfterFlash();
    if (!restoreAfterReconnectRef.current) {
      setFlashBusy(false);
      setFlashStage("done");
      setFlashStatus(t.flash.doneWithDefault);
    }
  }

  async function handleFlashStart() {
    if (!canFlashSelectedRelease || !installButtonRef.current) return;

    reconnectAfterFlashRef.current = true;
    setFlashBusy(true);
    setFlashStage("");
    setFlashStatus(t.flash.preparing);

    try {
      const backup = await ensureConnectedAndBackedUp();

      if (!backup) {
        const continueWithDefault = window.confirm(
          t.flash.continueWithDefaultQuestion,
        );
        if (!continueWithDefault) {
          reconnectAfterFlashRef.current = false;
          setFlashBusy(false);
          setFlashStatus(t.flash.flashCancelled);
          return;
        }

        configBackupRef.current = null;
        setConfigBackupReady(false);
        setDefaultConfigMode(true);
        setFlashStatus(t.flash.continuingWithDefault);
      }

      if (rememberedPortRef.current || portRef.current) {
        await disconnectPort({
          preserveBackupState: Boolean(configBackupRef.current),
        });
        await new Promise((resolve) => setTimeout(resolve, 600));
      }

      const observer = new MutationObserver((mutations, obs) => {
        for (const mutation of mutations) {
          for (const node of Array.from(mutation.addedNodes)) {
            if (
              node instanceof HTMLElement &&
              node.tagName.toLowerCase() === "ewt-install-dialog"
            ) {
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
      setFlashStatus(t.flash.openingDialog);
      await startEspInstall(installButtonRef.current);
    } catch (flashError) {
      reconnectAfterFlashRef.current = false;
      setFlashBusy(false);
      setConfigBackupReady(Boolean(configBackupRef.current));
      setFlashStage("");
      setFlashStatus(
        defaultConfigMode
          ? t.flash.flashStartFailedDefault
          : t.flash.flashStartFailed,
      );
      console.error("[flash-start]", flashError);
      await reconnectBoardAfterFlash();
    }
  }

  useEffect(() => {
    if (
      flashBusy &&
      portState === "connected" &&
      restoreAfterReconnectRef.current
    ) {
      restoreAfterReconnectRef.current = false;
      void (async () => {
        try {
          await new Promise((resolve) => setTimeout(resolve, 1500));
          if (!configBackupRef.current) {
            const flashedConfig = await backupConfigWithRetry(3);
            configBackupRef.current = getMergedConfigPayload(flashedConfig);
            syncBoardConfig(configBackupRef.current);
          }
          setFlashStage("restoring");
          setFlashStatus(t.flash.stageRestoring);
          await restoreConfigViaSerial(
            getMergedConfigPayload(configBackupRef.current),
          );
          await disconnectPort({ preserveBackupState: true });
          await new Promise((resolve) => setTimeout(resolve, 3000));
          await reconnectBoardAfterFlash();
          try {
            configBackupRef.current = getMergedConfigPayload(
              await backupConfigWithRetry(2),
            );
            syncBoardConfig(configBackupRef.current);
            setConfigBackupReady(Boolean(configBackupRef.current));
            setDefaultConfigMode(false);
          } catch {
            configBackupRef.current = null;
            setConfigBackupReady(false);
          }
          setFlashStage("done");
          setFlashStatus(t.flash.stageDone);
        } catch (restoreError) {
          console.error("[config-restore]", restoreError);
          setFlashStage("");
          setFlashStatus(t.flash.restoreFailed);
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
            <div className="brand-title">{t.page.brandTitle}</div>
            <div className="brand-subtitle">{t.page.brandSubtitle}</div>
          </div>
        </div>

        <div className="sidebar-card">
          <div className="panel-label">{t.page.comBrowser}</div>
          <h2 className="panel-title">{t.page.connectBoardTitle}</h2>
          <p className="panel-text">{t.page.connectBoardText}</p>
          <div
            className={`status-pill ${serialSupported ? "is-ok" : "is-warn"}`}
          >
            {serialSupported ? t.page.webSerialAvailable : t.page.needChromium}
          </div>
          <div className="button-stack">
            <button
              className="primary-btn"
              onClick={handleConnect}
              disabled={
                !serialSupported || portState === "connecting" || flashBusy
              }
            >
              {portState === "connected"
                ? t.flash.connectedBtn
                : portState === "connecting"
                  ? t.flash.connectingBtn
                  : t.flash.connectBtn}
            </button>
            <button
              className="ghost-btn"
              onClick={() => void disconnectPort()}
              disabled={portState !== "connected" || flashBusy}
            >
              {t.flash.disconnectBtn}
            </button>
          </div>
        </div>

        <div className="sidebar-card">
          <div className="panel-label">{t.page.supportLabel}</div>
          <h2 className="panel-title">{t.page.supportTitle}</h2>

          <div className="support-qr-shell">
            {supportQrSrc ? (
              <img
                className="support-qr-image"
                src={supportQrSrc}
                alt={t.support.monoQrAlt}
              />
            ) : (
              <div className="support-qr-placeholder">
                {t.support.preparingQr}
              </div>
            )}
          </div>
          <div className="button-stack">
            <a
              className="primary-btn support-link"
              href={SUPPORT_AUTHOR_URL}
              target="_blank"
              rel="noreferrer"
            >
              {t.support.supportAuthor}
            </a>
            <a
              className="ghost-btn support-link"
              href={TELEGRAM_GROUP_URL}
              target="_blank"
              rel="noreferrer"
            >
              {t.support.telegramGroup}
            </a>
          </div>
        </div>

        <div className="sidebar-card">
          <div className="panel-label">{t.page.githubLabel}</div>
          <h2 className="panel-title">{t.page.githubTitle}</h2>
          <p className="panel-text">{t.page.githubText}</p>
          <div className="button-stack">
            <a
              className="ghost-btn support-link"
              href={PROJECT_REPO_URL}
              target="_blank"
              rel="noreferrer"
            >
              {t.support.openGithub}
            </a>
          </div>
        </div>
      </aside>

      <section className="installer-content">
        <header className="hero-card">
          <div className="hero-copy">
            <div className="content-eyebrow">{t.page.eyebrow}</div>
            <h1 className="content-title">{t.page.title}</h1>
          </div>
        </header>

        <div className="content-grid">
          <section className="panel-card installer-panel">
            <div className="panel-head">
              <div>
                <div className="panel-label">{t.page.releasesLabel}</div>
                <h2 className="panel-title">{t.page.releasesTitle}</h2>
              </div>
            </div>

            {loading && <div className="state-box">{t.page.releasesLoading}</div>}
            {error && <div className="state-box state-box-error">{error}</div>}
            {!loading && !error && releases.length === 0 && (
              <div className="state-box">{t.page.noReleases}</div>
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
                          {isActive ? t.page.selected : t.page.select}
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
                              {t.common.open}
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
              <div className="panel-label">{t.page.selectedReleaseLabel}</div>
              <div className="hero-release">
                {selectedRelease?.name ||
                  selectedRelease?.tag_name ||
                  t.flash.releaseMissing}
              </div>
              <div className="hero-assets">
                <span>
                  {firmwareAsset ? firmwareAsset.name : t.flash.firmwareMissing}
                </span>
                <span>
                  {littlefsAsset
                    ? littlefsAsset.name
                    : t.flash.littlefsMissing}
                </span>
              </div>
              <div
                className={`status-pill ${configBackupReady ? "is-ok" : "is-warn"}`}
              >
                {configBackupReady
                  ? t.flash.backupSaved
                  : t.flash.backupRequired}
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
                  {flashBusy ? t.flash.flashPreparingBtn : t.flash.flashBtn}
                </button>
              </div>
              <div className="hero-hint">{flashHint}</div>
              {flashStatus ? (
                <div
                  className={`hero-hint ${flashStage ? `flash-stage flash-stage-${flashStage}` : ""}`}
                >
                  {flashStatus}
                </div>
              ) : null}
            </div>

            <div className="panel-head">
              <div>
                <div className="panel-label">{t.page.comStatusLabel}</div>
                <h2 className="panel-title">{t.page.boardInfoTitle}</h2>
              </div>
            </div>

            <div className="config-summary">
              <div className="panel-head">
                <div>
                  <div className="panel-label">{t.config.title}</div>
                  <h3 className="panel-title">{t.config.subtitle}</h3>
                </div>
                <button
                  type="button"
                  className="inline-btn config-edit-btn"
                  onClick={openConfigModal}
                  disabled={flashBusy}
                >
                  {t.config.edit}
                </button>
              </div>

              <div className="board-grid">
                <div className="info-tile">
                  <span>{t.config.configuredWifi}</span>
                  <strong>{boardConfig.wifiSsid || t.config.notSet}</strong>
                </div>
                <div className="info-tile">
                  <span>{t.config.configuredMqtt}</span>
                  <strong>{boardConfig.mqttHost || t.config.notSet}</strong>
                </div>
              </div>
            </div>

            <div className="board-grid">
              <div className="info-tile">
                <span>{t.page.wifi}</span>
                <strong>{board.wifiStatus}</strong>
              </div>
              <div className="info-tile">
                <span>{t.page.internet}</span>
                <strong>{board.internetStatus}</strong>
              </div>
              <div className="info-tile">
                <span>{t.page.mqtt}</span>
                <strong>{board.mqttStatus}</strong>
              </div>
              <div className="info-tile">
                <span>{t.page.ip}</span>
                <strong>{board.ip}</strong>
              </div>
              <div className="info-tile">
                <span>{t.page.mdns}</span>
                <strong>{board.mdnsUrl}</strong>
              </div>
              <div className="info-tile">
                <span>{t.page.password}</span>
                <strong>{board.adminPassword}</strong>
              </div>
              <div className="info-tile">
                <span>{t.page.firmware}</span>
                <strong>{board.firmwareVersion}</strong>
              </div>
              <div className="info-tile">
                <span>{t.page.lastLine}</span>
                <strong>{board.lastLine}</strong>
              </div>
            </div>

            <div className="serial-log">
              <div className="serial-head">
                <span className="panel-label">{t.page.serialLogLabel}</span>
                <span
                  className={`status-pill ${portState === "connected" ? "is-ok" : "is-muted"}`}
                >
                  {portState === "connected"
                    ? t.board.streaming
                    : t.board.notReading}
                </span>
              </div>
              <div className="serial-lines">
                {serialLog.length === 0 ? (
                  <div className="serial-empty">{t.board.connectToSeeLog}</div>
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

      {configModalOpen ? (
        <div
          className="config-modal-backdrop"
          onClick={() => setConfigModalOpen(false)}
        >
          <div
            className="config-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="panel-head">
              <div>
                <div className="panel-label">{t.config.title}</div>
                <h2 className="panel-title">{t.config.subtitle}</h2>
              </div>
            </div>

            <div className="config-section">
              <div className="panel-label">{t.config.wifiTitle}</div>
              <div className="config-form-grid">
                <label className="config-field">
                  <span>{t.config.ssid}</span>
                  <input
                    type="text"
                    value={configDraft.wifiSsid}
                    onChange={(event) =>
                      updateConfigDraft("wifiSsid", event.target.value)
                    }
                  />
                </label>
                <label className="config-field">
                  <span>{t.config.wifiPassword}</span>
                  <input
                    type="text"
                    value={configDraft.wifiPass}
                    onChange={(event) =>
                      updateConfigDraft("wifiPass", event.target.value)
                    }
                  />
                </label>
              </div>
            </div>

            <div className="config-section">
              <div className="panel-label">{t.config.mqttTitle}</div>
              <div className="config-form-grid">
                <label className="config-field">
                  <span>{t.config.host}</span>
                  <input
                    type="text"
                    value={configDraft.mqttHost}
                    onChange={(event) =>
                      updateConfigDraft("mqttHost", event.target.value)
                    }
                  />
                </label>
                <label className="config-field">
                  <span>{t.config.port}</span>
                  <input
                    type="number"
                    value={configDraft.mqttPort}
                    onChange={(event) =>
                      updateConfigDraft("mqttPort", event.target.value)
                    }
                  />
                </label>
                <label className="config-field">
                  <span>{t.config.topic}</span>
                  <input
                    type="text"
                    value={configDraft.mqttTopic}
                    onChange={(event) =>
                      updateConfigDraft("mqttTopic", event.target.value)
                    }
                  />
                </label>
                <label className="config-field">
                  <span>{t.config.user}</span>
                  <input
                    type="text"
                    value={configDraft.mqttUser}
                    onChange={(event) =>
                      updateConfigDraft("mqttUser", event.target.value)
                    }
                  />
                </label>
                <label className="config-field">
                  <span>{t.config.mqttPassword}</span>
                  <input
                    type="text"
                    value={configDraft.mqttPass}
                    onChange={(event) =>
                      updateConfigDraft("mqttPass", event.target.value)
                    }
                  />
                </label>
              </div>
            </div>

            <div className="button-stack config-modal-actions">
              <input
                ref={importInputRef}
                type="file"
                accept="application/json"
                className="config-import-input"
                onChange={(event) => void importConfigFile(event)}
              />
              <button
                type="button"
                className="ghost-btn"
                onClick={() => importInputRef.current?.click()}
              >
                {t.config.import}
              </button>
              <button
                type="button"
                className="ghost-btn"
                onClick={exportConfigDraft}
              >
                {t.config.export}
              </button>
              <button
                type="button"
                className="ghost-btn"
                onClick={() => setConfigModalOpen(false)}
              >
                {t.config.close}
              </button>
              <button
                type="button"
                className="primary-btn"
                onClick={saveConfigDraft}
              >
                {t.config.save}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

