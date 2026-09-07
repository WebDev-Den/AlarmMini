"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { Manifest } from "esp-web-tools/dist/const";
import { writeFirmware } from "./installer";
import { BoardIllustration } from "./board-illustration";
import { normalizeFallbackUrl, normalizeFallbackToken, supportsFallback, supportsFallbackToken, verifyFallbackEndpoint } from "./fallback-settings";
import { FallbackUrlField } from "./fallback-url-field";
import QRCode from "qrcode";
const CodeMirror = dynamic(() => import("@uiw/react-codemirror"), { ssr: false });
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
  prerelease?: boolean;
  draft?: boolean;
};

type DeviceInfo = {
  fw: string;
  ip: string;
  mdns: string;
  hostname: string;
  mqttClientId: string;
  adminPassword: string;
  apSsid: string;
  apPassword: string;
  resetReason: string;
  lastStage: string;
  bootCount: string;
};

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
type BoardTargetId = "esp32c3" | "esp8266";
type BoardTarget = {
  id: BoardTargetId;
  label: string;
  assetTokens: string[];
  chipFamily: "ESP32-C3" | "ESP8266";
  fsOffset: number;
  requiresEsp32BootAssets: boolean;
};
type PipelineState = "pending" | "active" | "done" | "error" | "skipped";
type PipelineStepId = "backup" | "flash" | "reconnect" | "restoreWifi" | "restoreConfig" | "verify";

const BACKUP_STORAGE_KEY = "alarmmini.backup.config";
const PIPELINE_STEPS: Array<{ id: PipelineStepId; label: string }> = [
  { id: "backup", label: "Копія налаштувань" },
  { id: "flash", label: "Прошивка" },
  { id: "reconnect", label: "Перепідключення" },
  { id: "restoreWifi", label: "Відновлення Wi‑Fi" },
  { id: "restoreConfig", label: "Усі налаштування" },
  { id: "verify", label: "Перевірка" },
];

const owner = process.env.NEXT_PUBLIC_GITHUB_OWNER || "WebDev-Den";
const repo = process.env.NEXT_PUBLIC_GITHUB_REPO || "AlarmMini";
const SUPPORT_AUTHOR_URL =
  process.env.NEXT_PUBLIC_SUPPORT_URL ||
  process.env.NEXT_PUBLIC_ALARMMINI_SUPPORT_URL ||
  "https://send.monobank.ua/jar/2PMhPjRk9j";
const TELEGRAM_GROUP_URL =
  process.env.NEXT_PUBLIC_TELEGRAM_URL ||
  process.env.NEXT_PUBLIC_ALARMMINI_TELEGRAM_URL ||
  "https://t.me/+j3zFZHE5gGoyNGYy";
const GITHUB_REPO_URL = `https://github.com/${owner}/${repo}`;
const SITE_VERSION = "2.0.12";
const BOARD_TARGETS: BoardTarget[] = [
  {
    id: "esp32c3",
    label: "ESP32-C3 SuperMini",
    assetTokens: ["esp32c3", "esp32-c3", "c3"],
    chipFamily: "ESP32-C3",
    fsOffset: 2686976,
    requiresEsp32BootAssets: true,
  },
  {
    id: "esp8266",
    label: "ESP8266 / Wemos D1 mini",
    assetTokens: ["esp8266", "d1-mini", "d1mini"],
    chipFamily: "ESP8266",
    fsOffset: 2097152,
    requiresEsp32BootAssets: false,
  },
];

const EMPTY_INFO: DeviceInfo = {
  fw: "-",
  ip: "-",
  mdns: "-",
  hostname: "-",
  mqttClientId: "-",
  adminPassword: "-",
  apSsid: "AlarmMap-Setup",
  apPassword: "",
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
  return {
    firmware: findAsset(assets, board.assetTokens, ["firmware"]),
    littlefs: findAsset(assets, board.assetTokens, ["littlefs", "spiffs"]),
    bootloader: findAsset(assets, board.assetTokens, ["bootloader"]),
    partitions: findAsset(assets, board.assetTokens, ["partitions"]),
    bootApp0: findAsset(assets, board.assetTokens, ["boot-app0", "boot_app0", "bootapp0"]),
  };
}

function formatBytes(size: number) {
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(2)} MB`;
  if (size >= 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${size} B`;
}

function isKnownValue(value: string) {
  return Boolean(value && value !== "-" && value !== "unset");
}

function normalizeHttpUrl(value: string) {
  const trimmed = String(value || "").trim();
  if (!trimmed || trimmed === "-") return "";
  return /^https?:\/\//i.test(trimmed) ? trimmed.replace(/\/$/, "") : `http://${trimmed.replace(/\/$/, "")}`;
}

function buildDeviceBaseUrl(info: DeviceInfo) {
  if (/^192\.168\.4\./.test(info.ip)) return "http://192.168.4.1";
  if (isKnownValue(info.hostname)) return `http://${info.hostname}.local`;
  if (isKnownValue(info.mdns)) return normalizeHttpUrl(info.mdns);
  if (isKnownValue(info.ip)) return `http://${info.ip}`;
  return "";
}

function buildAdminUrl(info: DeviceInfo) {
  const baseUrl = buildDeviceBaseUrl(info);
  if (!baseUrl) return "";
  if (/^192\.168\.4\./.test(info.ip)) return `${baseUrl}/`;
  const password = isKnownValue(info.adminPassword) ? info.adminPassword : "";
  return `${baseUrl}/index.html${password ? `?p=${encodeURIComponent(password)}` : ""}`;
}

