"use client";

import { createElement, useEffect, useMemo, useRef, useState } from "react";
import { connect as startEspInstall } from "esp-web-tools/dist/connect.js";
import QRCode from "qrcode";
import CodeMirror from "@uiw/react-codemirror";
import { json as jsonLang } from "@codemirror/lang-json";
import { oneDark } from "@codemirror/theme-one-dark";

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

type DeviceInfo = {
  fw: string;
  ip: string;
  mdns: string;
  hostname: string;
  adminPassword: string;
  resetReason: string;
  lastStage: string;
  bootCount: string;
};

type BoardTarget = "esp8266" | "esp32c3";
type PortState = "idle" | "connecting" | "connected";
type NetworkTab = "wifi" | "mqtt";

type PendingRequest = {
  matcher: (obj: any) => boolean;
  resolve: (obj: any) => void;
  reject: (reason?: unknown) => void;
  timeoutId: ReturnType<typeof setTimeout>;
};

type BoardAssets = {
  firmware: ReleaseAsset | null;
  littlefs: ReleaseAsset | null;
  bootloader?: ReleaseAsset | null;
  partitions?: ReleaseAsset | null;
  bootApp0?: ReleaseAsset | null;
};
type PipelineState = "pending" | "active" | "done" | "error" | "skipped";
type PipelineStepId = "backup" | "flash" | "reconnect" | "restoreWifi" | "restoreConfig" | "verify";

const BACKUP_STORAGE_KEY = "alarmmini.backup.config";
const PIPELINE_STEPS: Array<{ id: PipelineStepId; label: string }> = [
  { id: "backup", label: "Backup конфігу" },
  { id: "flash", label: "Прошивка" },
  { id: "reconnect", label: "Перепідключення" },
  { id: "restoreWifi", label: "Відновлення Wi‑Fi" },
  { id: "restoreConfig", label: "Відновлення JSON" },
  { id: "verify", label: "Перевірка" },
];

const owner = process.env.NEXT_PUBLIC_GITHUB_OWNER || "WebDev-Den";
const repo = process.env.NEXT_PUBLIC_GITHUB_REPO || "AlarmMini";
const SUPPORT_AUTHOR_URL = "https://send.monobank.ua/jar/2PMhPjRk9j";
const TELEGRAM_GROUP_URL = "https://t.me/+j3zFZHE5gGoyNGYy";
const GITHUB_REPO_URL = `https://github.com/${owner}/${repo}`;

function buildStandardNewDeviceConfig() {
  return {
    c: {
      d: { a: [255, 0, 0, 255], c: [0, 80, 0, 80] },
      n: { a: [25, 0, 0, 24], c: [0, 0, 0, 0] },
    },
    n: { e: true, s: [22, 0], x: [8, 0], b: 150, p: [false, false] },
    z: { e: false, v: [80, 30], r: [20] },
    k: { e: true, i: [75, 30] },
    o: { a: 60, p: 60, d: 2400, s: 100, c: 60 },
    l: [24, 19, 6, 3, 10, 18, 2, 2, 14, 16, 23, 8, 4, 15, 1, 11, 5, 7, 22, 17, 20, 0, 21, 9, 12, 13, 13],
    m: { h: "", p: 1883, t: "", u: "", s: "" },
    w: { s: "", p: "" },
    t: ["", "", ""],
    g: 0,
  };
}

const EMPTY_INFO: DeviceInfo = {
  fw: "-",
  ip: "-",
  mdns: "-",
  hostname: "-",
  adminPassword: "-",
  resetReason: "-",
  lastStage: "-",
  bootCount: "-",
};

function normalizeAssetName(name: string) {
  return name.toLowerCase().replace(/[\s_]+/g, "-");
}

function findAsset(assets: ReleaseAsset[], boardTokens: string[], kindTokens: string[]) {
  return (
    assets.find((asset) => {
      const n = normalizeAssetName(asset.name);
      return boardTokens.some((t) => n.includes(t)) && kindTokens.some((t) => n.includes(t));
    }) ?? null
  );
}

function resolveBoardAssets(release: GithubRelease | null, board: BoardTarget): BoardAssets {
  if (!release) {
    return { firmware: null, littlefs: null, bootloader: null, partitions: null, bootApp0: null };
  }

  const assets = release.assets || [];
  if (board === "esp8266") {
    return {
      firmware: findAsset(assets, ["esp8266", "d1-mini", "usb"], ["firmware"]),
      littlefs: findAsset(assets, ["esp8266", "d1-mini", "usb"], ["littlefs", "spiffs"]),
      bootloader: null,
      partitions: null,
      bootApp0: null,
    };
  }

  return {
    firmware: findAsset(assets, ["esp32c3", "esp32-c3", "c3"], ["firmware"]),
    littlefs: findAsset(assets, ["esp32c3", "esp32-c3", "c3"], ["littlefs", "spiffs"]),
    bootloader: findAsset(assets, ["esp32c3", "esp32-c3", "c3"], ["bootloader"]),
    partitions: findAsset(assets, ["esp32c3", "esp32-c3", "c3"], ["partitions"]),
    bootApp0: findAsset(assets, ["esp32c3", "esp32-c3", "c3"], ["boot-app0", "boot_app0", "bootapp0"]),
  };
}

function formatBytes(size: number) {
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(2)} MB`;
  if (size >= 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${size} B`;
}

function extractWifi(configObj: any) {
  const wifiCompact = configObj?.w;
  return {
    ssid: String(wifiCompact?.s ?? configObj?.wifiSsid ?? ""),
    password: String(wifiCompact?.p ?? configObj?.wifiPass ?? ""),
  };
}

function extractMqtt(configObj: any) {
  const mqttCompact = configObj?.m;
  return {
    host: String(mqttCompact?.h ?? configObj?.mqttHost ?? ""),
    port: String(mqttCompact?.p ?? configObj?.mqttPort ?? ""),
    topic: String(mqttCompact?.t ?? configObj?.mqttTopic ?? ""),
    user: String(mqttCompact?.u ?? configObj?.mqttUser ?? ""),
    password: String(mqttCompact?.s ?? configObj?.mqttPassword ?? ""),
  };
}

function safeParseJsonObject(text: string) {
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("JSON root має бути об'єктом");
  }
  return parsed;
}

