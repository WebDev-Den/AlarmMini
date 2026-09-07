"""Compile and execute production storage.cpp with in-memory I/O fault injection.

Requires the PlatformIO ArduinoJson dependency and either g++ or Windows MSVC.
The Windows target is x86, matching the ESP's 32-bit JSON allocation sizes.
All generated files live in a temporary directory; no board is required.
"""
from pathlib import Path
import os
import shutil
import subprocess
import tempfile


def main():
    tests = Path(__file__).resolve().parent
    firmware = tests.parent
    json_header = next((firmware / ".pio" / "libdeps").glob("*/ArduinoJson/src/ArduinoJson.h"), None)
    if not json_header:
        raise SystemExit("ArduinoJson missing: first install the firmware's PlatformIO dependencies")
    with tempfile.TemporaryDirectory(prefix="alarmmini-storage-tests-") as temp:
        build = Path(temp)
        (build / "Arduino.h").write_text('#include "storage_test_platform.h"\n')
        (build / "LittleFS.h").write_text('#include "storage_test_platform.h"\n')
        source = (firmware / "src" / "storage.cpp").read_text(encoding="utf-8")
        source = source.replace('#include "platform_compat.h"', '#include "storage_test_platform.h"')
        (build / "storage_under_test.cpp").write_text(source, encoding="utf-8")
        trace_source = (firmware / "src" / "reset_trace.cpp").read_text(encoding="utf-8")
        trace_source = trace_source.replace('#include "platform_compat.h"', '#include "storage_test_platform.h"')
        (build / "reset_trace_under_test.cpp").write_text(trace_source, encoding="utf-8")
        include = [build, tests, firmware / "src", json_header.parent]
        if os.name == "nt":
            base = Path(os.environ.get("ProgramFiles(x86)", "C:/Program Files (x86)"))
            candidates = sorted(base.glob("Microsoft Visual Studio/*/BuildTools/VC/Auxiliary/Build/vcvars32.bat"))
            if not candidates:
                raise SystemExit("MSVC x86 build tools are required")
            for test in ["storage_fault_injection", "storage_reset_trace_test"]:
                executable = build / (test + ".exe")
                command = ["cl", "/nologo", "/EHsc", "/std:c++17", "/utf-8", "/D_CRT_SECURE_NO_WARNINGS",
                           "/DESP8266", *[f"/I{p}" for p in include],
                           str(tests / (test + ".cpp")), f"/Fe:{executable}"]
                # vcvars32 initializes compiler/system include paths in the same shell.
                script = build / "build.cmd"
                script.write_text(f'@call "{candidates[-1]}" >nul\n@' + subprocess.list2cmdline(command) + "\n")
                subprocess.run(["cmd", "/d", "/c", str(script)], cwd=build, check=True)
                subprocess.run([str(executable)], cwd=build, check=True)
        else:
            compiler = shutil.which("g++") or shutil.which("clang++")
            if not compiler:
                raise SystemExit("g++ or clang++ is required")
            for test in ["storage_fault_injection", "storage_reset_trace_test"]:
                executable = build / test
                subprocess.run([compiler, "-m32", "-std=c++17", "-DESP8266",
                                *[f"-I{p}" for p in include], str(tests / (test + ".cpp")),
                                "-o", str(executable)], cwd=build, check=True)
                subprocess.run([str(executable)], cwd=build, check=True)


if __name__ == "__main__":
    main()
