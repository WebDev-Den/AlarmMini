#!/usr/bin/env python3
import argparse
import json
import subprocess
import sys
import time
from pathlib import Path
from urllib import request, error

import serial
from serial.tools import list_ports


BAUDRATE = 115200
BACKUP_TIMEOUT_S = 20.0
RESTORE_TIMEOUT_S = 20.0
RECONNECT_TIMEOUT_S = 35.0
CHUNK_BYTES = 64

PROJECT_DIR = Path(__file__).resolve().parents[1]
BACKUP_DIR = PROJECT_DIR / ".pio" / "config-backups"


def _log(msg: str) -> None:
    print(f"[preserve] {msg}")


def _platformio_run(env_name: str, target: str, upload_port: str | None = None) -> None:
    cmd = ["platformio", "run", "-e", env_name, "-t", target]
    if upload_port:
        cmd.extend(["--upload-port", upload_port])
    _log(f"run: {' '.join(cmd)}")
    subprocess.run(cmd, cwd=PROJECT_DIR, check=True)


def _pick_port(explicit_port: str | None) -> str:
    if explicit_port:
        return explicit_port
    ports = [p.device for p in list_ports.comports()]
    if len(ports) == 1:
        return ports[0]
    if not ports:
        raise RuntimeError("No serial ports found. Pass --port explicitly.")
    raise RuntimeError(f"Multiple serial ports found: {ports}. Pass --port explicitly.")


def _open_serial(port: str, timeout_s: float = 6.0) -> serial.Serial:
    deadline = time.time() + timeout_s
    last_exc: Exception | None = None

    while time.time() < deadline:
        try:
            ser = serial.Serial(port=port, baudrate=BAUDRATE, timeout=0.25, write_timeout=1)
            break
        except Exception as exc:
            last_exc = exc
            time.sleep(0.35)
    else:
        raise last_exc if last_exc else RuntimeError(f"Could not open serial port {port}")

    time.sleep(0.25)
    try:
        ser.reset_input_buffer()
        ser.reset_output_buffer()
    except Exception:
        pass
    return ser


def _write_line(ser: serial.Serial, line: str) -> None:
    payload = (line.strip() + "\n").encode("utf-8")
    ser.write(payload)
    ser.flush()


def _read_lines_until(ser: serial.Serial, timeout_s: float, predicate):
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        raw = ser.readline()
        if not raw:
            continue
        text = raw.decode("utf-8", errors="replace").strip()
        if not text:
            continue
        if predicate(text):
            return text
    raise TimeoutError("Timed out waiting for expected serial response")


def _try_parse_json(line: str):
    if not (line.startswith("{") and line.endswith("}")):
        return None
    try:
        return json.loads(line)
    except Exception:
        return None


def _wait_ack(ser: serial.Serial, cmd_name: str, timeout_s: float) -> None:
    def is_ack(line: str) -> bool:
        obj = _try_parse_json(line)
        if not obj:
            return False
        if obj.get("status") == "NACK":
            reason = obj.get("reason", "unknown")
            raise RuntimeError(f"Device rejected {cmd_name}: {reason}")
        return obj.get("status") == "ACK" and obj.get("cmd") == cmd_name

    _read_lines_until(ser, timeout_s, is_ack)


def backup_config(port: str) -> dict:
    _log(f"backup config from {port}")
    with _open_serial(port) as ser:
        _write_line(ser, "get:config")

        def is_config(line: str) -> bool:
            obj = _try_parse_json(line)
            return bool(obj and obj.get("event") == "config" and isinstance(obj.get("config"), dict))

        line = _read_lines_until(ser, BACKUP_TIMEOUT_S, is_config)
        obj = json.loads(line)
        return obj["config"]


