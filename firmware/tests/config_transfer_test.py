"""Maximum-palette backups through the real USB utility and preserve helpers."""
import ast
import json
import sys
import time
from pathlib import Path
from types import SimpleNamespace

firmware = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(firmware / "scripts"))
import config_preserve_flash as preserve
from validate_config_contract import validate_compact_config

# Load the production App methods without a display or a tkinter installation.
gui_source = ast.parse((firmware / "scripts/alarmmini_serial_gui.py").read_text(encoding="utf-8-sig"))
app_class = next(node for node in gui_source.body if isinstance(node, ast.ClassDef) and node.name == "App")
errors = []
namespace = {"tk": SimpleNamespace(Tk=object), "json": json, "time": time,
             "APP_TITLE": "Test", "_collect_diffs": preserve._collect_diffs,
             "messagebox": SimpleNamespace(showerror=lambda *args: errors.append(args), showwarning=lambda *args: errors.append(args))}
exec(compile(ast.Module(body=[app_class], type_ignores=[]), "alarmmini_serial_gui.py", "exec"), namespace)

cfg = json.loads((firmware / "work_data/config.example.json").read_text(encoding="utf-8"))
cfg["sc"] = {str(i): [255, i, 4, 255, 5, 6, i, 24] for i in range(240, 256)}
cfg["fu"] = "https://reserve.example/" + "x" * 220
cfg["ft"] = "x" * 511
cfg["w"] = {"s": "Моя мережа", "p": "p" * 63}
cfg["t"] = ["n" * 63] * 3
raw = json.dumps(cfg, ensure_ascii=False, separators=(",", ":"))
assert len(raw.encode("utf-8")) > 2048  # Previously exceeded the GUI's single UART line.
assert not validate_compact_config(cfg)
assert not validate_compact_config({**cfg, "z": {"e": True, "v": [80, 30], "r": [20]}})
assert validate_compact_config({**cfg, "sc": {"02": [0] * 8}})

class Device:
    def __init__(self):
        self.config = {}
        self.lines = []
        self.responses = []
        self.received = b""
    def is_open(self): return True
    def __enter__(self): return self
    def __exit__(self, *args): pass
    def flush(self): pass
    def write(self, raw): self.send_line(raw.decode("utf-8").strip())
    def readline(self): return (json.dumps(self.responses.pop(0)) + "\n").encode()
    def send_line(self, line):
        assert len(line.encode("utf-8")) < 2048
        self.lines.append(line)
        if line == "get:config":
            self.responses.append({"event": "config", "config": self.config})
            return
        if line == "cmd=set_begin": self.received = b""; cmd = "set_begin"
        elif line.startswith("data="): self.received += bytes.fromhex(line[5:]); cmd = "set_data"
        elif line == "cmd=set_end": self.config = json.loads(self.received); cmd = "set_end"
        else: raise AssertionError(line)
        self.responses.append({"status": "ACK", "cmd": cmd})

class Harness:
    def __init__(self):
        self.worker = Device()
        self.config_upload = self.config_upload_expected = None
        self.last_config_json = None
        self.logs = []
    def _editor_json_minified(self): return raw
    def log_line(self, obj): self.logs.append(obj)
for name in ("cmd_set_config", "_advance_config_upload", "_send_command", "_fail_config_upload", "_handle_rx_line"):
    setattr(Harness, name, getattr(namespace["App"], name))
app = Harness()
app.cmd_set_config()
assert app.worker.lines == ["cmd=set_begin"]  # No data sent before ACK.
while app.worker.responses:
    app._handle_rx_line(json.dumps(app.worker.responses.pop(0)))
assert not errors and app.config_upload_expected is None
assert app.last_config_json == cfg and app.worker.config == cfg
assert app.worker.lines[-1] == "get:config"
assert any(log.get("message") == "Config saved and verified" for log in app.logs)
app.cmd_set_config()
app._handle_rx_line(json.dumps({"status": "NACK", "cmd": "set_begin", "reason": "busy"}))
assert errors and app.config_upload is None and app.config_upload_expected is None

device = Device()
preserve._open_serial = lambda *args, **kwargs: device
preserve.restore_config("fake", cfg)
assert preserve.backup_config("fake") == cfg
preserve.verify_restored_config("fake", cfg)
legacy = {key: value for key, value in cfg.items() if key != "sc"}
assert "$.sc" in preserve._collect_diffs(legacy, cfg)
preserve.restore_config("fake", legacy)
preserve.verify_restored_config("fake", legacy)
assert "sc" not in device.config
print("PASS config transfers: >2048-byte UTF-8 palette, ACK chunks, readback, NACK stop, preserve backup/restore, old-config palette removal")
