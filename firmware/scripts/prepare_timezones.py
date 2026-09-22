"""Generate flash-only timezone lookup and browser data from the IANA JSON catalog."""
import json
from pathlib import Path


def generate(project_dir, check=False):
    root = Path(project_dir)
    data = json.loads((root / 'work_data/timezones.json').read_text(encoding='utf-8'))
    rows = data['zones']
    assert data['default'] in {row['id'] for row in rows}
    assert len({row['id'] for row in rows}) == len(rows)
    assert all(len(row['id']) < 48 and 0 < len(row['rule']) < 128 for row in rows)
    header = '''// Generated from work_data/timezones.json; run scripts/prepare_timezones.py.
#pragma once
#include <cstring>
#include <cstdint>
#include <cstdio>
#ifdef ARDUINO
#include <pgmspace.h>
#define ALARM_TZ_FLASH PROGMEM
#else
#define ALARM_TZ_FLASH
#endif
namespace alarmTimeZones {
constexpr char DEFAULT_ID[] = "Europe/Kyiv";
inline char readByte(const char *p) {
#ifdef ARDUINO
    return pgm_read_byte(p);
#else
    return *p;
#endif
}
inline const char *ruleFor(const char *id) {
    static const char ZONES[] ALARM_TZ_FLASH =
'''
    header += ''.join('    ' + json.dumps(row['id'])[:-1] + r'\0" ' + json.dumps(row['rule'])[:-1] + r'\0"' + '\n' for row in rows)
    header += ''';
    if (!id) return nullptr;
    static char rule[128];
    const char *entry = ZONES;
    while (readByte(entry)) {
        const char *value = id;
        bool match = true;
        for (char c; (c = readByte(entry++)) != 0;) {
            if (*value != c) match = false;
            if (*value) ++value;
        }
        match = match && !*value;
        size_t length = 0;
        for (char c; (c = readByte(entry++)) != 0;) {
            if (match && length < sizeof(rule) - 1) rule[length++] = c;
        }
        if (match) { rule[length] = 0; return rule; }
    }
    return nullptr;
}
}
'''
    header += 'namespace alarmTimeZones {\ninline bool offsetAt(const char *id, int64_t now, int32_t &offset) {\n    struct Transition { uint32_t at; int32_t offset; };\n'
    for row in rows:
        transitions = row.get('transitions', [])
        if not transitions:
            continue
        assert all(0 <= at <= 0xffffffff for at, _ in transitions)
        header += '    if (strcmp(id, ' + json.dumps(row['id']) + ') == 0 && now >= ' + str(transitions[0][0]) + 'LL && now < ' + str(transitions[-1][0]) + 'LL) {\n'
        header += '        static const Transition changes[] ALARM_TZ_FLASH = {' + ','.join('{' + str(at) + 'U,' + str(offset) + '}' for at, offset in transitions) + '};\n'
        header += """        for (int i = sizeof(changes) / sizeof(changes[0]) - 1; i >= 0; --i) {
            Transition entry;
#ifdef ARDUINO
            memcpy_P(&entry, &changes[i], sizeof(entry));
#else
            entry = changes[i];
#endif
            if (now >= entry.at) { offset = entry.offset; return true; }
        }
    }
"""
    header += """    return false;
}
inline const char *ruleAt(const char *id, int64_t now) {
    const char *rule = ruleFor(id);
    if (!rule) return nullptr;
    int32_t offset;
    if (!offsetAt(id, now, offset)) return rule;
    static char fixed[32];
    const unsigned absolute = offset < 0 ? -offset : offset;
    snprintf(fixed, sizeof(fixed), "UTC%s%u:%02u:%02u", offset < 0 ? "+" : "-", absolute / 3600, (absolute % 3600) / 60, absolute % 60);
    return fixed;
}
}
#undef ALARM_TZ_FLASH
"""
    browser = {**data, 'zones': [{k: v for k, v in row.items() if k not in ('rule', 'transitions')} for row in rows]}
    script = '// Generated from timezones.json; run scripts/prepare_timezones.py.\n(function(root, factory) { if (typeof module === "object" && module.exports) module.exports = factory(); else root.AlarmTimeZones = factory(); })(typeof globalThis !== "undefined" ? globalThis : this, function() { return ' + json.dumps(browser, ensure_ascii=False, separators=(',', ':')) + '; });\n'
    for path, content in [(root / 'src/timezones.h', header), (root / 'work_data/timezones.js', script)]:
        if not path.exists() or path.read_text(encoding='utf-8') != content:
            if check:
                raise ValueError(f'Stale timezone catalog: {path}')
            path.write_text(content, encoding='utf-8')


if __name__ == '__main__':
    import sys
    generate(Path(__file__).resolve().parents[1], '--check' in sys.argv)
