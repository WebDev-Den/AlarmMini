#!/usr/bin/env python3
import os
import shutil
import subprocess
import sys
from pathlib import Path


PROJECT_DIR = Path(__file__).resolve().parents[1]
OUTPUT_DIR = PROJECT_DIR / "release_artifacts"
ESP8266_BUILD_DIR = PROJECT_DIR / ".pio" / "build" / "esp8266"
ESP32C3_BUILD_DIR = PROJECT_DIR / ".pio" / "build" / "esp32c3"


def run(cmd, env):
    print(f"[release] {' '.join(cmd)}")
    subprocess.run(cmd, cwd=PROJECT_DIR, env=env, check=True)


def main():
    env = os.environ.copy()
    env["ALARMMINI_CONFIG_MODE"] = "release"

    run(["platformio", "run", "-e", "esp8266"], env)
    run(["platformio", "run", "-t", "buildfs", "-e", "esp8266"], env)
    run(["platformio", "run", "-e", "esp32c3"], env)
    run(["platformio", "run", "-t", "buildfs", "-e", "esp32c3"], env)

    OUTPUT_DIR.mkdir(exist_ok=True)

    artifacts = {
        "alarmmini-esp8266-firmware.bin": ESP8266_BUILD_DIR / "firmware.bin",
        "alarmmini-esp8266-littlefs.bin": ESP8266_BUILD_DIR / "littlefs.bin",
        "alarmmini-esp32c3-firmware.bin": ESP32C3_BUILD_DIR / "firmware.bin",
        "alarmmini-esp32c3-littlefs.bin": ESP32C3_BUILD_DIR / "littlefs.bin",
        "alarmmini-esp32c3-bootloader.bin": ESP32C3_BUILD_DIR / "bootloader.bin",
        "alarmmini-esp32c3-partitions.bin": ESP32C3_BUILD_DIR / "partitions.bin",
        "alarmmini-esp32c3-boot_app0.bin": Path.home()
        / ".platformio"
        / "packages"
        / "framework-arduinoespressif32"
        / "tools"
        / "partitions"
        / "boot_app0.bin",
    }

    for name, src in artifacts.items():
        if not src.exists():
            raise FileNotFoundError(f"Missing build artifact: {src}")
        shutil.copy2(src, OUTPUT_DIR / name)
        print(f"[release] copied {name} -> {OUTPUT_DIR / name}")

    print("[release] done")
    print(f"[release] artifacts dir: {OUTPUT_DIR}")


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as error:
        sys.exit(error.returncode)
