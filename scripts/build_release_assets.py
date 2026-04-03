#!/usr/bin/env python3
import os
import shutil
import subprocess
import sys
from pathlib import Path


PROJECT_DIR = Path(__file__).resolve().parents[1]
BUILD_DIR = PROJECT_DIR / ".pio" / "build" / "usb"
OUTPUT_DIR = PROJECT_DIR / "release_artifacts"


def run(cmd, env):
    print(f"[release] {' '.join(cmd)}")
    subprocess.run(cmd, cwd=PROJECT_DIR, env=env, check=True)


def main():
    env = os.environ.copy()
    env["ALARMMINI_CONFIG_MODE"] = "release"

    run(["platformio", "run", "-e", "usb"], env)
    run(["platformio", "run", "-t", "buildfs", "-e", "usb"], env)

    OUTPUT_DIR.mkdir(exist_ok=True)

    artifacts = {
        "firmware.bin": BUILD_DIR / "firmware.bin",
        "littlefs.bin": BUILD_DIR / "littlefs.bin",
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
