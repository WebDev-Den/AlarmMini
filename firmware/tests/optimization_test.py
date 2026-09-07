"""Test actual UART/HTTP serialization, LED cache and legacy migration on both targets."""
from pathlib import Path
import os
import shutil
import subprocess
import tempfile
from runtime_regressions import definition


def main():
    tests = Path(__file__).resolve().parent
    firmware = tests.parent
    json_header = next((firmware / '.pio/libdeps').glob('*/ArduinoJson/src/ArduinoJson.h'))
    uart = (firmware / 'src/uart_config.h').read_text(encoding='utf-8')
    web = (firmware / 'src/app_webserver.h').read_text(encoding='utf-8')
    leds = (firmware / 'src/leds.h').read_text(encoding='utf-8')
    with tempfile.TemporaryDirectory(prefix='alarmmini-optimization-') as temp:
        build = Path(temp)
        for name in ['Arduino.h', 'LittleFS.h']:
            (build / name).write_text('#include "storage_test_platform.h"\n')
        source = (firmware / 'src/storage.cpp').read_text(encoding='utf-8')
        (build / 'storage_under_test.cpp').write_text(source.replace('#include "platform_compat.h"', '#include "storage_test_platform.h"'), encoding='utf-8')
        body = 'namespace uartcfg { constexpr size_t UART_CHUNK_BYTES = 64;\n'
        for name in ['crc32Step', 'calcCrc', 'sendJsonResponse', 'sendNack']:
            body += definition(uart, name) + '\n'
        body += uart[uart.index('class ConfigCrcWriter'):uart.index('inline void sendExportConfig()')]
        body += '}\n' + definition(web, 'sendJson') + '\n'
        body += definition(leds, 'ledsShowIfChanged') + '\n'
        (build / 'optimization_under_test.h').write_text(body, encoding='utf-8')
        includes = [build, tests, firmware / 'src', json_header.parent]
        for target in ['ESP8266', 'ESP32']:
            executable = build / (target + '.exe')
            if os.name == 'nt':
                base = Path(os.environ.get('ProgramFiles(x86)', 'C:/Program Files (x86)'))
                setup = sorted(base.glob('Microsoft Visual Studio/*/BuildTools/VC/Auxiliary/Build/vcvars32.bat'))
                command = ['cl', '/nologo', '/EHsc', '/std:c++17', '/utf-8', '/D_CRT_SECURE_NO_WARNINGS', '/D' + target,
                           *[f'/I{p}' for p in includes], str(tests / 'optimization_test.cpp'), f'/Fe:{executable}']
                script = build / 'build.cmd'
                script.write_text(f'@call "{setup[-1]}" >nul\n@' + subprocess.list2cmdline(command) + '\n')
                subprocess.run(['cmd', '/d', '/c', str(script)], cwd=build, check=True)
            else:
                compiler = shutil.which('g++') or shutil.which('clang++')
                subprocess.run([compiler, '-m32', '-std=c++17', '-D' + target, *[f'-I{p}' for p in includes],
                                str(tests / 'optimization_test.cpp'), '-o', str(executable)], cwd=build, check=True)
            subprocess.run([str(executable)], cwd=build, check=True)


if __name__ == '__main__':
    main()
