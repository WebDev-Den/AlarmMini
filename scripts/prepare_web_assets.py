Import("env")

import gzip
import json
import os
import re
import shutil

from SCons.Script import COMMAND_LINE_TARGETS


FS_TARGETS = {"buildfs", "uploadfs", "uploadfsota"}
WORK_SOURCE_DIR = os.path.join(env.subst("$PROJECT_DIR"), "work_data")
OUTPUT_DIR = os.path.join(env.subst("$PROJECT_DIR"), "data")
CONFIG_PATH = os.path.join(WORK_SOURCE_DIR, "config.json")
CONFIG_EXAMPLE_PATH = os.path.join(WORK_SOURCE_DIR, "config.example.json")
TEXT_ASSET_EXTENSIONS = {".html", ".css", ".js", ".svg"}
CONFIG_MODE = os.environ.get("ALARMMINI_CONFIG_MODE", "").strip().lower()


def _read_text(path):
    with open(path, "r", encoding="utf-8") as fp:
        return fp.read()


def _write_text(path, content):
    with open(path, "w", encoding="utf-8", newline="\n") as fp:
        fp.write(content)


def _minify_html(text):
    text = re.sub(r"<!--(?!\[if).*?-->", "", text, flags=re.S)
    text = re.sub(r">\s+<", "><", text)
    text = re.sub(r"\n\s*\n+", "\n", text)
    return text.strip() + "\n"


def _minify_css(text):
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
    text = re.sub(r"\s+", " ", text)
    text = re.sub(r"\s*([{}:;,>])\s*", r"\1", text)
    text = re.sub(r";}", "}", text)
    return text.strip()


def _minify_js(text):
    lines = []
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("//"):
            continue
        lines.append(line.rstrip())
    return "\n".join(lines).strip() + "\n"


def _minify_svg(text):
    text = re.sub(r"<!--.*?-->", "", text, flags=re.S)
    text = re.sub(r">\s+<", "><", text)
    text = re.sub(r"\s{2,}", " ", text)
    return text.strip()


def _minify_json(text):
    data = json.loads(text)
    return json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n"


def _minify_file(path):
    ext = os.path.splitext(path)[1].lower()
    content = _read_text(path)

    if ext == ".html":
        content = _minify_html(content)
    elif ext == ".css":
        content = _minify_css(content)
    elif ext == ".js":
        content = _minify_js(content)
    elif ext == ".svg":
        content = _minify_svg(content)
    elif ext == ".json":
        content = _minify_json(content)

    _write_text(path, content)


def _gzip_file(path):
    gz_path = path + ".gz"
    with open(path, "rb") as src, open(gz_path, "wb") as raw_dst:
        with gzip.GzipFile(filename="", mode="wb", fileobj=raw_dst, compresslevel=9, mtime=0) as dst:
            shutil.copyfileobj(src, dst)
    # Keep original uncompressed asset as a safe fallback for devices/browsers
    # where gzip delivery might fail. The web server serves plain files first.


def _clear_directory(path):
    if not os.path.isdir(path):
        return

    for name in os.listdir(path):
        item = os.path.join(path, name)
        if os.path.isdir(item):
            shutil.rmtree(item)
        else:
            os.remove(item)


def _prepare_assets():
    if not os.path.isdir(WORK_SOURCE_DIR):
        print(f"[web-assets] work_data not found, using existing data: {OUTPUT_DIR}")
        env.Replace(PROJECT_DATA_DIR=OUTPUT_DIR, PROJECTDATA_DIR=OUTPUT_DIR)
        return

    os.makedirs(OUTPUT_DIR, exist_ok=True)
    _clear_directory(OUTPUT_DIR)
    shutil.copytree(WORK_SOURCE_DIR, OUTPUT_DIR, dirs_exist_ok=True)

    output_config_path = os.path.join(OUTPUT_DIR, "config.json")
    output_example_path = os.path.join(OUTPUT_DIR, "config.example.json")
    if CONFIG_MODE == "release":
        if not os.path.isfile(CONFIG_EXAMPLE_PATH):
            raise FileNotFoundError(f"[web-assets] release build requires config.example.json: {CONFIG_EXAMPLE_PATH}")
        shutil.copy2(CONFIG_EXAMPLE_PATH, output_config_path)
        print("[web-assets] config mode: release (using config.example.json)")
    elif not os.path.isfile(CONFIG_PATH) and os.path.isfile(CONFIG_EXAMPLE_PATH):
        shutil.copy2(CONFIG_EXAMPLE_PATH, output_config_path)
        print("[web-assets] config mode: fallback example")
    else:
        print("[web-assets] config mode: local")
    if os.path.isfile(output_example_path):
        os.remove(output_example_path)

    for root, _, files in os.walk(OUTPUT_DIR):
        for name in files:
            path = os.path.join(root, name)
            ext = os.path.splitext(name)[1].lower()

            if ext in {".html", ".css", ".js", ".svg", ".json"}:
                _minify_file(path)

            if ext in TEXT_ASSET_EXTENSIONS:
                _gzip_file(path)

    env.Replace(PROJECT_DATA_DIR=OUTPUT_DIR, PROJECTDATA_DIR=OUTPUT_DIR)
    print(f"[web-assets] source: {WORK_SOURCE_DIR}")
    print(f"[web-assets] buildfs data dir: {OUTPUT_DIR}")


if FS_TARGETS.intersection(COMMAND_LINE_TARGETS):
    _prepare_assets()
