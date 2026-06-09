Import("env")

import subprocess
import sys
from pathlib import Path


PROJECT_DIR = Path(env["PROJECT_DIR"])
SCRIPT_PATH = PROJECT_DIR / "scripts" / "config_preserve_flash.py"
ENV_NAME = env["PIOENV"]


def _resolve_upload_port():
    option = env.GetProjectOption("upload_port", default="")
    if option:
        return option
    env_upload_port = env.get("UPLOAD_PORT", "")
    if env_upload_port:
        return env_upload_port
    return None


def _run_preserve(skip_fs: bool):
    cmd = [
        sys.executable,
        str(SCRIPT_PATH),
        "--env",
        ENV_NAME,
    ]
    port = _resolve_upload_port()
    if port:
        cmd.extend(["--port", port])
    if skip_fs:
        cmd.append("--skip-fs")
    print(f"[preserve] {' '.join(cmd)}")
    return subprocess.call(cmd, cwd=str(PROJECT_DIR))


def flash_preserve_action(*_args, **_kwargs):
    return _run_preserve(skip_fs=False)


def flash_preserve_fw_action(*_args, **_kwargs):
    return _run_preserve(skip_fs=True)


env.AddCustomTarget(
    name="flash_preserve",
    dependencies=None,
    actions=[flash_preserve_action],
    title="Flash with config preserve (FW+FS)",
    description="Backup config, upload firmware+LittleFS, restore config",
)

env.AddCustomTarget(
    name="flash_preserve_fw",
    dependencies=None,
    actions=[flash_preserve_fw_action],
    title="Flash firmware with config preserve",
    description="Backup config, upload firmware only, restore config",
)