function configLooksEmpty(cfg: any) {
  if (!cfg || typeof cfg !== "object") return true;
  const wifi = extractWifi(cfg);
  const mqtt = extractMqtt(cfg);
  const leds = Array.isArray(cfg?.l) ? cfg.l : [];
  const hasLedMapping = leds.some((v: unknown) => typeof v === "number" && Number(v) >= 0);
  const hasNetworkData = Boolean(
    wifi.ssid?.trim() ||
    mqtt.host?.trim() ||
    mqtt.topic?.trim() ||
    mqtt.user?.trim(),
  );
  return !hasLedMapping && !hasNetworkData;
}

function sanitizeLogLine(raw: string) {
  const normalized = raw
    .replace(/\t/g, "    ")
    .replace(/[^\u000A\u000D\u0020-\u007E\u00A0-\u024F\u0400-\u04FF]/g, "�");
  const maxLen = 420;
  return normalized.length > maxLen ? `${normalized.slice(0, maxLen)}…` : normalized;
}

function compactJsonLog(obj: any) {
  if (!obj || typeof obj !== "object") return "";
  if (obj?.event === "config") {
    const cfg = obj?.config;
    const wifi = extractWifi(cfg);
    const mqtt = extractMqtt(cfg);
    const ledCount = Array.isArray(cfg?.l) ? cfg.l.length : 0;
    return `[config] wifi="${wifi.ssid || "-"}" mqtt="${mqtt.host || "-"}" leds=${ledCount}`;
  }
  if (obj?.event === "device_info") {
    return `[device_info] fw=${obj?.fw ?? "-"} ip=${obj?.ip ?? "-"} host=${obj?.hostname ?? "-"}`;
  }
  if (obj?.status === "ACK" || obj?.status === "NACK") {
    return `[${obj.status}] ${obj?.cmd ?? "-"}${obj?.reason ? ` (${obj.reason})` : ""}`;
  }
  return sanitizeLogLine(JSON.stringify(obj));
}

function createPipelineInitialState(restoreSettings: boolean): Record<PipelineStepId, PipelineState> {
  return {
    backup: restoreSettings ? "pending" : "skipped",
    flash: "pending",
    reconnect: "pending",
    restoreWifi: restoreSettings ? "pending" : "skipped",
    restoreConfig: restoreSettings ? "pending" : "skipped",
    verify: restoreSettings ? "pending" : "skipped",
  };
}

function buildConfigValidationErrors(cfg: any) {
  const errors: string[] = [];
  if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) {
    return ["Корінь JSON має бути об'єктом"];
  }

  if (!Array.isArray(cfg.l)) errors.push("Поле l (LED map) має бути масивом");
  if (!cfg.w || typeof cfg.w !== "object") errors.push("Поле w (Wi‑Fi) відсутнє");
  if (!cfg.m || typeof cfg.m !== "object") errors.push("Поле m (MQTT) відсутнє");
  if (!Array.isArray(cfg.t)) errors.push("Поле t (NTP) має бути масивом із 3 значень");
  if (cfg.g == null) errors.push("Поле g (log mask) відсутнє");

  if (cfg.w && typeof cfg.w === "object") {
    if (typeof cfg.w.s !== "string") errors.push("w.s (SSID) має бути рядком");
    if (cfg.w.p != null && typeof cfg.w.p !== "string") errors.push("w.p (password) має бути рядком");
  }

  if (cfg.m && typeof cfg.m === "object") {
    if (cfg.m.h != null && typeof cfg.m.h !== "string") errors.push("m.h (host) має бути рядком");
    if (cfg.m.t != null && typeof cfg.m.t !== "string") errors.push("m.t (topic) має бути рядком");
    if (cfg.m.p != null && !Number.isFinite(Number(cfg.m.p))) errors.push("m.p (port) має бути числом");
  }

  return errors;
}

function collectDiffPaths(expected: any, actual: any, path = ""): string[] {
  const diffs: string[] = [];
  const p = path || "$";
  if (typeof expected !== typeof actual) {
    diffs.push(p);
    return diffs;
  }

  if (expected == null || actual == null) {
    if (expected !== actual) diffs.push(p);
    return diffs;
  }

  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || expected.length !== actual.length) {
      diffs.push(`${p}.length`);
      return diffs;
    }
    for (let i = 0; i < expected.length; i++) {
      diffs.push(...collectDiffPaths(expected[i], actual[i], `${p}[${i}]`));
      if (diffs.length > 40) break;
    }
    return diffs;
  }

  if (typeof expected === "object") {
    // Compare only keys that existed in backup config.
    // Device firmware may append runtime/service fields after restore.
    const keys = Object.keys(expected).sort();
    for (const key of keys) {
      if (!(key in actual)) {
        diffs.push(`${p}.${key}`);
      } else {
        diffs.push(...collectDiffPaths(expected[key], actual[key], `${p}.${key}`));
      }
      if (diffs.length > 40) break;
    }
    return diffs;
  }

  if (expected !== actual) diffs.push(p);
  return diffs;
}