function buildApWifiQrText(info: DeviceInfo) {
  const ssid = isKnownValue(info.apSsid) ? info.apSsid : "AlarmMap-Setup";
  const pass = info.apPassword || "";
  return pass ? `WIFI:T:WPA;S:${ssid};P:${pass};;` : `WIFI:T:nopass;S:${ssid};;`;
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


function isSafeBackupConfig(cfg: any) {
  return Boolean(cfg && typeof cfg === "object" && !Array.isArray(cfg) && buildConfigValidationErrors(cfg).length === 0);
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
  return sanitizeLogLine(JSON.stringify(obj, (key, value) => ["token", "ft", "fallbackToken", "Authorization"].includes(key) ? "***" : value));
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
  const asNum = (v: unknown) => Number(v);
  const inRange = (v: unknown, min: number, max: number) => Number.isFinite(asNum(v)) && asNum(v) >= min && asNum(v) <= max;
  const isBool = (v: unknown) => typeof v === "boolean";
  const isObj = (v: unknown) => Boolean(v) && typeof v === "object" && !Array.isArray(v);
  const isStr = (v: unknown) => typeof v === "string";
  const isU8Color = (arr: unknown) =>
    Array.isArray(arr) &&
    arr.length === 4 &&
    arr.every((x) => inRange(x, 0, 255));

  if (!Array.isArray(cfg.l) || cfg.l.length !== 27 || !cfg.l.every((x: unknown) => Number.isInteger(asNum(x)) && asNum(x) >= -1 && asNum(x) <= 24)) {
    errors.push("l має бути масивом з 27 значень у діапазоні -1..24");
  }

  if (!isObj(cfg.c) || !isObj(cfg.c.d) || !isObj(cfg.c.n)) {
    errors.push("c/d/n (кольори) мають бути об'єктами");
  } else {
    if (!isU8Color(cfg.c.d.a)) errors.push("c.d.a має бути [r,g,b,a], 0..255");
    if (!isU8Color(cfg.c.d.c)) errors.push("c.d.c має бути [r,g,b,a], 0..255");
    if (!isU8Color(cfg.c.n.a)) errors.push("c.n.a має бути [r,g,b,a], 0..255");
    if (!isU8Color(cfg.c.n.c)) errors.push("c.n.c має бути [r,g,b,a], 0..255");
  }

  if (!isObj(cfg.n)) {
    errors.push("n (нічний режим) має бути об'єктом");
  } else {
    if (!isBool(cfg.n.e)) errors.push("n.e має бути boolean");
    if (!Array.isArray(cfg.n.s) || cfg.n.s.length !== 2 || !inRange(cfg.n.s[0], 0, 23) || !inRange(cfg.n.s[1], 0, 59)) {
      errors.push("n.s має бути [hour,minute]");
    }
    if (!Array.isArray(cfg.n.x) || cfg.n.x.length !== 2 || !inRange(cfg.n.x[0], 0, 23) || !inRange(cfg.n.x[1], 0, 59)) {
      errors.push("n.x має бути [hour,minute]");
    }
    if (!inRange(cfg.n.b, 0, 150)) errors.push("n.b має бути 0..150");
    if (!Array.isArray(cfg.n.p) || cfg.n.p.length !== 2 || !cfg.n.p.every((x: unknown) => isBool(x))) {
      errors.push("n.p має бути [bool,bool]");
    }
  }

  if (!isObj(cfg.z) || !isBool(cfg.z.e)) {
    errors.push("z (buzzer) має містити поле e:boolean");
  } else {
    if (!Array.isArray(cfg.z.v) || cfg.z.v.length !== 2 || !inRange(cfg.z.v[0], 0, 100) || !inRange(cfg.z.v[1], 0, 100)) {
      errors.push("z.v має бути [dayVol,nightVol] у діапазоні 0..100");
    }
    if (!Array.isArray(cfg.z.r) || !cfg.z.r.every((x: unknown) => Number.isInteger(asNum(x)) && asNum(x) >= 0 && asNum(x) <= 24)) {
      errors.push("z.r має бути масивом індексів регіонів 0..24");
    }
  }

  if (!isObj(cfg.k) || !isBool(cfg.k.e)) {
    errors.push("k (blink) має містити поле e:boolean");
  } else if (!Array.isArray(cfg.k.i) || cfg.k.i.length !== 2 || !inRange(cfg.k.i[0], 0, 100) || !inRange(cfg.k.i[1], 0, 100)) {
    errors.push("k.i має бути [day,night] у діапазоні 0..100");
  }

  if (!isObj(cfg.o)) {
    errors.push("o (offline) має бути об'єктом");
  } else {
    if (!inRange(cfg.o.a, 5, 600)) errors.push("o.a має бути 5..600 секунд");
    if (!inRange(cfg.o.p, 0, 100)) errors.push("o.p має бути 0..100");
    if (!inRange(cfg.o.d, 400, 10000)) errors.push("o.d має бути 400..10000 мс");
    if (!inRange(cfg.o.s, 20, 220)) errors.push("o.s має бути 20..220");
    if (!inRange(cfg.o.c, 0, 100)) errors.push("o.c має бути 0..100");
  }

  if (!isObj(cfg.w)) errors.push("w (Wi‑Fi) відсутнє");
  if (!isObj(cfg.m)) errors.push("m (MQTT) відсутнє");
  if (!Array.isArray(cfg.t) || cfg.t.length !== 3 || !cfg.t.every((x: unknown) => isStr(x))) {
    errors.push("t (NTP) має бути масивом із 3 рядків");
  }
  if (!Number.isFinite(asNum(cfg.g))) errors.push("g (log mask) має бути числом");

  if (isObj(cfg.w)) {
    if (!isStr(cfg.w.s)) errors.push("w.s (SSID) має бути рядком");
    if (!isStr(cfg.w.p)) errors.push("w.p (password) має бути рядком");
  }

  if (isObj(cfg.m)) {
    if (!isStr(cfg.m.h)) errors.push("m.h (host) має бути рядком");
    if (!isStr(cfg.m.t)) errors.push("m.t (topic) має бути рядком");
    if (!isStr(cfg.m.u)) errors.push("m.u (user) має бути рядком");
    if (!isStr(cfg.m.s)) errors.push("m.s (pass) має бути рядком");
    if (!inRange(cfg.m.p, 1, 65535)) errors.push("m.p (port) має бути 1..65535");
  }

  if (cfg.cv != null && !inRange(cfg.cv, 1, 255)) errors.push("cv має бути числом 1..255");
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
  const [status, setStatus] = useState("Плата ще не підключена");

  const [info, setInfo] = useState<DeviceInfo>(EMPTY_INFO);
  const [wifiSsid, setWifiSsid] = useState("");
  const [wifiPassword, setWifiPassword] = useState("");
  const [networkTab, setNetworkTab] = useState<NetworkTab>("wifi");
  const [mqttHost, setMqttHost] = useState("");
  const [fallbackUrl, setFallbackUrl] = useState("");
  const [fallbackToken, setFallbackToken] = useState("");
  const [installFallbackToken, setInstallFallbackToken] = useState("");
  const [fallbackSaving, setFallbackSaving] = useState(false);
  const [installFallbackUrl, setInstallFallbackUrl] = useState("");
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
  const [selectedBoardId, setSelectedBoardId] = useState<BoardTargetId>("esp32c3");
  const [flashBusy, setFlashBusy] = useState(false);
  const [flashStatus, setFlashStatus] = useState("");
  const [flashProgress, setFlashProgress] = useState<number | null>(null);
  const [flashOutcome, setFlashOutcome] = useState<"idle" | "success" | "error">("idle");
  const [freshInstallConfirmed, setFreshInstallConfirmed] = useState(false);
  const [releasesAttempt, setReleasesAttempt] = useState(0);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const flashBusyRef = useRef(false);
  const modalRef = useRef<HTMLDivElement | null>(null);
  const [adminQrSrc, setAdminQrSrc] = useState("");
  const [apQrSrc, setApQrSrc] = useState("");
  const [webCheckStatus, setWebCheckStatus] = useState("Очікує підключення плати");
  const [isFlashingFlow, setIsFlashingFlow] = useState(false);
  const [waitActive, setWaitActive] = useState(false);
  const [waitLabel, setWaitLabel] = useState("");
  const [dangerousWriteArmed, setDangerousWriteArmed] = useState(false);
  const [configValidationErrors, setConfigValidationErrors] = useState<string[]>([]);
  const [configModalOpen, setConfigModalOpen] = useState(false);
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
  const backupConfigRef = useRef<any | null>(null);
  const backupHostnameRef = useRef("");

  useEffect(() => {
    setSerialSupported(window.isSecureContext && "serial" in navigator);
  }, []);

  const deviceBaseUrl = useMemo(() => buildDeviceBaseUrl(info), [info]);
  const adminUrl = useMemo(() => buildAdminUrl(info), [info]);
  const healthUrl = useMemo(() => (deviceBaseUrl ? `${deviceBaseUrl}/health` : ""), [deviceBaseUrl]);
  const ipWebUrl = useMemo(() => (isKnownValue(info.ip) ? `http://${info.ip}` : ""), [info.ip]);
  const isApModeIp = useMemo(() => /^192\.168\.4\./.test(info.ip), [info.ip]);

  useEffect(() => {
    if (!adminUrl) {
      setAdminQrSrc("");
      setApQrSrc("");
      setWebCheckStatus("Очікує підключення плати");
      return;
    }

    QRCode.toDataURL(adminUrl, {
      width: 256,
      margin: 1,
      color: { dark: "#06101f", light: "#ffffff" },
    })
      .then(setAdminQrSrc)
      .catch(() => setAdminQrSrc(""));

    QRCode.toDataURL(buildApWifiQrText(info), {
      width: 256,
      margin: 1,
      color: { dark: "#06101f", light: "#ffffff" },
    })
      .then(setApQrSrc)
      .catch(() => setApQrSrc(""));

    setWebCheckStatus(isApModeIp ? "AP режим: QR веде на Wi‑Fi налаштування 192.168.4.1" : "QR готові, web перевірку ще не запускали");
  }, [adminUrl, info.apSsid, info.apPassword, isApModeIp]);

  useEffect(() => {
    if (!owner || !repo) {
      setReleasesError("Заповніть NEXT_PUBLIC_GITHUB_OWNER і NEXT_PUBLIC_GITHUB_REPO");
      setReleasesLoading(false);
      return;
    }

    const controller = new AbortController();
    setReleasesLoading(true);
    setReleasesError("");
    fetch("/api/releases", { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`GitHub API ${res.status}`);
        return res.json();
      })
      .then((data: GithubRelease[]) => {
        const stable = data.filter((release) => !release.draft && !release.prerelease);
        setReleases(stable);
        setSelectedReleaseId(stable[0]?.id ?? null);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setReleasesError("Не вдалося завантажити версії. Перевір інтернет і спробуй ще раз.");
      })
      .finally(() => { if (!controller.signal.aborted) setReleasesLoading(false); });
    return () => controller.abort();
  }, [releasesAttempt]);

  useEffect(() => {
    return () => {
      void disconnectPort();
    };
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return;
    if (!configModalOpen) return;

    const previousFocus = document.activeElement as HTMLElement | null;
    modalRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setConfigModalOpen(false);
      if (event.key === "Tab") {
        const items = modalRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea, select, a[href], [tabindex="0"], [contenteditable="true"]');
        if (!items?.length) { event.preventDefault(); return; }
        const first = items[0], last = items[items.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === modalRef.current)) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [configModalOpen]);

  useEffect(() => {
    if (!flashBusy) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [flashBusy]);

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

  const selectedBoard = useMemo(
    () => BOARD_TARGETS.find((board) => board.id === selectedBoardId) ?? BOARD_TARGETS[0],
    [selectedBoardId],
  );
  const boardAssets = useMemo(() => resolveBoardAssets(selectedRelease, selectedBoard), [selectedRelease, selectedBoard]);
  const jsonExtensions = useMemo(() => [jsonLang()], []);

  const boardAssetList = useMemo(() => {
    const list: ReleaseAsset[] = [];
    if (boardAssets.firmware) list.push(boardAssets.firmware);
    if (boardAssets.littlefs) list.push(boardAssets.littlefs);
    if (boardAssets.bootloader) list.push(boardAssets.bootloader);
    if (boardAssets.partitions) list.push(boardAssets.partitions);
    if (boardAssets.bootApp0) list.push(boardAssets.bootApp0);
    return list;
  }, [boardAssets]);

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
    if (!selectedBoard.requiresEsp32BootAssets) return true;
    return Boolean(boardAssets.bootloader && boardAssets.partitions && boardAssets.bootApp0);
  }, [selectedRelease, selectedBoard, boardAssets]);

  const manifest = useMemo<Manifest | null>(() => {
    if (!canFlash || !selectedRelease || !boardAssets.firmware || !boardAssets.littlefs) return null;

    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const firmwarePath = `${origin}/api/release-asset?source=${encodeURIComponent(boardAssets.firmware.browser_download_url)}`;
    const littlefsPath = `${origin}/api/release-asset?source=${encodeURIComponent(boardAssets.littlefs.browser_download_url)}`;

    const parts = selectedBoard.requiresEsp32BootAssets
      ? [
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
          { path: littlefsPath, offset: selectedBoard.fsOffset },
        ]
      : [
          { path: firmwarePath, offset: 0 },
          { path: littlefsPath, offset: selectedBoard.fsOffset },
        ];

    const manifest: Manifest = {
      name: "AlarmMini",
      version: selectedRelease.tag_name || selectedRelease.name || "unversioned",
      new_install_prompt_erase: false,
      builds: [
        {
          chipFamily: selectedBoard.chipFamily,
          parts,
        },
      ],
    };

    return manifest;
  }, [canFlash, selectedRelease, selectedBoard, boardAssets]);

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
    setWaitActive(true);

    try {
      while (Date.now() - startedAt < timeoutMs) {
        try {
          const result = await action();
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
    setFallbackUrl(String(cfg.fu ?? ""));
    setFallbackToken(String(cfg.ft ?? ""));
  }

  function persistBackupConfig(cfg: any) {
    if (!isSafeBackupConfig(cfg)) {
      appendLog("[backup] Конфігурація неповна або не пройшла перевірку");
      return;
    }
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
    setInfo((previous) => ({
      fw: String(payload?.fw ?? previous.fw ?? "-"),
      ip: String(payload?.ip ?? previous.ip ?? "-"),
      mdns: String(payload?.mdns ?? previous.mdns ?? "-"),
      hostname: String(payload?.hostname ?? previous.hostname ?? "-"),
      mqttClientId: String(payload?.mqttClientId ?? previous.mqttClientId ?? "-"),
      adminPassword: String(payload?.adminPassword ?? previous.adminPassword ?? "-"),
      apSsid: String(payload?.apSsid ?? previous.apSsid ?? "AlarmMap-Setup"),
      apPassword: String(payload?.apPassword ?? previous.apPassword ?? ""),
      resetReason: String(payload?.resetReason ?? previous.resetReason ?? "-"),
      lastStage: String(payload?.lastStage ?? previous.lastStage ?? "-"),
      bootCount: String(payload?.bootCount ?? previous.bootCount ?? "-"),
    }));
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
        if (buffer.length > 32768) {
          buffer = "";
          appendLog("Надто довгий рядок від плати пропущено.");
          continue;
        }
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
        if (readerRef.current === reader) {
          readerRef.current = null;
          setPortState("idle");
          clearPending("USB відключено. Перепідключи плату.");
        }
        await readableClosed;
      });
  }

  function isPortOpen(port: any) {
    return Boolean(port?.readable || port?.writable);
  }

  async function ensureConnected(requestUser: boolean) {
    if (!serialSupported) throw new Error("Web Serial не підтримується");
    if (isPortOpen(portRef.current) && readerRef.current) return;

    setPortState("connecting");
    let port = rememberedPortRef.current;

    if (!port) {
      const serialApi = (navigator as Navigator & { serial: any }).serial;
      if (requestUser) {
        port = await serialApi.requestPort();
      } else {
        throw new Error("Вибери свою плату кнопкою «Підключити через USB».");
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

  async function disconnectPort(forget = false) {
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
    setStatus("USB відключено. Підключи плату, щоб продовжити.");
    if (forget) {
      rememberedPortRef.current = null;
      setInfo(EMPTY_INFO);
      setDownloadedConfig(null);
    }
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

  function bytesToHex(bytes: Uint8Array) {
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0").toUpperCase()).join("");
  }

  async function sendConfigChunked(configObj: any, label = "config") {
    if ((label === "manual_config" || (label === "mqtt" && (configObj.fu !== downloadedConfig?.fu || configObj.ft !== downloadedConfig?.ft))) && configObj.fu) {
      const token = normalizeFallbackToken(String(configObj.ft ?? ""));
      if (token) {
        const device = await sendAndWait("get:info", (j) => j?.event === "device_info", 6000);
        if (!supportsFallbackToken(String(device.fw))) throw new Error("Для токена резервного API потрібна прошивка 2.0.9 або новіша.");
      }
      configObj = { ...configObj, fu: await verifyFallbackEndpoint(String(configObj.fu), token), ...(token ? { ft: token } : {}) };
    }
    const payload = new TextEncoder().encode(JSON.stringify(configObj));
    const chunkSize = 64;
    appendLog(`[${label}] chunked upload ${payload.length} bytes`);
    await sendAndWait("cmd=set_begin", (j) => j?.status === "ACK" && j?.cmd === "set_begin", 7000);

    for (let offset = 0; offset < payload.length; offset += chunkSize) {
      const chunk = payload.slice(offset, offset + chunkSize);
      await sendAndWait(
        `data=${bytesToHex(chunk)}`,
        (j) => j?.status === "ACK" && j?.cmd === "set_data",
        7000,
      );
    }

    await sendAndWait("cmd=set_end", (j) => j?.status === "ACK" && j?.cmd === "set_end", 22000);
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

    // A write failure must not leave a pending timeout/unhandled rejection.
    responsePromise.catch(() => {});
    try {
      await writeSerialLine(line);
      return await responsePromise;
    } catch (error) {
      clearPending("command_failed");
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

  async function refreshInfoAndLabels() {
    await cmdGetInfo();
    setStatus("QR наклейки оновлено з плати");
  }

  async function checkWebInterface() {
    await ensureConnected(true);
    const obj = await sendAndWait("get:info", (j) => j?.event === "device_info", 6000);
    updateInfoFromPayload(obj);

    const nextInfo: DeviceInfo = {
      fw: String(obj?.fw ?? info.fw ?? "-"),
      ip: String(obj?.ip ?? info.ip ?? "-"),
      mdns: String(obj?.mdns ?? info.mdns ?? "-"),
      hostname: String(obj?.hostname ?? info.hostname ?? "-"),
      mqttClientId: String(obj?.mqttClientId ?? info.mqttClientId ?? "-"),
      adminPassword: String(obj?.adminPassword ?? info.adminPassword ?? "-"),
      apSsid: String(obj?.apSsid ?? info.apSsid ?? "AlarmMap-Setup"),
      apPassword: String(obj?.apPassword ?? info.apPassword ?? ""),
      resetReason: String(obj?.resetReason ?? info.resetReason ?? "-"),
      lastStage: String(obj?.lastStage ?? info.lastStage ?? "-"),
      bootCount: String(obj?.bootCount ?? info.bootCount ?? "-"),
    };

    if (!isKnownValue(nextInfo.ip)) {
      setWebCheckStatus("IP ще не отримано. Перевір Wi‑Fi або режим AP.");
      return;
    }

    if (/^192\.168\.4\./.test(nextInfo.ip)) {
      setWebCheckStatus("Плата в AP режимі. Для LAN-перевірки підключи її до Wi‑Fi мережі.");
      return;
    }

    const base = buildDeviceBaseUrl(nextInfo);
    if (!base) {
      setWebCheckStatus("Немає URL для перевірки web-інтерфейсу.");
      return;
    }

    setWebCheckStatus("Перевіряємо /health у локальній мережі...");
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 4500);
    try {
      const response = await fetch(`${base}/health?ts=${Date.now()}`, {
        method: "GET",
        cache: "no-store",
        mode: "cors",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const health = await response.json().catch(() => null);
      const heap = health?.heapFree ? ` heap=${health.heapFree}` : "";
      setWebCheckStatus(`Web UI доступний: ${base}${heap}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setWebCheckStatus(
        `COM OK, IP не AP. Браузер не прочитав /health (${message}). Відкрий web UI кнопкою поруч.`,
      );
    } finally {
      window.clearTimeout(timer);
    }
  }

  function printQrLabels() {
    if (typeof window !== "undefined") window.print();
  }

  function downloadQrPng(dataUrl: string, filename: string) {
    if (!dataUrl) return;
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = filename;
    a.click();
  }

  async function cmdGetConfig() {
    await ensureConnected(true);
    setStatus("Зчитуємо get:config...");
    const obj = await sendAndWait("get:config", (j) => j?.event === "config" && j?.config, 9000);
    const cfg = obj.config;
    applyConfigToUi(cfg);
    setNewDeviceMode(false);
    if (!isFlashingFlow && isSafeBackupConfig(cfg)) {
      persistBackupConfig(cfg);
    }
    setStatus("Конфіг зчитано");
    return cfg;
  }

  async function snapshotCurrentConfigBeforeWrite() {
    const snapshotObj = await sendAndWait("get:config", (j) => j?.event === "config" && j?.config, 10000);
    const snapshot = snapshotObj?.config;
    if (snapshot && typeof snapshot === "object") {
      if (isSafeBackupConfig(snapshot)) {
        persistBackupConfig(snapshot);
        appendLog("[backup] Поточний config збережено перед записом");
      } else {
        appendLog("[backup] Поточний config не містить Wi‑Fi/MQTT, старий backup залишено");
      }
    }
  }

  async function cmdSetWifi() {
    await ensureConnected(true);
    if (!wifiSsid) throw new Error("Введи назву Wi-Fi мережі.");
    if (new TextEncoder().encode(wifiSsid).length > 32 || new TextEncoder().encode(wifiPassword).length > 63) {
      throw new Error("Назва Wi-Fi має вміщуватися у 32 байти, пароль — у 63 байти.");
    }
    setStatus("Записуємо set:wifi...");
    await sendAndWait(
      `set:wifi ${JSON.stringify({ ssid: wifiSsid, password: wifiPassword })}`,
      (j) => j?.status === "ACK" && (j?.cmd === "set:wifi" || j?.cmd === "wifi_set"),
      9000,
    );
    setStatus("Дані Wi-Fi збережено. Пристрій підключається до мережі…");
    setNewDeviceMode(false);
    await cmdGetInfo();
  }

  async function saveFallbackUrl(value: string, tokenValue = "") {
    const token = value.trim() ? normalizeFallbackToken(tokenValue) : "";
    const url = await verifyFallbackEndpoint(value, token);
    await sendAndWait(JSON.stringify({ cmd: "fallback_set", url, token }), (j) => j?.status === "ACK" && j?.cmd === "fallback_set", 10000);
    const verified = await sendAndWait("get:config", (j) => j?.event === "config" && j?.config, 10000);
    if (String(verified.config.fu ?? "") !== url) throw new Error("Не вдалося підтвердити збереження резервного URL.");
    if (String(verified.config.ft ?? "") !== token) throw new Error("Не вдалося підтвердити збереження токена резервного API.");
    applyConfigToUi(verified.config);
  }

  async function cmdSetFallbackUrl() {
    if (fallbackSaving) return;
    const url = normalizeFallbackUrl(fallbackUrl);
    const token = url ? normalizeFallbackToken(fallbackToken) : "";
    setFallbackSaving(true);
    try {
      await ensureConnected(true);
      const device = await sendAndWait("get:info", (j) => j?.event === "device_info", 6000);
      if (!supportsFallback(String(device.fw))) throw new Error("Онови прошивку до 2.0.7 або новішої, щоб увімкнути резервний API.");
      if (token && !supportsFallbackToken(String(device.fw))) throw new Error("Для токена резервного API потрібна прошивка 2.0.9 або новіша.");
      await snapshotCurrentConfigBeforeWrite();
      setStatus(url ? "Перевіряємо резервний URL перед записом…" : "Вимикаємо резервний API…");
      await saveFallbackUrl(url, token);
      setStatus(url ? "Резервний URL збережено й перевірено." : "Резервний API вимкнено.");
    } catch (error) {
      setFallbackUrl(url);
      setFallbackToken(token);
      throw error;
    } finally { setFallbackSaving(false); }
  }

  async function cmdSetMqtt() {
    await ensureConnected(true);
    if (!mqttHost.trim()) throw new Error("MQTT host порожній");
    await snapshotCurrentConfigBeforeWrite();

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
    await sendConfigChunked(configObj, "mqtt");
    setStatus("MQTT налаштовано");
    setNewDeviceMode(false);
    await cmdGetConfig();
  }

  async function cmdSetConfig() {
    await ensureConnected(true);
    await snapshotCurrentConfigBeforeWrite();
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
    await sendConfigChunked(configObj, "manual_config");
    setDangerousWriteArmed(false);
    setStatus("Конфіг записано");
    setNewDeviceMode(false);
    await cmdGetConfig();
  }

  async function cmdValidateConfigCompatibility() {
    const configObj = safeParseJsonObject(configText);
    const validation = buildConfigValidationErrors(configObj);
    setConfigValidationErrors(validation);
    if (validation.length) {
      setStatus(`Знайдено ${validation.length} помилок сумісності конфігу`);
      throw new Error("Конфіг не пройшов перевірку сумісності");
    }
    setStatus("Конфіг сумісний з прошивкою");
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
        await sendConfigChunked(backup, "backup_restore");
        await waitDeviceInfoAfterReconnect(4);
        const restored = await sendAndWait("get:config", (j) => j?.event === "config" && j?.config, 12000);
        const diffs = collectDiffPaths(backup, restored?.config ?? {});
        if (diffs.length) {
          throw new Error(`Backup записано не повністю: ${diffs.length} відмінностей`);
        }
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
    await sendConfigChunked(merged, "safe_network_restore");
    await cmdGetConfig();
    setStatus("Safe restore завершено");
  }

  async function onConnectClick() {
    setFlashOutcome("idle");
    try {
      await ensureConnected(true);
      if (newDeviceMode) {
        setStatus("USB підключено. Можна встановлювати AlarmMini.");
        return;
      }
      setStatus("Читаємо налаштування. Це може тривати до 20 секунд…");
      await withBoardWait("Очікуємо відповідь плати…", async () => {
        const infoObj = await sendAndWaitInternal("get:info", (j) => j?.event === "device_info", 4000, false);
        updateInfoFromPayload(infoObj);
        const cfgObj = await sendAndWaitInternal("get:config", (j) => j?.event === "config" && j?.config, 6000, false);
        applyConfigToUi(cfgObj.config);
        if (isSafeBackupConfig(cfgObj.config)) persistBackupConfig(cfgObj.config);
      }, 20000);
      setStatus("Плату підключено, налаштування прочитано. Можна оновлювати.");
    } catch (error) {
      setPortState(isPortOpen(portRef.current) ? "connected" : "idle");
      const message = error instanceof Error ? error.message : String(error);
      setStatus(message.includes("No port selected") || (error as DOMException)?.name === "NotFoundError"
        ? "Порт не вибрано. Натисни «Підключити через USB» і вибери свою плату."
        : "Не вдалося прочитати плату. Закрий інші програми з COM-портом і повтори підключення. Для порожньої плати вибери «Перше встановлення».");
    }
  }

  async function reconnectAfterFlash() {
    await withBoardWait("Очікуємо перепідключення плати (до 1 хв)...", async () => {
      await ensureConnected(false);
      return true;
    });
  }

  async function runFlashFlow(restoreSettings: boolean) {
    const reserveUrl = normalizeFallbackUrl(installFallbackUrl);
    const reserveToken = normalizeFallbackToken(installFallbackToken);
    if (reserveToken && !reserveUrl) throw new Error("Вкажи резервний URL разом із токеном або очисти поле токена.");
    if (reserveToken && !supportsFallbackToken(selectedRelease?.tag_name ?? "")) throw new Error("Для токена резервного API вибери прошивку 2.0.9 або новішу.");
    if (reserveUrl && !supportsFallback(selectedRelease?.tag_name ?? "")) throw new Error("Для резервного API вибери прошивку 2.0.7 або новішу.");
    if (!serialSupported || !canFlash || !manifest) throw new Error("Спочатку вибери плату та доступну версію прошивки.");
    if (!restoreSettings && !freshInstallConfirmed) throw new Error("Підтвердь перше встановлення: поточні налаштування буде видалено.");
    if (!rememberedPortRef.current) throw new Error("Спочатку підключи плату через USB у кроці 2.");
    setFlashBusy(true);
    setIsFlashingFlow(true);
    setFlashOutcome("idle");
    setFlashProgress(null);
    resetPipeline(restoreSettings);
    if (reserveUrl) {
      setFlashStatus("Перевіряємо резервний URL перед прошиванням…");
      await verifyFallbackEndpoint(reserveUrl, reserveToken);
    }
    let backup: any = null;
    let expectedHostname = "";
    if (restoreSettings) {
      setPipelineStep("backup", "active");
      setFlashStatus("Зберігаємо налаштування саме підключеної плати…");
      try {
        await ensureConnected(false);
        const device = await sendAndWait("get:info", (j) => j?.event === "device_info", 6000);
        expectedHostname = String(device.hostname || "");
        const obj = await sendAndWait("get:config", (j) => j?.event === "config" && j?.config, 10000);
        backup = obj.config;
        if (!isSafeBackupConfig(backup)) throw new Error("Конфігурація неповна або несумісна.");
        persistBackupConfig(backup);
        backupHostnameRef.current = expectedHostname;
        applyConfigToUi(backup);
        setPipelineStep("backup", "done");
      } catch {
        setPipelineStep("backup", "error");
        throw new Error("Не вдалося зберегти поточні налаштування. Запис не розпочато. Перепідключи USB та спробуй ще раз; режим оновлення залишився увімкненим.");
      }
    }
    if (backup?.ft && !supportsFallbackToken(selectedRelease?.tag_name ?? "")) throw new Error("Копія налаштувань містить токен резервного API. Вибери прошивку 2.0.9 або новішу, щоб зберегти його.");
    const flashPort = rememberedPortRef.current;
    await disconnectPort();
    setPipelineStep("flash", "active");
    setFlashStatus("Визначаємо плату й готуємо запис. Не відключай USB…");
    try {
      await writeFirmware(flashPort, manifest, window.location.href, !restoreSettings, (event) => {
        if (event.state === "initializing") setFlashStatus("Підключаємося до завантажувача. За потреби затисни BOOT…");
        if (event.state === "preparing") setFlashStatus("Завантажуємо файли прошивки…");
        if (event.state === "erasing") setFlashStatus("Готуємо пам’ять для першого встановлення…");
        if (event.state === "writing") {
          setFlashProgress(event.details.percentage);
          setFlashStatus(`Записуємо прошивку: ${event.details.percentage}%. Не відключай USB.`);
        }
      });
    } catch (error) {
      setPipelineStep("flash", "error");
      throw error;
    }
    setPipelineStep("flash", "done");
    setFlashProgress(null);
    setPipelineStep("reconnect", "active");
    setFlashStatus("Запис завершено. Чекаємо перезапуску плати…");
    await reconnectAfterFlash();
    await waitDeviceInfoAfterReconnect(6);
    const rebooted = await sendAndWait("get:info", (j) => j?.event === "device_info", 6000);
    if (expectedHostname && rebooted.hostname !== expectedHostname) throw new Error("Підключено іншу плату. Налаштування не записано; підключи початковий пристрій.");
    setPipelineStep("reconnect", "done");
    if (restoreSettings && backup) {
      setPipelineStep("restoreWifi", "active");
      setPipelineStep("restoreConfig", "active");
      setFlashStatus("Повертаємо Wi-Fi та всі налаштування. Дочекайся перевірки…");
      // One full configuration transaction restores the network too.
      await restoreBackupConfigWithRetry(backup, 3);
      setPipelineStep("restoreWifi", "done");
      setPipelineStep("restoreConfig", "done");
      setPipelineStep("verify", "active");
      const verified = await sendAndWait("get:config", (j) => j?.event === "config" && j?.config, 12000);
      if (collectDiffPaths(backup, verified.config).length) throw new Error("Не всі налаштування відновилися. Резервну копію збережено; скористайся кнопкою відновлення нижче.");
      setPipelineStep("verify", "done");
    } else {
      setPipelineStep("verify", "active");
      await cmdGetConfig();
      setPipelineStep("verify", "done");
    }
    if (reserveUrl) {
      setPipelineStep("verify", "active");
      setFlashStatus("Зберігаємо резервний URL і перевіряємо його на платі…");
      await saveFallbackUrl(reserveUrl, reserveToken);
      setPipelineStep("verify", "done");
    }
    await cmdGetInfo();
    setFlashOutcome("success");
    setFlashStatus(restoreSettings ? "Оновлення завершено. Усі налаштування відновлено й перевірено." : "AlarmMini встановлено. Тепер підключи пристрій до Wi-Fi.");
  }

  async function runRecoveryWizard() {
    if (flashBusyRef.current) return;
    const backup = backupConfigRef.current;
    if (!backup || !backupHostnameRef.current) throw new Error("Автоматичне відновлення доступне для копії поточної спроби оновлення. Завантаж копію для ручного відновлення у додаткових налаштуваннях.");
    flashBusyRef.current = true;
    setFlashBusy(true);
    setIsFlashingFlow(true);
    try {
      await ensureConnected(true);
      const device = await sendAndWait("get:info", (j) => j?.event === "device_info", 6000);
      if (device.hostname !== backupHostnameRef.current) throw new Error("Підключено іншу плату. Відновлення зупинено; підключи початковий пристрій.");
      setFlashStatus("Відновлюємо налаштування з копії поточної спроби…");
      await restoreBackupConfigWithRetry(backup, 3);
      const verified = await sendAndWait("get:config", (j) => j?.event === "config" && j?.config, 12000);
      if (collectDiffPaths(backup, verified.config).length) throw new Error("Не всі налаштування відновлено. Резервну копію збережено.");
      setFlashStatus("Налаштування відновлено й перевірено. За потреби повтори оновлення прошивки.");
    } catch (error) {
      setFlashStatus(error instanceof Error ? error.message : "Не вдалося відновити налаштування.");
    } finally {
      flashBusyRef.current = false;
      setFlashBusy(false);
      setIsFlashingFlow(false);
    }
  }

  async function onFlashClick(restoreSettings: boolean) {
    if (flashBusyRef.current) return;
    flashBusyRef.current = true;
    try {
      await runFlashFlow(restoreSettings);
    } catch (error) {
      setFlashOutcome("error");
      setPipelineState((previous) => Object.fromEntries(Object.entries(previous).map(([key, state]) => [key, state === "active" ? "error" : state])) as Record<PipelineStepId, PipelineState>);
      setFlashStatus(error instanceof Error ? error.message : "Не вдалося завершити прошивання. Перевір USB та повтори спробу.");
    } finally {
      flashBusyRef.current = false;
      setFlashBusy(false);
      setIsFlashingFlow(false);
      setFlashProgress(null);
    }
  }

  function showActionError(error: unknown) {
    setStatus(error instanceof Error ? error.message : "Не вдалося виконати дію. Спробуй ще раз.");
  }

  const installerStep = flashBusy || portState === "connected" ? 3 : portState === "connecting" || waitActive ? 2 : 1;

  return (
    <main className="simple-shell" id="installer">
      <header className="topbar">
        <div className="brand">
          <img src="/icon.svg" alt="" width={48} height={48} className="brand-logo" />
          <div><div className="title-row"><span className="brand-name">AlarmMini</span><span className="version-badge">Інсталятор {SITE_VERSION}</span></div><p>Карта повітряних тривог</p></div>
        </div>
        <a className="help-link" href={TELEGRAM_GROUP_URL} target="_blank" rel="noreferrer">Допомога у Telegram ↗</a>
      </header>

      <section className="installer-intro">
        <div><p className="eyebrow"><span className="eyebrow-dot" /> ПРОШИВАННЯ ЧЕРЕЗ USB</p>
        <h1>Твоя карта.<br /><span>Готова до оновлення.</span></h1>
        <p className="intro-copy">Встанови AlarmMini або онови прошивку прямо у браузері. Три прості кроки — з підказками на кожному.</p></div>
        <div className="intro-note"><span className="preserve-icon" aria-hidden="true">✓</span><div><strong>Твої налаштування під захистом</strong><p>У режимі оновлення спочатку збережемо копію, а після запису відновимо й перевіримо її.</p><span>Wi-Fi <i>·</i> MQTT <i>·</i> Кольори <i>·</i> Світлодіоди</span></div></div>
      </section>

      <nav aria-label="Кроки встановлення"><ol className="journey">
        <li className={installerStep === 1 ? "current" : "done"}><a href="#choose-title" aria-current={installerStep === 1 ? "step" : undefined}><b>1</b><span>Вибери плату<small>Модель і спосіб встановлення</small></span></a></li>
        <li className={installerStep === 2 ? "current" : portState === "connected" ? "done" : ""}><a href="#usb-title" aria-current={installerStep === 2 ? "step" : undefined}><b>{portState === "connected" ? "✓" : "2"}</b><span>Підключи USB<small>{portState === "connected" ? "Плату підключено" : "Кабель із передаванням даних"}</small></span></a></li>
        <li className={flashOutcome === "success" ? "done" : installerStep === 3 ? "current" : ""}><a href="#flash-title" aria-current={installerStep === 3 && flashOutcome !== "success" ? "step" : undefined}><b>{flashOutcome === "success" ? "✓" : "3"}</b><span>{flashOutcome === "success" ? "Готово" : "Запусти запис"}<small>{flashBusy ? "Триває прошивання…" : "З перевіркою результату"}</small></span></a></li>
      </ol></nav>

      {!serialSupported ? <div className="notice warning" role="status"><strong>Для прошивання відкрий сайт на комп’ютері в Chrome або Edge.</strong><p>Цей браузер не надає доступу до USB-порту. На телефоні можна переглянути інструкцію, а прошити плату — з комп’ютера.</p></div> : null}

      <div className="installer-layout">
        <div className="installer-steps">
          <section className="card step-card" aria-labelledby="choose-title">
            <div className="step-heading"><span className="step-number">1</span><div><h2 id="choose-title">Яка в тебе плата?</h2><p className="hint">Подивись на напис на платі. ESP32-C3 та ESP8266 мають різні прошивки.</p></div></div>
            <fieldset className="choice-grid" disabled={flashBusy || waitActive}><legend className="sr-only">Тип плати</legend>
              {BOARD_TARGETS.map((board) => <label key={board.id} className={`choice-card ${selectedBoardId === board.id ? "selected" : ""}`}>
                <input type="radio" name="board" value={board.id} checked={selectedBoardId === board.id} onChange={() => {setSelectedBoardId(board.id);setFlashOutcome("idle");}} />
                <BoardIllustration compact={board.id === "esp8266"} />
                <span className="board-copy"><strong>{board.id === "esp32c3" ? "ESP32-C3" : "ESP8266"}</strong><small>{board.id === "esp32c3" ? "SuperMini · зазвичай USB-C" : "Wemos D1 mini · зазвичай micro-USB"}</small><span className="board-selection" aria-hidden="true">{selectedBoardId === board.id ? "Обрано ✓" : "Вибрати плату"}</span></span>
              </label>)}
            </fieldset>
            <fieldset className="install-options" disabled={flashBusy || waitActive}><legend>Що потрібно зробити?</legend>
              <label className={`mode-option ${!newDeviceMode ? "selected" : ""}`}><input type="radio" name="install-mode" checked={!newDeviceMode} onChange={() => {setNewDeviceMode(false);setFreshInstallConfirmed(false);setFlashOutcome("idle");}} /><span><strong>Оновлення зі збереженням налаштувань</strong><small>Для карти, на якій уже працює AlarmMini. Рекомендовано.</small></span></label>
              <label className={`mode-option ${newDeviceMode ? "selected" : ""}`}><input type="radio" name="install-mode" checked={newDeviceMode} onChange={() => {setNewDeviceMode(true);setFreshInstallConfirmed(false);setFlashOutcome("idle");}} /><span><strong>Перше встановлення</strong><small>Для порожньої плати. Наявні налаштування буде видалено.</small></span></label>
            </fieldset>
            {newDeviceMode ? <label className="erase-confirm"><input type="checkbox" checked={freshInstallConfirmed} disabled={flashBusy} onChange={(e) => setFreshInstallConfirmed(e.target.checked)} /><span>Розумію: наявні налаштування цієї плати буде видалено.</span></label> : null}
            <details className="reserve-settings"><summary>Резервний канал даних <span>Необов’язково</span></summary>
              <FallbackUrlField id="install-fallback-url" value={installFallbackUrl} onChange={setInstallFallbackUrl} token={installFallbackToken} onTokenChange={setInstallFallbackToken} disabled={flashBusy || waitActive || fallbackSaving} />
              <p className="hint">Відповідь: JSON-масив із 25 чисел 0 або 1 у порядку областей MQTT. Починаючи з прошивки 2.0.8, плата опитуватиме його кожні 30 секунд при втраті MQTT або відсутності повідомлень понад 90 секунд.</p>
              <p className="hint">Порожнє поле збереже наявну адресу під час оновлення. Потрібна прошивка 2.0.7 або новіша.</p>
              <a className="hint" href={`${GITHUB_REPO_URL}/blob/main/docs/http-fallback.md`} target="_blank" rel="noreferrer">Порядок областей і приклад відповіді ↗</a>
            </details>
            <div className="release-summary" aria-live="polite">
              {releasesLoading ? <span>Завантажуємо доступні версії…</span> : releasesError ? <><span>{releasesError}</span><button className="btn" onClick={() => setReleasesAttempt((v) => v + 1)}>Спробувати ще раз</button></> : !selectedRelease ? <span>Опублікованих версій поки немає.</span> : <><span>Версія <strong>{selectedRelease.tag_name}</strong>{selectedReleaseId === releases[0]?.id ? " · остання стабільна" : " · попередня версія"}</span><small>{selectedReleaseUpdatedAt}</small></>}
            </div>
            <details className="inline-details"><summary>Вибрати іншу версію</summary><label>Версія прошивки<select className="select" value={selectedReleaseId ?? ""} onChange={(e) => setSelectedReleaseId(Number(e.target.value))} disabled={flashBusy || releasesLoading || !releases.length}>{releases.map((release) => <option key={release.id} value={release.id}>{release.name || release.tag_name}</option>)}</select></label></details>
          </section>

          <section className="card step-card" aria-labelledby="usb-title">
            <div className="step-heading"><span className="step-number">2</span><div><h2 id="usb-title">Підключи плату через USB</h2><p className="hint">Потрібен кабель із передаванням даних. Закрий Serial Monitor, Arduino IDE та інші програми, які використовують порт.</p></div></div>
            <div className="row gap"><button className="btn primary" disabled={!serialSupported || portState === "connecting" || flashBusy || waitActive} onClick={() => void onConnectClick()}>{portState === "connecting" || waitActive ? "Підключаємо…" : portState === "connected" ? "Перевірити підключення" : "Підключити через USB"}</button>{portState === "connected" ? <button className="btn" disabled={flashBusy || waitActive} onClick={() => void disconnectPort(true)}>Вибрати інший пристрій</button> : null}</div>
            <p className="hint">У вікні браузера вибери USB Serial, USB JTAG/serial, CP210x або CH340 — назва залежить від плати — і натисни «Підключити».</p>
            <div className="connection-status" role="status" aria-live="polite"><span className={`connection-dot ${portState === "connected" ? "connected" : ""}`} aria-hidden="true" />{status}</div>
            {waitActive ? <div className="wait-mini"><span>{waitLabel}</span><progress aria-label="Очікування відповіді плати" /></div> : null}
          </section>

          <section className="card step-card flash-card" aria-labelledby="flash-title" aria-busy={flashBusy}>
            <div className="step-heading"><span className="step-number">3</span><div><h2 id="flash-title">{newDeviceMode ? "Встанови AlarmMini" : "Онови прошивку"}</h2><p className="hint">{newDeviceMode ? "Після встановлення підключиш карту до домашнього Wi-Fi." : "Wi-Fi, MQTT, кольори та відповідність світлодіодів збережуться. Якщо прочитати налаштування не вдасться, запис не почнеться."}</p></div></div>
            <button className="btn primary flash-primary" disabled={!serialSupported || !canFlash || flashBusy || fallbackSaving || waitActive || portState !== "connected" || (newDeviceMode && !freshInstallConfirmed)} onClick={() => void onFlashClick(!newDeviceMode)}>{flashBusy ? "Триває прошивання…" : newDeviceMode ? "Встановити AlarmMini" : "Оновити й зберегти налаштування"}</button>
            <p className="hint">{portState !== "connected" ? "Спочатку підключи плату в кроці 2." : !canFlash ? "Для обраної плати немає повного набору файлів. Вибери іншу версію." : newDeviceMode && !freshInstallConfirmed ? "Підтвердь скидання налаштувань у кроці 1." : "Залиш цю вкладку відкритою та не відключай USB до повідомлення про завершення."}</p>
            {flashBusy || flashOutcome !== "idle" ? <>
              <ol className="pipeline-grid" aria-label="Стан прошивання">{PIPELINE_STEPS.filter((step) => pipelineState[step.id] !== "skipped").map((step) => <li key={step.id} className={`pipeline-step ${pipelineState[step.id]}`} aria-current={pipelineState[step.id] === "active" ? "step" : undefined}><span aria-hidden="true">{pipelineState[step.id] === "done" ? "✓ " : pipelineState[step.id] === "error" ? "! " : ""}</span>{step.label}<span className="sr-only">: {pipelineState[step.id]}</span></li>)}</ol>
              {flashProgress !== null ? <progress value={flashProgress} max={100} aria-label="Запис прошивки" /> : flashBusy ? <progress aria-label="Підготовка або відновлення налаштувань" /> : null}
            </> : null}
            {flashStatus ? <div className={`notice ${flashOutcome === "error" ? "warning" : flashOutcome === "success" ? "success" : ""}`} role={flashOutcome === "error" ? "alert" : "status"} aria-live="polite">{flashStatus}</div> : null}
            {backupAvailable ? <div className="backup-actions"><button className="text-button" disabled={flashBusy && pipelineState.backup !== "done"} onClick={() => {try {downloadBackupConfigFile();} catch(error) {showActionError(error);}}}>Завантажити резервну копію налаштувань</button><small>Файл містить паролі. Зберігай його у себе.</small>{flashOutcome === "error" ? <button className="btn" disabled={flashBusy} onClick={() => void runRecoveryWizard().catch(showActionError)}>Відновити налаштування з копії</button> : null}</div> : null}
          </section>

          {flashOutcome === "success" ? <section className="card step-card completion" aria-labelledby="done-title"><h2 id="done-title">Готово. Підключи карту до мережі</h2><p>Якщо Wi-Fi вже був налаштований, карта спробує підключитися автоматично. Якщо роутер недоступний, з’явиться мережа <strong>{info.apSsid}</strong>.</p><p>Підключись телефоном до цієї мережі та відкрий <strong>192.168.4.1</strong>. Або введи домашній Wi-Fi тут, поки USB підключено.</p><form onSubmit={(event) => {event.preventDefault();void cmdSetWifi().catch(showActionError);}}><label>Назва домашньої Wi-Fi мережі<input name="wifi-ssid" value={wifiSsid} onChange={(event) => setWifiSsid(event.target.value)} autoComplete="off" spellCheck={false} required /></label><label>Пароль Wi-Fi<input name="wifi-password" type="password" autoComplete="new-password" value={wifiPassword} onChange={(event) => setWifiPassword(event.target.value)} /></label><button className="btn" disabled={portState !== "connected" || flashBusy}>Зберегти Wi-Fi на платі</button></form>{ipWebUrl && !isApModeIp ? <a className="btn primary" href={ipWebUrl} target="_blank" rel="noreferrer">Відкрити свою карту ↗</a> : null}</section> : null}
        </div>

        <aside className="installer-sidebar" aria-labelledby="help-title">
          <section className="card install-summary" aria-labelledby="summary-title"><span className="eyebrow">ТВІЙ ВИБІР</span><h2 id="summary-title">Усе готове до старту?</h2><dl><div><dt>Плата</dt><dd>{selectedBoardId === "esp32c3" ? "ESP32-C3" : "ESP8266"}</dd></div><div><dt>Прошивка</dt><dd>{selectedRelease?.tag_name ?? "Очікуємо версію"}</dd></div><div><dt>Режим</dt><dd>{newDeviceMode ? "Перше встановлення" : "Оновлення"}</dd></div></dl><div className={`summary-note ${newDeviceMode ? "erase-note" : ""}`}><span aria-hidden="true">{newDeviceMode ? "!" : "✓"}</span>{newDeviceMode ? "Плата буде очищена. Wi-Fi налаштуєш після встановлення." : "Налаштування буде збережено та відновлено автоматично."}</div></section>
          <section className="card installer-help"><h2 id="help-title">Перед початком</h2><ul className="checklist"><li>Chrome або Edge на комп’ютері</li><li>USB-кабель із передаванням даних</li><li>Стабільне живлення та інтернет</li></ul><h3 className="faq-title">Потрібна підказка?</h3><details><summary>Плата не з’являється у списку</summary><p>Спробуй інший USB-кабель та порт комп’ютера. Якщо використовується CH340 або CP210x, може знадобитися драйвер від виробника плати.</p></details><details><summary>Не починається запис</summary><p>Закрий інші програми з COM-портом. На ESP32-C3 затисни BOOT, коротко натисни RESET, відпусти BOOT і повтори запис. Якщо порт змінився, вибери пристрій знову.</p></details><details><summary>Оновлення перервалося</summary><p>Не перемикайся на перше встановлення. Перепідключи плату, повтори оновлення або віднови налаштування з резервної копії.</p></details><details><summary>Карта ще не підключилася до Wi-Fi</summary><p>Дочекайся запуску роутера. Для зміни мережі підключись до точки AlarmMap-Setup та відкрий 192.168.4.1. Потрібна мережа 2,4 ГГц.</p></details><a className="community-link" href={TELEGRAM_GROUP_URL} target="_blank" rel="noreferrer">Допомога у спільноті <span aria-hidden="true">↗</span></a></section>
        </aside>
      </div>

      <details className="card advanced-settings" open={advancedOpen} onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}><summary>Додаткові налаштування та діагностика<span>MQTT, редактор конфігурації, QR-коди, файли прошивки та журнал</span></summary>
        {advancedOpen ? <div className="advanced-content">
      <section className="grid two">
        <div className="card">
          <h2>Інформація про пристрій</h2>
          <div className="row gap">
            <button className="btn" disabled={flashBusy || portState !== "connected"} onClick={() => void cmdGetInfo().catch(showActionError)}>
              Оновити інформацію
            </button>
          </div>
          <div className="kv-grid">
            <div><span>FW</span><strong>{info.fw}</strong></div>
            <div><span>IP</span><strong>{info.ip}</strong></div>
            <div><span>mDNS</span><strong>{info.mdns}</strong></div>
            <div><span>Hostname</span><strong>{info.hostname}</strong></div>
            <div><span>MQTT Client ID</span><strong>{info.mqttClientId}</strong></div>
            <div><span>Admin пароль</span><strong>{info.adminPassword}</strong></div>
            <div><span>AP SSID</span><strong>{info.apSsid}</strong></div>
            <div><span>Reset reason</span><strong>{info.resetReason}</strong></div>
            <div><span>Last stage</span><strong>{info.lastStage}</strong></div>
            <div><span>Boot count</span><strong>{info.bootCount}</strong></div>
          </div>
          <div className="service-qr-panel qr-print-panel">
            <div className="section-head">
              <div>
                <h3>QR / Друк наклейок</h3>
                <p className="hint">Готові наклейки для корпусу: окремо web-доступ і окремо AP налаштування.</p>
              </div>
              <div className="qr-actions no-print">
                <button className="btn primary" disabled={portState !== "connected" || flashBusy} onClick={() => void refreshInfoAndLabels().catch(showActionError)}>
                  Прочитати з плати
                </button>
                <button className="btn" disabled={!adminQrSrc} onClick={printQrLabels}>
                  Друк QR
                </button>
              </div>
            </div>

            <div className="qr-toolbelt no-print">
              <div className="qr-tool-actions">
                <button className="btn" disabled={portState !== "connected" || flashBusy} onClick={() => void checkWebInterface().catch(showActionError)}>
                  Перевірити web UI
                </button>
                <a className="btn" href={adminUrl || "#"} target="_blank" rel="noreferrer" aria-disabled={!adminUrl}>
                  Відкрити web panel
                </a>
                <a className="btn" href={healthUrl || "#"} target="_blank" rel="noreferrer" aria-disabled={!healthUrl}>
                  Відкрити /health
                </a>
                {ipWebUrl ? (
                  <a className="btn" href={ipWebUrl} target="_blank" rel="noreferrer">
                    Відкрити по IP
                  </a>
                ) : null}
              </div>
              <div className={`qr-status ${isApModeIp ? "warn" : ""}`}>{webCheckStatus}</div>
            </div>

            <div className="qr-label-grid compact">
              <article className="qr-label-card">
                <div className="label-copy">
                  <span>Admin</span>
                  <h3>{isApModeIp ? "Wi‑Fi setup" : "Web panel"}</h3>
                  <p className="label-note">Адмін-доступ для власника карти</p>
                  <dl>
                    <div><dt>URL</dt><dd>{deviceBaseUrl || "-"}</dd></div>
                    <div><dt>Password</dt><dd>{isApModeIp ? "Setup portal" : info.adminPassword}</dd></div>
                  </dl>
                </div>
                <div className="qr-visual">
                  {adminQrSrc ? <img src={adminQrSrc} alt="QR вебпанелі" width={178} height={178} className="label-qr" /> : <div className="qr-placeholder">QR</div>}
                  <button className="btn" disabled={!adminQrSrc} onClick={() => downloadQrPng(adminQrSrc, `${info.hostname || "alarmmini"}-admin.png`)}>
                    PNG
                  </button>
                </div>
              </article>

              <article className="qr-label-card">
                <div className="label-copy">
                  <span>AP</span>
                  <h3>Access point</h3>
                  <p className="label-note">Швидке підключення до режиму налаштування</p>
                  <dl>
                    <div><dt>SSID</dt><dd>{info.apSsid}</dd></div>
                    <div><dt>Password</dt><dd>{info.apPassword || "Без пароля"}</dd></div>
                  </dl>
                </div>
                <div className="qr-visual">
                  {apQrSrc ? <img src={apQrSrc} alt="QR точки налаштування" width={178} height={178} className="label-qr" /> : <div className="qr-placeholder">QR</div>}
                  <button className="btn" disabled={!apQrSrc} onClick={() => downloadQrPng(apQrSrc, `${info.hostname || "alarmmini"}-ap.png`)}>
                    PNG
                  </button>
                </div>
              </article>
            </div>
          </div>
        </div>

        <div className="card">
          <h2>Мережеві налаштування</h2>
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
                <input type="password" autoComplete="new-password" name="advanced-wifi-password" value={wifiPassword} onChange={(e) => setWifiPassword(e.target.value)} />
              </label>
              <div className="row gap">
                <button className="btn" disabled={flashBusy || portState !== "connected"} onClick={() => void cmdSetWifi().catch(showActionError)}>
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
                <input type="password" autoComplete="new-password" name="mqtt-password" value={mqttPassword} onChange={(e) => setMqttPassword(e.target.value)} />
              </label>
              <div className="row gap">
                <button className="btn" disabled={flashBusy || portState !== "connected"} onClick={() => void cmdSetMqtt().catch(showActionError)}>
                  Зберегти MQTT
                </button>
              </div>
              <FallbackUrlField id="fallback-url" value={fallbackUrl} onChange={setFallbackUrl} token={fallbackToken} onTokenChange={setFallbackToken} disabled={flashBusy || waitActive || fallbackSaving} />
              <p className="hint">25 значень 0/1 у порядку MQTT. Очисти поле й збережи, щоб вимкнути резерв.</p>
              <button className="btn" disabled={flashBusy || fallbackSaving || portState !== "connected"} onClick={() => void cmdSetFallbackUrl().catch(showActionError)}>{fallbackSaving ? "Перевіряємо й зберігаємо…" : "Зберегти резервний URL"}</button>
            </div>
          )}
        </div>
      </section>

      <section className="card">
        <h2>Редактор конфігурації</h2>
        <div className="row gap">
          <button className="btn primary" onClick={() => setConfigModalOpen(true)}>
            Відкрити редактор конфігу
          </button>
          <button className="btn" disabled={portState !== "connected" || flashBusy} onClick={() => void cmdGetConfig().catch(showActionError)}>
            Зчитати конфігурацію
          </button>
          <button className="btn" disabled={flashBusy || portState !== "connected"} onClick={() => void cmdSetConfig().catch(showActionError)}>
            Зберегти конфігурацію
          </button>
          <div className="status-pill">{backupAvailable ? "Backup: знайдено" : "Backup: відсутній"}</div>
          {dangerousWriteArmed ? <div className="status-pill">Підтвердження порожнього JSON: увімкнено</div> : null}
        </div>
      </section>

      {configModalOpen ? (
        <div className="modal-overlay" onClick={() => setConfigModalOpen(false)}>
          <div className="modal-card card" ref={modalRef} role="dialog" aria-modal="true" aria-label="Редактор конфігурації" tabIndex={-1} onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>Редактор конфігурації</h2>
              <button className="btn modal-close" onClick={() => setConfigModalOpen(false)} aria-label="Закрити">
                x
              </button>
            </div>
            <div className="row gap">
              <button
                className="btn"
                disabled={flashBusy}
                onClick={() =>
                  void cmdValidateConfigCompatibility().catch((error) => {
                    const message = error instanceof Error ? error.message : String(error);
                    setStatus(`Помилка перевірки: ${message}`);
                  })
                }
              >
                Перевірити сумісність конфігу
              </button>
              <button className="btn" disabled={flashBusy || portState !== "connected"} onClick={() => void cmdSetConfig().catch(showActionError)}>
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
          </div>
        </div>
      ) : null}


          <section className="card"><h2>Файли прошивки</h2><div className="asset-block"><ul>{boardAssetList.map((asset) => <li key={asset.id}><span>{asset.name}</span><span>{formatBytes(asset.size)}</span><a href={asset.browser_download_url} target="_blank" rel="noreferrer">Завантажити</a></li>)}</ul></div></section>
          <section className="card"><h2>Журнал пристрою</h2><div className="log-box">{serialLines.length === 0 ? <div className="log-empty">Підключи плату, щоб побачити повідомлення.</div> : serialLines.map((line, index) => <div key={`${index}-${line}`}>{line}</div>)}</div></section>
        </div> : null}
      </details>
      <footer className="installer-footer"><span>AlarmMini · Зроблено для своєї карти</span><a href={GITHUB_REPO_URL} target="_blank" rel="noreferrer">Код проєкту ↗</a><a href={SUPPORT_AUTHOR_URL} target="_blank" rel="noreferrer">Підтримати автора ↗</a></footer>
    </main>
  );
}
