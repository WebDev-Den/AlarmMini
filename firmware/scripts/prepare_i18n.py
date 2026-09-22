"""Embed the setup portal's JSON translations so recovery needs no filesystem or internet."""
import json
from pathlib import Path


def build_portal_script(project_dir):
    web = Path(project_dir) / "work_data"
    keys = json.loads((web / "locales" / "provision-keys.json").read_text(encoding="utf-8"))
    catalogs = {}
    for locale in ("ua", "en"):
        messages = json.loads((web / "locales" / f"{locale}.json").read_text(encoding="utf-8"))
        catalogs[locale] = {key: messages[key] for key in keys}
    controls = """<style>
.language-switcher{display:flex;justify-content:flex-end;gap:4px;margin-bottom:16px}
.language-switcher button{width:auto;min-width:44px;min-height:44px;margin:0;padding:8px 12px;background:#07172c;color:#eef6ff;border:1px solid #28476e;border-radius:10px;font:600 14px system-ui;cursor:pointer}
.language-switcher button[aria-pressed=true]{background:#ffd447;color:#06101f}
button,a,input{touch-action:manipulation} :focus-visible{outline:2px solid #ffd447;outline-offset:3px}
.pill{overflow-wrap:anywhere;max-width:100%;flex-wrap:wrap}.net b{overflow-wrap:anywhere;min-width:0}.net span{flex-shrink:0}
html{color-scheme:dark}.status{overflow-wrap:anywhere}
@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}
</style><div class="language-switcher" role="group" aria-label="Мова / Language" translate="no"><button type="button" data-locale="ua" lang="uk" aria-label="Українська" aria-pressed="true">UA</button><button type="button" data-locale="en" lang="en" aria-label="English" aria-pressed="false">EN</button></div>"""
    scripts = "\n".join((web / name).read_text(encoding="utf-8") for name in ("i18n-core.js", "i18n.js"))
    scripts += "\ndocument.querySelector('main').insertAdjacentHTML('afterbegin', " + json.dumps(controls, ensure_ascii=False) + ");\n"
    scripts += "window.AlarmI18n.init(" + json.dumps(catalogs, ensure_ascii=False, separators=(",", ":")) + ");\n"
    return "<script>\n" + scripts + "</script>"


def write_portal_header(project_dir, output_dir):
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    header = '#pragma once\nstatic const char PROVISION_I18N_SCRIPT[] PROGMEM = R"i18nportal(' + build_portal_script(project_dir) + ')i18nportal";\n'
    target = output_dir / "provision_i18n.h"
    if not target.exists() or target.read_text(encoding="utf-8") != header:
        target.write_text(header, encoding="utf-8")


if __name__ == "__main__":
    import sys
    # Used by browser tests to exercise exactly the script embedded by PlatformIO.
    sys.stdout.reconfigure(encoding="utf-8")
    print(build_portal_script(Path(__file__).resolve().parents[1]))
