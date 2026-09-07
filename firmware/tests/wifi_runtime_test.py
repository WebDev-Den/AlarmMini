"""Compile actual Wi-Fi recovery functions with deterministic radio/DNS/storage fakes.

Tests the production functions extracted verbatim from startup.h, not a mirrored
implementation. Requires MSVC on Windows or g++/clang++ with 32-bit headers on Unix.
No board or network connection is used. Builds and runs the schedule tests too.
"""
from pathlib import Path
import os
import shutil
import subprocess
import tempfile


def main():
    tests = Path(__file__).resolve().parent
    firmware = tests.parent
    source = (firmware / "src" / "startup.h").read_text(encoding="utf-8")
    globals_start = source.index("static DNSServer gProvisioningDns;")
    globals_end = source.index("static void _showStartupBounceFlagAnimation(")
    runtime_start = source.index("static void _startProvisioningDns()")
    runtime_end = source.index("static bool _isProvisioningRequest(")
    with tempfile.TemporaryDirectory(prefix="alarmmini-wifi-tests-") as temp:
        build = Path(temp)
        (build / "startup_runtime_under_test.h").write_text(
            source[globals_start:globals_end] + source[runtime_start:runtime_end], encoding="utf-8"
        )
        for name in ("wifi_recovery_test", "wifi_runtime_test"):
            executable = build / (name + ".exe")
            if os.name == "nt":
                base = Path(os.environ.get("ProgramFiles(x86)", "C:/Program Files (x86)"))
                setup = sorted(base.glob("Microsoft Visual Studio/*/BuildTools/VC/Auxiliary/Build/vcvars32.bat"))
                if not setup:
                    raise SystemExit("MSVC x86 build tools are required")
                command = ["cl", "/nologo", "/EHsc", "/std:c++17", "/utf-8", "/D_CRT_SECURE_NO_WARNINGS",
                           f"/I{build}", str(tests / (name + ".cpp")), f"/Fe:{executable}"]
                script = build / "build.cmd"
                script.write_text(f'@call "{setup[-1]}" >nul\n@' + subprocess.list2cmdline(command) + "\n")
                subprocess.run(["cmd", "/d", "/c", str(script)], cwd=build, check=True)
            else:
                compiler = shutil.which("g++") or shutil.which("clang++")
                if not compiler:
                    raise SystemExit("g++ or clang++ is required")
                subprocess.run([compiler, "-m32", "-std=c++17", f"-I{build}",
                                str(tests / (name + ".cpp")), "-o", str(executable)], cwd=build, check=True)
            subprocess.run([str(executable)], cwd=build, check=True)


if __name__ == "__main__":
    main()
