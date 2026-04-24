#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any


PROJECT_DIR = Path(__file__).resolve().parents[1]
NIGHT_BRIGHTNESS_SAFE_CAP = 150


def _is_u8(v: Any) -> bool:
    return isinstance(v, int) and 0 <= v <= 255


def _is_bool(v: Any) -> bool:
    return isinstance(v, bool)


def _is_str(v: Any) -> bool:
    return isinstance(v, str)


def _is_int_in(v: Any, min_v: int, max_v: int) -> bool:
    return isinstance(v, int) and min_v <= v <= max_v


def validate_compact_config(cfg: Any) -> list[str]:
    errors: list[str] = []
    if not isinstance(cfg, dict):
        return ["root must be an object"]

    required = ("c", "n", "z", "k", "o", "l", "m", "w", "t", "g")
    for key in required:
        if key not in cfg:
            errors.append(f"missing key: {key}")

    c = cfg.get("c")
    if not isinstance(c, dict):
        errors.append("c must be object")
    else:
        for mode in ("d", "n"):
            cm = c.get(mode)
            if not isinstance(cm, dict):
                errors.append(f"c.{mode} must be object")
                continue
            for key in ("a", "c"):
                arr = cm.get(key)
                if not (isinstance(arr, list) and len(arr) == 4 and all(_is_u8(x) for x in arr)):
                    errors.append(f"c.{mode}.{key} must be [u8,u8,u8,u8]")

    n = cfg.get("n")
    if not isinstance(n, dict):
        errors.append("n must be object")
    else:
        if not _is_bool(n.get("e")):
            errors.append("n.e must be bool")
        for key in ("s", "x"):
            tm = n.get(key)
            ok = isinstance(tm, list) and len(tm) == 2 and _is_int_in(tm[0], 0, 23) and _is_int_in(tm[1], 0, 59)
            if not ok:
                errors.append(f"n.{key} must be [hour, minute]")
        if not _is_int_in(n.get("b"), 0, NIGHT_BRIGHTNESS_SAFE_CAP):
            errors.append(f"n.b must be 0..{NIGHT_BRIGHTNESS_SAFE_CAP}")
        p = n.get("p")
        if not (isinstance(p, list) and len(p) == 2 and all(_is_bool(x) for x in p)):
            errors.append("n.p must be [bool, bool]")

    z = cfg.get("z")
    if not isinstance(z, dict):
        errors.append("z must be object")
    else:
        if not _is_bool(z.get("e")):
            errors.append("z.e must be bool")
        zv = z.get("v")
        if not (isinstance(zv, list) and len(zv) == 2 and all(_is_int_in(x, 0, 100) for x in zv)):
            errors.append("z.v must be [0..100, 0..100]")
        zr = z.get("r")
        if not (isinstance(zr, list) and all(_is_int_in(x, 0, 24) for x in zr)):
            errors.append("z.r must contain region indexes 0..24")

    k = cfg.get("k")
    if not isinstance(k, dict):
        errors.append("k must be object")
    else:
        if not _is_bool(k.get("e")):
            errors.append("k.e must be bool")
        ki = k.get("i")
        if not (isinstance(ki, list) and len(ki) == 2 and all(_is_int_in(x, 0, 100) for x in ki)):
            errors.append("k.i must be [0..100, 0..100]")

    o = cfg.get("o")
    if not isinstance(o, dict):
        errors.append("o must be object")
    else:
        if not _is_int_in(o.get("a"), 5, 600):
            errors.append("o.a must be 5..600")
        if not _is_int_in(o.get("p"), 0, 100):
            errors.append("o.p must be 0..100")
        if not _is_int_in(o.get("d"), 400, 10000):
            errors.append("o.d must be 400..10000")
        if not _is_int_in(o.get("s"), 20, 220):
            errors.append("o.s must be 20..220")
        if not _is_int_in(o.get("c"), 0, 100):
            errors.append("o.c must be 0..100")

    l = cfg.get("l")
    if not (isinstance(l, list) and len(l) == 27 and all(_is_int_in(x, -1, 24) for x in l)):
        errors.append("l must be array of 27 values in -1..24")

    m = cfg.get("m")
    if not isinstance(m, dict):
        errors.append("m must be object")
    else:
        if not _is_str(m.get("h")):
            errors.append("m.h must be string")
        if not _is_int_in(m.get("p"), 1, 65535):
            errors.append("m.p must be 1..65535")
        if not _is_str(m.get("t")):
            errors.append("m.t must be string")
        if not _is_str(m.get("u")):
            errors.append("m.u must be string")
        if not _is_str(m.get("s")):
            errors.append("m.s must be string")

    w = cfg.get("w")
    if not isinstance(w, dict):
        errors.append("w must be object")
    else:
        if not _is_str(w.get("s")):
            errors.append("w.s must be string")
        if not _is_str(w.get("p")):
            errors.append("w.p must be string")

    t = cfg.get("t")
    if not (isinstance(t, list) and len(t) == 3 and all(_is_str(x) for x in t)):
        errors.append("t must be [string, string, string]")

    g = cfg.get("g")
    if not _is_int_in(g, 0, 65535):
        errors.append("g must be 0..65535")

    cv = cfg.get("cv")
    if cv is not None and not _is_int_in(cv, 1, 255):
        errors.append("cv must be 1..255 if present")

    return errors


def main() -> int:
    schema_path = PROJECT_DIR / "config.schema.json"
    if not schema_path.is_file():
        print("[FAIL] config.schema.json not found")
        return 1

    targets = [PROJECT_DIR / "work_data" / "config.example.json"]
    local_config = PROJECT_DIR / "work_data" / "config.json"
    if local_config.is_file():
        targets.append(local_config)

    failed = False
    for path in targets:
        try:
            cfg = json.loads(path.read_text(encoding="utf-8"))
        except Exception as exc:
            failed = True
            print(f"[FAIL] {path}: invalid JSON ({exc})")
            continue

        errors = validate_compact_config(cfg)
        if errors:
            failed = True
            print(f"[FAIL] {path}")
            for err in errors:
                print(f"  - {err}")
        else:
            print(f"[OK]   {path}")

    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
