"""Run production runtime functions with simulated time, serial and LittleFS.

Uses the same 32-bit host compiler/dependency setup as storage_fault_injection.py.
Functions are extracted unchanged from firmware headers to isolate hardware I/O.
"""
from pathlib import Path
import os
import re
import shutil
import subprocess
import tempfile


def definition(source, name):
    match = re.search(r"(?m)^[^\n]*\b" + re.escape(name) + r"\([^;]*?\)\s*\{", source)
    if not match:
        raise ValueError(f"Missing function: {name}")
    start = source.index("{", match.start())
    depth = 0
    # Ignore braces inside strings/comments; include the production body verbatim.
    tokens = r'"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'|//[^\n]*|/\*[\s\S]*?\*/|[{}]'
    for token in re.finditer(tokens, source[start:]):
        if token.group() == "{":
            depth += 1
        elif token.group() == "}":
            depth -= 1
            if depth == 0:
                return source[match.start():start + token.end()]
    raise ValueError(f"Unterminated function: {name}")


def main():
    tests = Path(__file__).resolve().parent
    firmware = tests.parent
    alerts = (firmware / "src/alerts.h").read_text(encoding="utf-8")
    uart = (firmware / "src/uart_config.h").read_text(encoding="utf-8")
    buzzer = (firmware / "src/buzzer.h").read_text(encoding="utf-8")
    json_header = next((firmware / ".pio/libdeps").glob("*/ArduinoJson/src/ArduinoJson.h"), None)
    if not json_header:
        raise SystemExit("Install the firmware PlatformIO dependencies first")

    body = alerts[alerts.index("bool gAlerts["):alerts.index("// PubSubClient's timeout")]
    body += alerts[alerts.index("class MqttWiFiClient"):alerts.index("static MqttWiFiClient _mqttWifi;")]
    for name in ["_mqttResolvedIp", "_mqttHasResolvedIp", "_mqttLastDnsLogAt", "_mqttLastDnsResolveAt", "MQTT_DNS_REFRESH_MS"]:
        body += re.search(r"(?m)^static [^\n]*\b" + name + r"\b[^\n]*", alerts).group() + "\n"
    body += alerts[alerts.index("struct MqttDnsQuery"):alerts.index("static void _rebuildEffectiveAlerts();")]
    body += alerts[alerts.index("static constexpr char MQTT_SNAPSHOT_PATH"):alerts.index("// Persistent callback storage")]
    body += "\nstatic constexpr unsigned MQTT_MAX_PAYLOAD_BYTES = 1024;\nstatic void _rebuildEffectiveAlerts();\n"
    for name in ["_saveMqttSnapshot", "_loadMqttSnapshot", "_mqttSnapshotTick", "_formatLogClock",
                 "_applyEffectiveAlerts", "_rebuildEffectiveAlerts", "_mqttCallback"]:
        body += definition(alerts, name) + "\n"

    body += "\nnamespace uartcfg {\n"
    body += uart[uart.index("constexpr size_t UART_LINE_MAX"):uart.index("inline int hexNibble")]
    body += "void sendNack(const char*, const char*) { ++nacks; }\n"
    body += "void processLine(const char* line) { processed.emplace_back(line); }\n"
    for name in ["hexNibble", "resetLineBuffer", "resetSession", "decodeHexAppend", "init", "handle"]:
        body += definition(uart, name) + "\n"
    body += "}\n"
    # Keep the active production melody/timing implementation, replacing only its
    # platform-audio dependency (provided by runtime_regressions.cpp).
    body += buzzer[buzzer.index("#define NOTE_C4"):buzzer.index("\n#else\n\nvoid buzzerInit")]

    with tempfile.TemporaryDirectory(prefix="alarmmini-runtime-") as temp:
        build = Path(temp)
        (build / "Arduino.h").write_text('#include "storage_test_platform.h"\n')
        (build / "runtime_under_test.h").write_text(body, encoding="utf-8")
        include = [build, tests, firmware / "src", json_header.parent]
        executable = build / "runtime-tests.exe"
        if os.name == "nt":
            base = Path(os.environ.get("ProgramFiles(x86)", "C:/Program Files (x86)"))
            candidates = sorted(base.glob("Microsoft Visual Studio/*/BuildTools/VC/Auxiliary/Build/vcvars32.bat"))
            if not candidates:
                raise SystemExit("MSVC x86 build tools are required")
            command = ["cl", "/nologo", "/EHsc", "/std:c++17", "/utf-8", "/D_CRT_SECURE_NO_WARNINGS",
                       *[f"/I{p}" for p in include], str(tests / "runtime_regressions.cpp"), f"/Fe:{executable}"]
            script = build / "build.cmd"
            script.write_text(f'@call "{candidates[-1]}" >nul\n@' + subprocess.list2cmdline(command) + "\n")
            subprocess.run(["cmd", "/d", "/c", str(script)], cwd=build, check=True)
        else:
            compiler = shutil.which("g++") or shutil.which("clang++")
            if not compiler:
                raise SystemExit("g++ or clang++ is required")
            subprocess.run([compiler, "-m32", "-std=c++17", *[f"-I{p}" for p in include],
                            str(tests / "runtime_regressions.cpp"), "-o", str(executable)], cwd=build, check=True)
        subprocess.run([str(executable)], cwd=build, check=True)


if __name__ == "__main__":
    main()