export default function Page() {
  const [serialSupported, setSerialSupported] = useState(false);
  const [portState, setPortState] = useState<PortState>("idle");
  const [status, setStatus] = useState("Готово");

  const [info, setInfo] = useState<DeviceInfo>(EMPTY_INFO);
  const [wifiSsid, setWifiSsid] = useState("");
  const [wifiPassword, setWifiPassword] = useState("");
  const [networkTab, setNetworkTab] = useState<NetworkTab>("wifi");
  const [mqttHost, setMqttHost] = useState("");
  const [mqttPort, setMqttPort] = useState("");
  const [mqttTopic, setMqttTopic] = useState("");
  const [mqttUser, setMqttUser] = useState("");
  const [mqttPassword, setMqttPassword] = useState("");
  const [configText, setConfigText] = useState("{}");
  const [downloadedConfig, setDownloadedConfig] = useState<any | null>(null);
  const [backupAvailable, setBackupAvailable] = useState(false);

  const [releases, setReleases] = useState<GithubRelease[]>([]);
  const [releasesLoading, setReleasesLoading] = useState(true);
  const [releasesError, setReleasesError] = useState("");
  const [selectedReleaseId, setSelectedReleaseId] = useState<number | null>(null);
  const [targetBoard, setTargetBoard] = useState<BoardTarget>("esp8266");

  const [flashBusy, setFlashBusy] = useState(false);
  const [flashStatus, setFlashStatus] = useState("");
  const [supportQrSrc, setSupportQrSrc] = useState("");
  const [isFlashingFlow, setIsFlashingFlow] = useState(false);
  const [waitActive, setWaitActive] = useState(false);
  const [waitLabel, setWaitLabel] = useState("");
  const [waitProgress, setWaitProgress] = useState(0);
  const [dangerousWriteArmed, setDangerousWriteArmed] = useState(false);
  const [configValidationErrors, setConfigValidationErrors] = useState<string[]>([]);
  const [newDeviceMode, setNewDeviceMode] = useState(false);
  const [pipelineState, setPipelineState] = useState<Record<PipelineStepId, PipelineState>>(
    createPipelineInitialState(false),
  );

  const [serialLines, setSerialLines] = useState<string[]>([]);

  const portRef = useRef<any>(null);
  const rememberedPortRef = useRef<any>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<string> | null>(null);
  const readLoopRef = useRef<Promise<void> | null>(null);
  const pendingRef = useRef<PendingRequest | null>(null);
  const installButtonRef = useRef<HTMLElement | null>(null);
  const manifestUrlRef = useRef<string>("");
  const backupConfigRef = useRef<any | null>(null);

  useEffect(() => {
    setSerialSupported(typeof navigator !== "undefined" && "serial" in navigator);
    void import("esp-web-tools/dist/web/install-button.js");
  }, []);

  useEffect(() => {
    QRCode.toDataURL(SUPPORT_AUTHOR_URL, {
      width: 172,
      margin: 1,
      color: { dark: "#0b2a4f", light: "#ffffff" },
    })
      .then(setSupportQrSrc)
      .catch(() => setSupportQrSrc(""));
  }, []);

  useEffect(() => {
    if (!owner || !repo) {
      setReleasesError("Заповніть NEXT_PUBLIC_GITHUB_OWNER і NEXT_PUBLIC_GITHUB_REPO");
      setReleasesLoading(false);
      return;
    }

    fetch(`https://api.github.com/repos/${owner}/${repo}/releases`, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error(`GitHub API ${res.status}`);
        return res.json();
      })
      .then((data: GithubRelease[]) => {
        setReleases(data);
        setSelectedReleaseId(data[0]?.id ?? null);
      })
      .catch((error: unknown) => {
        setReleasesError(error instanceof Error ? error.message : "Не вдалося отримати релізи");
      })
      .finally(() => setReleasesLoading(false));
  }, []);

  useEffect(() => {
    return () => {
      void disconnectPort();
      if (manifestUrlRef.current) {
        URL.revokeObjectURL(manifestUrlRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(BACKUP_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
      backupConfigRef.current = parsed;
      setBackupAvailable(true);
    } catch {
      // ignore invalid backup in localStorage
    }
  }, []);

  const selectedRelease = useMemo(
    () => releases.find((r) => r.id === selectedReleaseId) ?? null,
    [releases, selectedReleaseId],
  );

  const boardAssets = useMemo(
    () => resolveBoardAssets(selectedRelease, targetBoard),
    [selectedRelease, targetBoard],
  );
  const jsonExtensions = useMemo(() => [jsonLang()], []);

  const boardAssetList = useMemo(() => {
    const list: ReleaseAsset[] = [];
    if (boardAssets.firmware) list.push(boardAssets.firmware);
    if (boardAssets.littlefs) list.push(boardAssets.littlefs);
    if (targetBoard === "esp32c3") {
      if (boardAssets.bootloader) list.push(boardAssets.bootloader);
      if (boardAssets.partitions) list.push(boardAssets.partitions);
      if (boardAssets.bootApp0) list.push(boardAssets.bootApp0);
    }
    return list;
  }, [boardAssets, targetBoard]);

  const selectedReleaseUpdatedAt = useMemo(() => {
    if (!selectedRelease?.published_at) return "";
    const dt = new Date(selectedRelease.published_at);
    if (Number.isNaN(dt.getTime())) return "";
    return new Intl.DateTimeFormat("uk-UA", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(dt);
  }, [selectedRelease]);

  const canFlash = useMemo(() => {
    if (!selectedRelease) return false;
    if (!boardAssets.firmware || !boardAssets.littlefs) return false;
    if (targetBoard === "esp32c3") {
      return Boolean(boardAssets.bootloader && boardAssets.partitions && boardAssets.bootApp0);
    }
    return true;
  }, [selectedRelease, boardAssets, targetBoard]);

  const manifestUrl = useMemo(() => {
    if (!canFlash || !selectedRelease || !boardAssets.firmware || !boardAssets.littlefs) return "";

    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const firmwarePath = `${origin}/api/release-asset?source=${encodeURIComponent(boardAssets.firmware.browser_download_url)}`;
    const littlefsPath = `${origin}/api/release-asset?source=${encodeURIComponent(boardAssets.littlefs.browser_download_url)}`;

    const manifest = {
      name: "AlarmMini",
      version: selectedRelease.tag_name || selectedRelease.name || "unversioned",
      new_install_prompt_erase: false,
      builds:
        targetBoard === "esp32c3"
          ? [
              {
                chipFamily: "ESP32-C3",
                parts: [
                  {
                    path: `${origin}/api/release-asset?source=${encodeURIComponent(boardAssets.bootloader!.browser_download_url)}`,
                    offset: 0,
                  },
                  {
                    path: `${origin}/api/release-asset?source=${encodeURIComponent(boardAssets.partitions!.browser_download_url)}`,
                    offset: 32768,
                  },
                  {
                    path: `${origin}/api/release-asset?source=${encodeURIComponent(boardAssets.bootApp0!.browser_download_url)}`,
                    offset: 57344,
                  },
                  { path: firmwarePath, offset: 65536 },
                  { path: littlefsPath, offset: 2686976 },
                ],
              },
            ]
          : [
              {
                chipFamily: "ESP8266",
                parts: [
                  { path: firmwarePath, offset: 0 },
                  { path: littlefsPath, offset: 2097152 },
                ],
              },
            ],
    };

    if (manifestUrlRef.current) URL.revokeObjectURL(manifestUrlRef.current);
    manifestUrlRef.current = URL.createObjectURL(new Blob([JSON.stringify(manifest)], { type: "application/json" }));
    return manifestUrlRef.current;
  }, [canFlash, selectedRelease, boardAssets, targetBoard]);

  function appendLog(line: string) {
    setSerialLines((prev) => [sanitizeLogLine(line), ...prev].slice(0, 120));
  }

  function setPipelineStep(step: PipelineStepId, state: PipelineState) {
    setPipelineState((prev) => ({ ...prev, [step]: state }));
  }

  function resetPipeline(restoreSettings: boolean) {
    setPipelineState(createPipelineInitialState(restoreSettings));
  }

  async function withBoardWait<T>(
    label: string,
    action: () => Promise<T>,
    timeoutMs = 60000,
    retryDelayMs = 1200,
  ): Promise<T> {
    const startedAt = Date.now();
    let lastError: unknown = null;
    setWaitLabel(label);
    setWaitProgress(0);
    setWaitActive(true);

    try {
      while (Date.now() - startedAt < timeoutMs) {
        const elapsed = Date.now() - startedAt;
        setWaitProgress(Math.min(98, Math.round((elapsed / timeoutMs) * 100)));
        try {
          const result = await action();
          setWaitProgress(100);
          return result;
        } catch (error) {
          lastError = error;
          await new Promise((r) => setTimeout(r, retryDelayMs));
        }
      }
      throw lastError instanceof Error ? lastError : new Error("timeout");
    } finally {
      setTimeout(() => {
        setWaitActive(false);
        setWaitLabel("");
        setWaitProgress(0);
      }, 250);
    }
  }

  function applyConfigToUi(cfg: any) {
    if (!cfg || typeof cfg !== "object") return;
    setDownloadedConfig(cfg);
    setConfigText(JSON.stringify(cfg, null, 2));
    const wifi = extractWifi(cfg);
    setWifiSsid(wifi.ssid);
    setWifiPassword(wifi.password);
    const mqtt = extractMqtt(cfg);
    setMqttHost(mqtt.host);
    setMqttPort(mqtt.port);
    setMqttTopic(mqtt.topic);
    setMqttUser(mqtt.user);
    setMqttPassword(mqtt.password);
  }

  function persistBackupConfig(cfg: any) {
    if (!cfg || typeof cfg !== "object") return;
    backupConfigRef.current = cfg;
    setBackupAvailable(true);
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(BACKUP_STORAGE_KEY, JSON.stringify(cfg));
      } catch {
        // ignore storage failure
      }
    }
  }

  function downloadBackupConfigFile() {
    const backup = backupConfigRef.current;
    if (!backup || typeof backup !== "object") {
      throw new Error("Backup JSON не знайдено");
    }
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = `alarmmini-backup-${ts}.json`;
    a.click();
    URL.revokeObjectURL(href);
  }

  function clearPending(reason: string) {
    const pending = pendingRef.current;
    if (!pending) return;
    clearTimeout(pending.timeoutId);
    pendingRef.current = null;
    pending.reject(new Error(reason));
  }

  function updateInfoFromPayload(payload: any) {
    const mapped: DeviceInfo = {
      fw: String(payload?.fw ?? info.fw ?? "-"),
      ip: String(payload?.ip ?? info.ip ?? "-"),
      mdns: String(payload?.mdns ?? info.mdns ?? "-"),
      hostname: String(payload?.hostname ?? info.hostname ?? "-"),
      adminPassword: String(payload?.adminPassword ?? info.adminPassword ?? "-"),
      resetReason: String(payload?.resetReason ?? info.resetReason ?? "-"),
      lastStage: String(payload?.lastStage ?? info.lastStage ?? "-"),
      bootCount: String(payload?.bootCount ?? info.bootCount ?? "-"),
    };
    setInfo(mapped);
  }

  function processJsonLine(obj: any) {
    if (obj?.event === "device_info") {
      updateInfoFromPayload(obj);
    }

    if (obj?.event === "config" && obj?.config && typeof obj.config === "object") {
      applyConfigToUi(obj.config);
    }

    const pending = pendingRef.current;
    if (!pending) return;

    if (obj?.status === "NACK") {
      clearTimeout(pending.timeoutId);
      pendingRef.current = null;
      pending.reject(new Error(String(obj?.reason || "NACK")));
      return;
    }

    if (pending.matcher(obj)) {
      clearTimeout(pending.timeoutId);
      pendingRef.current = null;
      pending.resolve(obj);
    }
  }

  async function startReadLoop(port: any) {
    const decoder = new TextDecoderStream();
    const readableClosed = port.readable.pipeTo(decoder.writable).catch(() => {});
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

        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line) continue;
          if (line.startsWith("{") && line.endsWith("}")) {
            try {
              const parsed = JSON.parse(line);
              processJsonLine(parsed);
              appendLog(compactJsonLog(parsed));
              continue;
            } catch {
              // ignore invalid json lines
            }
          }
          appendLog(line);
        }
      }
    })()
      .catch((err) => {
        appendLog(`READ_ERROR: ${String(err)}`);
      })
      .finally(async () => {
        try {
          reader.releaseLock();
        } catch {}
        if (readerRef.current === reader) readerRef.current = null;
        await readableClosed;
      });
  }

  function isPortOpen(port: any) {
    return Boolean(port?.readable || port?.writable);
  }

  async function ensureConnected(requestUser: boolean) {
    if (!serialSupported) throw new Error("Web Serial не підтримується");
    if (isPortOpen(portRef.current ?? rememberedPortRef.current) && portState === "connected") return;

    setPortState("connecting");
    let port = rememberedPortRef.current;

    if (!port) {
      const serialApi = (navigator as Navigator & { serial: any }).serial;
      if (requestUser) {
        port = await serialApi.requestPort();
      } else {
        const ports = await serialApi.getPorts();
        if (!ports?.length) throw new Error("Порт недоступний");
        port = ports[0];
      }
    }

    if (!isPortOpen(port)) {
      await port.open({ baudRate: 115200 });
    }

    rememberedPortRef.current = port;
    portRef.current = port;
    setPortState("connected");
    if (!readerRef.current) await startReadLoop(port);
    setStatus("Порт підключено");
  }

  async function disconnectPort() {
    try {
      await readerRef.current?.cancel();
    } catch {}

    try {
      await readLoopRef.current;
    } catch {}

    const port = portRef.current ?? rememberedPortRef.current;
    try {
      await port?.close();
    } catch {}

    if (pendingRef.current) {
      clearPending("disconnect");
    }

    readerRef.current = null;
    readLoopRef.current = null;
    portRef.current = null;
    setPortState("idle");
    setStatus("Порт відключено");
  }

  async function writeSerialLine(line: string) {
    const port = portRef.current ?? rememberedPortRef.current;
    if (!port?.writable) throw new Error("Порт не готовий до запису");
    const writer = port.writable.getWriter();
    try {
      await writer.write(new TextEncoder().encode(`${line}\n`));
    } finally {
      writer.releaseLock();
    }
  }

  async function sendAndWait(line: string, matcher: (obj: any) => boolean, timeoutMs = 9000) {
    return sendAndWaitInternal(line, matcher, timeoutMs, true);
  }

  async function sendAndWaitInternal(
    line: string,
    matcher: (obj: any) => boolean,
    timeoutMs: number,
    allowWatchdogRetry: boolean,
  ) {
    if (pendingRef.current) {
      clearPending("new_request");
    }

    const responsePromise = new Promise<any>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        if (pendingRef.current) {
          pendingRef.current = null;
        }
        reject(new Error("timeout"));
      }, timeoutMs);

      pendingRef.current = { matcher, resolve, reject, timeoutId };
    });

    try {
      await writeSerialLine(line);
      return await responsePromise;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (allowWatchdogRetry && msg.includes("timeout")) {
        appendLog("[watchdog] timeout -> reconnect port and retry command");
        try {
          await disconnectPort();
        } catch {}
        await withBoardWait("Watchdog: перепідключення COM (до 1 хв)...", async () => {
          await ensureConnected(false);
          return true;
        });
        return sendAndWaitInternal(line, matcher, timeoutMs, false);
      }
      throw error;
    }
  }

  async function cmdGetInfo() {
    await ensureConnected(true);
    setStatus("Зчитуємо get:info...");
    const obj = await sendAndWait("get:info", (j) => j?.event === "device_info", 6000);
    updateInfoFromPayload(obj);
    setStatus("Інформацію зчитано");
  }

  async function cmdGetConfig() {
    await ensureConnected(true);
    setStatus("Зчитуємо get:config...");
    const obj = await sendAndWait("get:config", (j) => j?.event === "config" && j?.config, 9000);
    const cfg = obj.config;
    applyConfigToUi(cfg);
    setNewDeviceMode(false);
    if (!isFlashingFlow && !configLooksEmpty(cfg)) {
      persistBackupConfig(cfg);
    }
    setStatus("Конфіг зчитано");
    return cfg;
  }

  async function cmdSetWifi() {
    await ensureConnected(true);
    if (!wifiSsid.trim()) throw new Error("SSID порожній");
    setStatus("Записуємо set:wifi...");
    await sendAndWait(
      `set:wifi ${JSON.stringify({ ssid: wifiSsid.trim(), password: wifiPassword })}`,
      (j) => j?.status === "ACK" && (j?.cmd === "set:wifi" || j?.cmd === "wifi_set"),
      9000,
    );
    setStatus("Wi‑Fi налаштовано");
    setNewDeviceMode(false);
    await cmdGetInfo();
  }

  async function cmdSetMqtt() {
    await ensureConnected(true);
    if (!mqttHost.trim()) throw new Error("MQTT host порожній");

    let configObj: any;
    try {
      configObj = safeParseJsonObject(configText);
    } catch {
      configObj = downloadedConfig && typeof downloadedConfig === "object" ? { ...downloadedConfig } : {};
    }

    const parsedPort = Number.parseInt(mqttPort.trim() || "1883", 10);
    const safePort = Number.isFinite(parsedPort) && parsedPort > 0 && parsedPort <= 65535 ? parsedPort : 1883;

    configObj.m = {
      ...(configObj.m && typeof configObj.m === "object" ? configObj.m : {}),
      h: mqttHost.trim(),
      p: safePort,
      t: mqttTopic.trim(),
      u: mqttUser.trim(),
      s: mqttPassword,
    };

    setStatus("Записуємо MQTT...");
    await sendAndWait(
      `set:config ${JSON.stringify(configObj)}`,
      (j) => j?.status === "ACK" && (j?.cmd === "set:config" || j?.cmd === "config_set"),
      14000,
    );
    setStatus("MQTT налаштовано");
    setNewDeviceMode(false);
    await cmdGetConfig();
  }

  async function cmdSetConfig() {
    await ensureConnected(true);
    const configObj = safeParseJsonObject(configText);
    const validation = buildConfigValidationErrors(configObj);
    setConfigValidationErrors(validation);
    if (validation.length) {
      throw new Error("JSON має помилки валідації");
    }

    if (configLooksEmpty(configObj) && !dangerousWriteArmed) {
      setDangerousWriteArmed(true);
      throw new Error("JSON виглядає порожнім. Натисни повторно після підтвердження");
    }

    setStatus("Записуємо set:config...");
    await sendAndWait(
      `set:config ${JSON.stringify(configObj)}`,
      (j) => j?.status === "ACK" && (j?.cmd === "set:config" || j?.cmd === "config_set"),
      14000,
    );
    setDangerousWriteArmed(false);
    setStatus("Конфіг записано");
    setNewDeviceMode(false);
    await cmdGetConfig();
  }

  async function waitDeviceInfoAfterReconnect(tries = 6) {
    await withBoardWait(
      "Очікуємо ініціалізацію плати після перезавантаження (до 1 хв)...",
      async () => {
        await ensureConnected(false);
        await sendAndWait("get:info", (j) => j?.event === "device_info", 6000);
      },
      60000,
      Math.max(700, Math.floor(1200 * (6 / Math.max(1, tries)))),
    );
  }

  async function restoreBackupConfigWithRetry(backup: any, maxAttempts = 3) {
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await waitDeviceInfoAfterReconnect(4);
        setFlashStatus(`Відновлення backup JSON: спроба ${attempt}/${maxAttempts}...`);
        await sendAndWait(
          `set:config ${JSON.stringify(backup)}`,
          (j) => j?.status === "ACK" && (j?.cmd === "set:config" || j?.cmd === "config_set"),
          18000,
        );
        const restored = await sendAndWait("get:config", (j) => j?.event === "config" && j?.config, 12000);
        applyConfigToUi(restored.config);
        return;
      } catch (error) {
        lastError = error;
        try {
          await disconnectPort();
        } catch {}
        await new Promise((r) => setTimeout(r, 1200));
      }
    }
    throw lastError instanceof Error ? lastError : new Error("Не вдалося відновити backup JSON");
  }

  async function cmdRestoreBackupJsonManual() {
    const backup = backupConfigRef.current;
    if (!backup || typeof backup !== "object") {
      throw new Error("Backup JSON не знайдено");
    }
    await ensureConnected(true);
    setStatus("Відновлюємо backup JSON на плату...");
    await restoreBackupConfigWithRetry(backup, 3);
    setStatus("Backup JSON успішно відновлено");
  }

  async function cmdSafeRestoreNetworkFromBackup() {
    const backup = backupConfigRef.current;
    if (!backup || typeof backup !== "object") {
      throw new Error("Backup JSON не знайдено");
    }

    await ensureConnected(true);
    setStatus("Safe restore: зчитуємо поточний config...");
    const currentObj = await sendAndWait("get:config", (j) => j?.event === "config" && j?.config, 12000);
    const current = currentObj?.config && typeof currentObj.config === "object" ? currentObj.config : {};
    const merged = {
      ...current,
      w: backup.w ?? current.w,
      m: backup.m ?? current.m,
    };
    setStatus("Safe restore: записуємо Wi‑Fi + MQTT...");
    await sendAndWait(
      `set:config ${JSON.stringify(merged)}`,
      (j) => j?.status === "ACK" && (j?.cmd === "set:config" || j?.cmd === "config_set"),
      18000,
    );
    await cmdGetConfig();
    setStatus("Safe restore завершено");
  }

  async function onConnectClick() {
    try {
      await ensureConnected(true);
      setStatus("Порт підключено. Очікуємо ініціалізацію плати...");
      await withBoardWait("Очікуємо відповідь плати (до 1 хв)...", async () => {
        const infoObj = await sendAndWait("get:info", (j) => j?.event === "device_info", 6000);
        updateInfoFromPayload(infoObj);
        const cfgObj = await sendAndWait("get:config", (j) => j?.event === "config" && j?.config, 9000);
        const cfg = cfgObj?.config;
        applyConfigToUi(cfg);
        if (cfg && !configLooksEmpty(cfg)) {
          persistBackupConfig(cfg);
        }
      });
      setNewDeviceMode(false);
      setStatus("Плата готова. Конфіг зчитано");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const isTimeoutLike =
        message.toLowerCase().includes("timeout") ||
        message.toLowerCase().includes("timed out");
      if (isTimeoutLike) {
        const fallbackCfg = buildStandardNewDeviceConfig();
        applyConfigToUi(fallbackCfg);
        setNewDeviceMode(true);
        setStatus("Плата не відповіла за 1 хв. Увімкнено режим нової плати (стандартний конфіг без Wi‑Fi/MQTT).");
      } else {
        setStatus(`Помилка підключення: ${message}`);
      }
    }
  }

  async function reconnectAfterFlash() {
    await withBoardWait("Очікуємо перепідключення плати (до 1 хв)...", async () => {
      await ensureConnected(false);
      return true;
    });
  }

  async function runFlashFlow(restoreSettings: boolean) {
    if (!canFlash || !manifestUrl || !installButtonRef.current) {
      throw new Error("Немає валідних файлів прошивки для обраної плати");
    }

    setFlashBusy(true);
    setIsFlashingFlow(true);
    resetPipeline(restoreSettings);
    setFlashStatus(
      restoreSettings
        ? "Починаємо підготовку до прошивки..."
        : "Починаємо прошивку нового пристрою...",
    );

    let backup: any | null = null;
    if (restoreSettings) {
      setPipelineStep("backup", "active");
      try {
        await ensureConnected(true);
        setFlashStatus("Перед прошивкою зчитуємо config з плати...");
        const obj = await sendAndWait("get:config", (j) => j?.event === "config" && j?.config, 10000);
        backup = obj.config;
        persistBackupConfig(backup);
        applyConfigToUi(backup);
        setFlashStatus("Backup config збережено. Запускаємо прошивку...");
        setPipelineStep("backup", "done");
      } catch {
        const fallbackBackup = backupConfigRef.current;
        if (fallbackBackup && typeof fallbackBackup === "object") {
          backup = fallbackBackup;
          setFlashStatus("Поточний config недоступний. Використовуємо останній збережений backup.");
          setPipelineStep("backup", "done");
        } else {
          setFlashStatus("Backup config недоступний. Продовжуємо прошивку без backup.");
          setPipelineStep("backup", "error");
        }
      }
    }

    try {
      await disconnectPort();
    } catch {}

    setPipelineStep("flash", "active");
    await startEspInstall(installButtonRef.current);
    setPipelineStep("flash", "done");

    setFlashStatus("Прошивка завершена. Перепідключаємо плату...");
    setPipelineStep("reconnect", "active");
    await reconnectAfterFlash();
    await waitDeviceInfoAfterReconnect(6);
    setPipelineStep("reconnect", "done");

    if (restoreSettings && backup) {
      const wifi = extractWifi(backup);
      if (wifi.ssid) {
        setPipelineStep("restoreWifi", "active");
        setFlashStatus("Відновлюємо Wi‑Fi (set:wifi)...");
        await sendAndWait(
          `set:wifi ${JSON.stringify({ ssid: wifi.ssid, password: wifi.password })}`,
          (j) => j?.status === "ACK" && (j?.cmd === "set:wifi" || j?.cmd === "wifi_set"),
          10000,
        );
        setPipelineStep("restoreWifi", "done");
      }

      setPipelineStep("restoreConfig", "active");
      await restoreBackupConfigWithRetry(backup, 3);
      setPipelineStep("restoreConfig", "done");

      setFlashStatus("Backup відновлено на платі");
      setPipelineStep("verify", "active");
      const verifiedObj = await sendAndWait("get:config", (j) => j?.event === "config" && j?.config, 12000);
      const diffs = collectDiffPaths(backup, verifiedObj?.config ?? {});
      if (diffs.length === 0) {
        setPipelineStep("verify", "done");
        setFlashStatus("Верифікація успішна: backup повністю відновлено");
      } else {
        setPipelineStep("verify", "error");
        const preview = diffs.slice(0, 5).join(", ");
        setFlashStatus(`Верифікація: ${diffs.length} відмінностей (${preview}${diffs.length > 5 ? ", ..." : ""})`);
      }
    }

    await cmdGetInfo();
    if (!restoreSettings || !backup) {
      await cmdGetConfig();
    }
    setFlashStatus(
      restoreSettings
        ? "Готово: прошивка + FS + відновлення налаштувань завершені"
        : "Готово: прошивка + FS для нового пристрою завершені",
    );
    setFlashBusy(false);
    setIsFlashingFlow(false);
  }

  async function runRecoveryWizard() {
    setFlashBusy(true);
    try {
      setStatus("Recovery Wizard: підключення до плати...");
      await withBoardWait("Recovery Wizard: очікуємо плату (до 1 хв)...", async () => {
        await ensureConnected(true);
        await sendAndWait("get:info", (j) => j?.event === "device_info", 6000);
      });

      if (!backupConfigRef.current) {
        const cfgObj = await sendAndWait("get:config", (j) => j?.event === "config" && j?.config, 12000);
        const cfg = cfgObj?.config;
        if (cfg && !configLooksEmpty(cfg)) {
          persistBackupConfig(cfg);
          applyConfigToUi(cfg);
        }
      }

      if (!backupConfigRef.current) {
        setStatus("Recovery Wizard: backup відсутній, збережи конфіг вручну");
        return;
      }

      setStatus("Recovery Wizard: safe restore Wi‑Fi + MQTT...");
      await cmdSafeRestoreNetworkFromBackup();
      setStatus("Recovery Wizard: повне відновлення backup JSON...");
      await restoreBackupConfigWithRetry(backupConfigRef.current, 3);
      setStatus("Recovery Wizard: завершено");
    } finally {
      setFlashBusy(false);
    }
  }

  async function onFlashClick(restoreSettings: boolean) {
    try {
      if (restoreSettings && newDeviceMode) {
        setFlashStatus("Режим нової плати активний: запускаємо прошивку як нового пристрою (без відновлення backup).");
        await runFlashFlow(false);
        return;
      }
      await runFlashFlow(restoreSettings);
    } catch (error) {
      setFlashBusy(false);
      setIsFlashingFlow(false);
      const message = error instanceof Error ? error.message : String(error);
      setFlashStatus(`Помилка прошивки: ${message}`);
    }
  }

  return (
    <main className="simple-shell">
      <header className="topbar card">
        <div className="brand">
          <img src="/icon.svg" alt="AlarmMini" className="brand-logo" />
          <div>
            <h1>AlarmMini Installer</h1>
            <p>Підключення, читання/запис налаштувань, безпечна прошивка з автоматичним відновленням</p>
          </div>
        </div>
        <div className="support-box">
          {supportQrSrc ? <img src={supportQrSrc} alt="QR підтримки" className="qr-image" /> : null}
          <a className="btn" href={GITHUB_REPO_URL} target="_blank" rel="noreferrer">
            GitHub репозиторій
          </a>
          <a className="btn" href={TELEGRAM_GROUP_URL} target="_blank" rel="noreferrer">
            Telegram спільнота
          </a>
        </div>
      </header>

      <section className="card">
        <h2>1. Підключення плати</h2>
        <div className="row gap">
          <button
            className="btn primary"
            disabled={!serialSupported || portState === "connecting" || flashBusy}
            onClick={() => void onConnectClick()}
          >
            {portState === "connected" ? "Порт підключено" : portState === "connecting" ? "Підключення..." : "Підключити плату"}
          </button>
          <button className="btn" disabled={portState !== "connected" || flashBusy} onClick={() => void disconnectPort()}>
            Відключити
          </button>
          <button className="btn" disabled={portState !== "connected" || flashBusy} onClick={() => void cmdGetConfig()}>
            Зчитати конфігурацію
          </button>
          <div className="status-pill">{serialSupported ? "Сумісний браузер" : "Потрібен Chrome/Edge"}</div>
          <div className="status-pill">{newDeviceMode ? "Режим: нова плата" : "Режим: стандартний"}</div>
          <div className="status-pill">Стан: {status}</div>
        </div>
        {waitActive ? (
          <div className="wait-mini">
            <div className="wait-mini-head">
              <span>{waitLabel || "Очікуємо плату..."}</span>
              <strong>{waitProgress}%</strong>
            </div>
            <div className="wait-mini-bar">
              <div className="wait-mini-fill" style={{ width: `${waitProgress}%` }} />
            </div>
          </div>
        ) : null}
      </section>

      <section className="grid two">
        <div className="card">
          <h2>2. Службова інформація</h2>
          <div className="row gap">
            <button className="btn" disabled={flashBusy} onClick={() => void cmdGetInfo()}>
              Оновити інформацію
            </button>
          </div>
          <div className="kv-grid">
            <div><span>FW</span><strong>{info.fw}</strong></div>
            <div><span>IP</span><strong>{info.ip}</strong></div>
            <div><span>mDNS</span><strong>{info.mdns}</strong></div>
            <div><span>Hostname</span><strong>{info.hostname}</strong></div>
            <div><span>Admin пароль</span><strong>{info.adminPassword}</strong></div>
            <div><span>Reset reason</span><strong>{info.resetReason}</strong></div>
            <div><span>Last stage</span><strong>{info.lastStage}</strong></div>
            <div><span>Boot count</span><strong>{info.bootCount}</strong></div>
          </div>
        </div>

        <div className="card">
          <h2>3. Мережа</h2>
          <div className="tabs" role="tablist" aria-label="Мережеві налаштування">
            <button
              role="tab"
              aria-selected={networkTab === "wifi"}
              className={`tab-btn ${networkTab === "wifi" ? "active" : ""}`}
              onClick={() => setNetworkTab("wifi")}
            >
              Wi‑Fi
            </button>
            <button
              role="tab"
              aria-selected={networkTab === "mqtt"}
              className={`tab-btn ${networkTab === "mqtt" ? "active" : ""}`}
              onClick={() => setNetworkTab("mqtt")}
            >
              MQTT
            </button>
          </div>

          {networkTab === "wifi" ? (
            <div className="tab-panel">
              <label>
                SSID
                <input value={wifiSsid} onChange={(e) => setWifiSsid(e.target.value)} />
              </label>
              <label>
                Password
                <input value={wifiPassword} onChange={(e) => setWifiPassword(e.target.value)} />
              </label>
              <div className="row gap">
                <button className="btn" disabled={flashBusy} onClick={() => void cmdSetWifi()}>
                  Зберегти Wi‑Fi
                </button>
              </div>
            </div>
          ) : (
            <div className="tab-panel">
              <label>
                Host
                <input value={mqttHost} onChange={(e) => setMqttHost(e.target.value)} placeholder="broker.example.com" />
              </label>
              <label>
                Port
                <input value={mqttPort} onChange={(e) => setMqttPort(e.target.value)} placeholder="1883" />
              </label>
              <label>
                Topic
                <input value={mqttTopic} onChange={(e) => setMqttTopic(e.target.value)} placeholder="alarmmini/device" />
              </label>
              <label>
                Username
                <input value={mqttUser} onChange={(e) => setMqttUser(e.target.value)} />
              </label>
              <label>
                Password
                <input value={mqttPassword} onChange={(e) => setMqttPassword(e.target.value)} />
              </label>
              <div className="row gap">
                <button className="btn" disabled={flashBusy} onClick={() => void cmdSetMqtt()}>
                  Зберегти MQTT
                </button>
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="card">
        <h2>4. Config JSON</h2>
        <div className="row gap">
          <button className="btn" disabled={flashBusy} onClick={() => void cmdSetConfig()}>
            Зберегти конфігурацію
          </button>
          <button className="btn" disabled={!backupAvailable || flashBusy} onClick={() => void downloadBackupConfigFile()}>
            Завантажити backup JSON
          </button>
          <button className="btn" disabled={!backupAvailable || flashBusy} onClick={() => void cmdSafeRestoreNetworkFromBackup().catch((e) => {
            const message = e instanceof Error ? e.message : String(e);
            setStatus(`Safe restore помилка: ${message}`);
          })}>
            Safe restore Wi‑Fi+MQTT
          </button>
          <button
            className="btn"
            disabled={flashBusy || !backupAvailable}
            onClick={() => void cmdRestoreBackupJsonManual().catch((error) => {
              const message = error instanceof Error ? error.message : String(error);
              setStatus(`Помилка backup restore: ${message}`);
            })}
          >
            Відновити backup JSON
          </button>
          <button
            className="btn"
            disabled={flashBusy}
            onClick={() => {
              try {
                setConfigText(JSON.stringify(safeParseJsonObject(configText), null, 2));
              } catch {}
            }}
          >
            Форматувати JSON
          </button>
          {dangerousWriteArmed ? (
            <button className="btn" disabled={flashBusy} onClick={() => setDangerousWriteArmed(false)}>
              Скасувати небезпечний запис
            </button>
          ) : null}
          <div className="status-pill">{backupAvailable ? "Backup: знайдено" : "Backup: відсутній"}</div>
          {dangerousWriteArmed ? <div className="status-pill">Підтвердження порожнього JSON: увімкнено</div> : null}
        </div>
        {configValidationErrors.length > 0 ? (
          <div className="validation-box">
            {configValidationErrors.map((err, idx) => (
              <div key={`${idx}-${err}`}>• {err}</div>
            ))}
          </div>
        ) : null}
        <div className="json-editor">
          <CodeMirror
            value={configText}
            onChange={(value) => setConfigText(value)}
            extensions={jsonExtensions}
            theme={oneDark}
            basicSetup={{
              lineNumbers: true,
              foldGutter: true,
              bracketMatching: true,
              autocompletion: true,
              highlightActiveLine: true,
            }}
          />
        </div>
      </section>

      <section className="card">
        <h2>5. Прошивка</h2>
        <div className="row gap">
          <div className="toggle-wrap" role="group" aria-label="Board">
            <button className={`toggle ${targetBoard === "esp8266" ? "active" : ""}`} onClick={() => setTargetBoard("esp8266")}>ESP8266</button>
            <button className={`toggle ${targetBoard === "esp32c3" ? "active" : ""}`} onClick={() => setTargetBoard("esp32c3")}>ESP32-C3</button>
          </div>
          <select
            className="select"
            value={selectedReleaseId ?? ""}
            onChange={(e) => setSelectedReleaseId(Number(e.target.value))}
            disabled={releasesLoading || !releases.length}
          >
            {releases.map((r) => (
              <option key={r.id} value={r.id}>{r.name || r.tag_name}</option>
            ))}
          </select>
          <button className="btn primary" disabled={!canFlash || flashBusy} onClick={() => void onFlashClick(true)}>
            {flashBusy ? "Йде прошивка..." : "Прошити з відновленням налаштувань"}
          </button>
          <button className="btn" disabled={!canFlash || flashBusy} onClick={() => void onFlashClick(false)}>
            {flashBusy ? "Йде прошивка..." : "Прошити як новий пристрій"}
          </button>
          <button className="btn" disabled={flashBusy} onClick={() => void runRecoveryWizard().catch((e) => {
            const message = e instanceof Error ? e.message : String(e);
            setFlashStatus(`Recovery Wizard помилка: ${message}`);
          })}>
            Recovery Wizard
          </button>
          {createElement("esp-web-install-button" as any, {
            manifest: manifestUrl,
            class: "hidden-install",
            ref: installButtonRef,
          })}
        </div>
        <div className="pipeline-grid">
          {PIPELINE_STEPS.map((step) => (
            <div key={step.id} className={`pipeline-step ${pipelineState[step.id]}`}>
              <span>{step.label}</span>
            </div>
          ))}
        </div>
        {selectedReleaseUpdatedAt ? (
          <p className="hint">Оновлено: {selectedReleaseUpdatedAt}</p>
        ) : null}

        <p className="hint">
          {releasesError
            ? `Помилка релізів: ${releasesError}`
            : releasesLoading
              ? "Завантаження релізів..."
              : canFlash
                ? "Файли для обраної плати знайдено."
                : "Для обраної плати бракує файлів у релізі."}
        </p>

        <div className="asset-block">
          <h3>Файли прошивки для {targetBoard.toUpperCase()}</h3>
          {boardAssetList.length === 0 ? (
            <p>Немає файлів для цієї плати в обраному релізі.</p>
          ) : (
            <ul>
              {boardAssetList.map((a) => (
                <li key={a.id}>
                  <span>{a.name}</span>
                  <span>{formatBytes(a.size)}</span>
                  <a href={a.browser_download_url} target="_blank" rel="noreferrer">Відкрити</a>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flash-status">{flashStatus || "Очікування"}</div>
        {newDeviceMode ? (
          <p className="hint">Плата не відповіла під час підключення. Підготовлено стандартний конфіг без Wi‑Fi/MQTT, прошивка піде як для нового пристрою.</p>
        ) : null}
      </section>

      <section className="card">
        <h2>Serial лог</h2>
        <div className="log-box">
          {serialLines.length === 0 ? <div className="log-empty">Поки порожньо</div> : serialLines.map((line, i) => <div key={`${i}-${line}`}>{line}</div>)}
        </div>
      </section>
    </main>
  );
}