def restore_config(port: str, config_obj: dict) -> None:
    _log(f"restore config to {port}")
    payload = json.dumps(config_obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    with _open_serial(port) as ser:
        _write_line(ser, "cmd=set_begin")
        _wait_ack(ser, "set_begin", 5.0)

        for offset in range(0, len(payload), CHUNK_BYTES):
            chunk = payload[offset : offset + CHUNK_BYTES]
            _write_line(ser, f"data={chunk.hex().upper()}")
            _wait_ack(ser, "set_data", 5.0)

        _write_line(ser, "cmd=set_end")
        _wait_ack(ser, "set_end", RESTORE_TIMEOUT_S)


def wait_port_ready(port: str, timeout_s: float) -> None:
    _log("waiting board reconnect")
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        try:
            with _open_serial(port):
                return
        except Exception:
            time.sleep(0.6)
    raise TimeoutError(f"Board did not reconnect on {port} in time")


def save_backup_file(env_name: str, port: str, config_obj: dict) -> Path:
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    safe_port = port.replace("\\", "_").replace("/", "_").replace(":", "_")
    backup_path = BACKUP_DIR / f"{env_name}-{safe_port}.json"
    backup_path.write_text(json.dumps(config_obj, ensure_ascii=False, indent=2), encoding="utf-8")
    return backup_path


def _http_get_json(url: str, timeout_s: float = 8.0) -> dict:
    req = request.Request(url, method="GET")
    with request.urlopen(req, timeout=timeout_s) as resp:
        data = resp.read().decode("utf-8", errors="replace")
        return json.loads(data)


def _http_post_json(url: str, payload: dict, timeout_s: float = 10.0) -> dict | None:
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    req = request.Request(url, method="POST", data=body, headers={"Content-Type": "application/json"})
    with request.urlopen(req, timeout=timeout_s) as resp:
        raw = resp.read().decode("utf-8", errors="replace").strip()
        if not raw:
            return None
        try:
            return json.loads(raw)
        except Exception:
            return None


def backup_config_http(ip_or_host: str) -> dict:
    base = f"http://{ip_or_host}"
    _log(f"backup config over HTTP from {base}/config")
    obj = _http_get_json(f"{base}/config", timeout_s=BACKUP_TIMEOUT_S)
    if not isinstance(obj, dict):
        raise RuntimeError("HTTP backup returned non-object JSON")
    return obj


def restore_config_http(ip_or_host: str, config_obj: dict) -> None:
    base = f"http://{ip_or_host}"
    _log(f"restore config over HTTP to {base}/config")
    response = _http_post_json(f"{base}/config", config_obj, timeout_s=RESTORE_TIMEOUT_S)
    if isinstance(response, dict) and response.get("ok") is False:
        raise RuntimeError(f"HTTP restore rejected: {response}")


def run_flash_flow_serial(env_name: str, port: str, skip_fs: bool) -> None:
    cfg = backup_config(port)
    backup_path = save_backup_file(env_name, port, cfg)
    _log(f"config backup saved: {backup_path}")

    _platformio_run(env_name, "upload", upload_port=port)
    if not skip_fs:
        _platformio_run(env_name, "uploadfs", upload_port=port)

    wait_port_ready(port, RECONNECT_TIMEOUT_S)
    restore_config(port, cfg)
    _log("done: config preserved and restored")


def run_flash_flow_ota(env_name: str, host: str, skip_fs: bool) -> None:
    cfg = backup_config_http(host)
    backup_path = save_backup_file(env_name, host, cfg)
    _log(f"config backup saved: {backup_path}")

    _platformio_run(env_name, "upload", upload_port=host)
    if not skip_fs:
        _platformio_run(env_name, "uploadfs", upload_port=host)

    # OTA reboot can take a bit longer before HTTP endpoint becomes ready again.
    deadline = time.time() + RECONNECT_TIMEOUT_S
    last_err = None
    while time.time() < deadline:
        try:
            _ = _http_get_json(f"http://{host}/health", timeout_s=4.0)
            last_err = None
            break
        except Exception as exc:
            last_err = exc
            time.sleep(1.0)
    if last_err is not None:
        raise TimeoutError(f"Board did not return online over HTTP in time: {last_err}")

    restore_config_http(host, cfg)
    _log("done: OTA flash + HTTP config restore completed")


def main() -> int:
    parser = argparse.ArgumentParser(description="Flash firmware/filesystem with config preserve.")
    parser.add_argument("--env", required=True, help="PlatformIO environment, e.g. esp32c3 or esp8266")
    parser.add_argument("--port", default=None, help="Serial port, e.g. COM7")
    parser.add_argument("--ota-host", default=None, help="OTA target host/IP, e.g. 192.168.1.77")
    parser.add_argument("--skip-fs", action="store_true", help="Do not upload LittleFS image")
    args = parser.parse_args()

    if args.ota_host:
        _log(f"selected OTA host: {args.ota_host}")
        run_flash_flow_ota(args.env, args.ota_host, args.skip_fs)
    else:
        port = _pick_port(args.port)
        _log(f"selected port: {port}")
        run_flash_flow_serial(args.env, port, args.skip_fs)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except subprocess.CalledProcessError as exc:
        _log(f"PlatformIO failed: {exc}")
        raise SystemExit(exc.returncode)
    except Exception as exc:
        _log(f"failed: {exc}")
        raise SystemExit(1)
