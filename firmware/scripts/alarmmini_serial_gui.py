import json
import queue
import threading
import time
from pathlib import Path
import tkinter as tk
from tkinter import filedialog, messagebox, ttk

import serial
from serial.tools import list_ports


APP_TITLE = "AlarmMini Serial Control"
BAUDRATE = 115200
PROFILES_PATH = Path("work_data") / "serial_profiles.json"


class SerialWorker:
    def __init__(self):
        self.ser = None
        self.reader_thread = None
        self.stop_event = threading.Event()
        self.rx_queue = queue.Queue()

    def is_open(self):
        return self.ser is not None and self.ser.is_open

    def open(self, port: str, baudrate: int = BAUDRATE):
        self.close()
        self.ser = serial.Serial(port, baudrate=baudrate, timeout=0.15, write_timeout=1)
        self.stop_event.clear()
        self.reader_thread = threading.Thread(target=self._reader_loop, daemon=True)
        self.reader_thread.start()

    def close(self):
        self.stop_event.set()
        if self.reader_thread and self.reader_thread.is_alive():
            self.reader_thread.join(timeout=0.6)
        self.reader_thread = None
        if self.ser:
            try:
                self.ser.close()
            except Exception:
                pass
        self.ser = None

    def send_line(self, line: str):
        if not self.is_open():
            raise RuntimeError("Serial port is not open")
        payload = (line.strip() + "\n").encode("utf-8")
        self.ser.write(payload)
        self.ser.flush()

    def _reader_loop(self):
        buf = b""
        while not self.stop_event.is_set():
            if not self.is_open():
                break
            try:
                chunk = self.ser.read(2048)
            except Exception as exc:
                self.rx_queue.put({"type": "error", "text": f"Serial read error: {exc}"})
                break

            if not chunk:
                time.sleep(0.02)
                continue

            buf += chunk
            while b"\n" in buf:
                raw, buf = buf.split(b"\n", 1)
                text = raw.decode("utf-8", errors="replace").strip("\r\n ")
                if text:
                    self.rx_queue.put({"type": "line", "text": text})


class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title(APP_TITLE)
        self.geometry("1380x840")
        self.minsize(1180, 740)

        self.worker = SerialWorker()
        self.last_config_json = None
        self.last_info_json = None

        self.port_var = tk.StringVar()
        self.status_var = tk.StringVar(value="Disconnected")
        self.profile_name_var = tk.StringVar()
        self.wifi_ssid_var = tk.StringVar()
        self.wifi_pass_var = tk.StringVar()

        self.info_keys = [
            ("fw", "FW"),
            ("ip", "IP"),
            ("mdns", "mDNS"),
            ("hostname", "Hostname"),
            ("adminPassword", "Admin Password"),
            ("resetReason", "Reset Reason"),
            ("bootCount", "Boot Count"),
        ]
        self.info_vars = {key: tk.StringVar(value="-") for key, _ in self.info_keys}

        self._setup_style()
        self._build_ui()
        self._load_profiles()
        self.refresh_ports()
        self.after(80, self._poll_serial_queue)

    def _setup_style(self):
        style = ttk.Style(self)
        try:
            style.theme_use("clam")
        except Exception:
            pass

        bg = "#eef2f7"
        panel = "#f8fafc"
        self.configure(bg=bg)

        style.configure("Root.TFrame", background=bg)
        style.configure("Card.TLabelframe", background=panel)
        style.configure("Card.TLabelframe.Label", background=panel, foreground="#1f2937", font=("Segoe UI", 10, "bold"))
        style.configure("Panel.TFrame", background=panel)
        style.configure("TLabel", background=bg, foreground="#1f2937", font=("Segoe UI", 10))
        style.configure("CardLabel.TLabel", background=panel, foreground="#334155", font=("Segoe UI", 9))
        style.configure("Value.TEntry", fieldbackground="#ffffff")
        style.configure("Accent.TButton", font=("Segoe UI", 9, "bold"))

    def _build_ui(self):
        self.columnconfigure(0, weight=1)
        self.rowconfigure(2, weight=1)

        top = ttk.Frame(self, padding=10, style="Root.TFrame")
        top.grid(row=0, column=0, sticky="ew")
        top.columnconfigure(9, weight=1)

        ttk.Label(top, text="COM:").grid(row=0, column=0, padx=(0, 6))
        self.port_combo = ttk.Combobox(top, textvariable=self.port_var, state="readonly", width=18)
        self.port_combo.grid(row=0, column=1, padx=(0, 8))
        ttk.Button(top, text="Refresh", command=self.refresh_ports).grid(row=0, column=2, padx=(0, 10))
        ttk.Button(top, text="Connect", command=self.connect, style="Accent.TButton").grid(row=0, column=3, padx=(0, 6))
        ttk.Button(top, text="Disconnect", command=self.disconnect).grid(row=0, column=4, padx=(0, 12))
        ttk.Button(top, text="get:info", command=self.cmd_get_info).grid(row=0, column=5, padx=(0, 6))
        ttk.Button(top, text="get:config", command=self.cmd_get_config).grid(row=0, column=6, padx=(0, 6))
        ttk.Button(top, text="set:config", command=self.cmd_set_config).grid(row=0, column=7, padx=(0, 6))
        ttk.Button(top, text="set:wifi", command=self.cmd_set_wifi).grid(row=0, column=8, padx=(0, 6))

        status = ttk.Frame(self, padding=(10, 0, 10, 8), style="Root.TFrame")
        status.grid(row=1, column=0, sticky="ew")
        status.columnconfigure(1, weight=1)
        ttk.Label(status, text="Status:").grid(row=0, column=0, sticky="w")
        ttk.Label(status, textvariable=self.status_var).grid(row=0, column=1, sticky="w")

        main = ttk.PanedWindow(self, orient=tk.HORIZONTAL)
        main.grid(row=2, column=0, sticky="nsew", padx=10, pady=(0, 10))

        left = ttk.Frame(main, padding=8, style="Root.TFrame")
        right = ttk.Frame(main, padding=8, style="Root.TFrame")
        main.add(left, weight=6)
        main.add(right, weight=5)

        self._build_left_panel(left)
        self._build_right_panel(right)

        bottom = ttk.Frame(self, padding=(10, 0, 10, 10), style="Root.TFrame")
        bottom.grid(row=3, column=0, sticky="ew")
        bottom.columnconfigure(1, weight=1)
        ttk.Label(bottom, text="Raw command:").grid(row=0, column=0, padx=(0, 6))
        self.raw_entry = ttk.Entry(bottom)
        self.raw_entry.grid(row=0, column=1, sticky="ew")
        self.raw_entry.bind("<Return>", lambda _: self.send_raw())
        ttk.Button(bottom, text="Send", command=self.send_raw, style="Accent.TButton").grid(row=0, column=2, padx=(6, 0))

        self.protocol("WM_DELETE_WINDOW", self.on_close)

    def _build_left_panel(self, parent):
        parent.columnconfigure(0, weight=1)
        parent.rowconfigure(0, weight=1)

        cfg_card = ttk.LabelFrame(parent, text="JSON Config Editor", style="Card.TLabelframe", padding=8)
        cfg_card.grid(row=0, column=0, sticky="nsew")
        cfg_card.columnconfigure(0, weight=1)
        cfg_card.rowconfigure(0, weight=1)

        self.config_text = tk.Text(cfg_card, wrap="none", font=("Consolas", 10), bg="#ffffff", fg="#111827", insertbackground="#111827")
        self.config_text.grid(row=0, column=0, sticky="nsew")

        text_btns = ttk.Frame(cfg_card, style="Panel.TFrame")
        text_btns.grid(row=1, column=0, sticky="ew", pady=(8, 0))
        text_btns.columnconfigure(6, weight=1)

        ttk.Button(text_btns, text="Format", command=self.format_editor_json).grid(row=0, column=0, padx=(0, 6))
        ttk.Button(text_btns, text="Minify", command=self.minify_editor_json).grid(row=0, column=1, padx=(0, 6))
        ttk.Button(text_btns, text="Load File", command=self.load_config_file).grid(row=0, column=2, padx=(0, 6))
        ttk.Button(text_btns, text="Save File", command=self.save_config_file).grid(row=0, column=3, padx=(0, 6))
        ttk.Button(text_btns, text="From get:config", command=self.copy_last_config_to_editor).grid(row=0, column=4, padx=(0, 6))
        ttk.Button(text_btns, text="Clear", command=lambda: self.config_text.delete("1.0", tk.END)).grid(row=0, column=5)

    def _build_right_panel(self, parent):
        parent.columnconfigure(0, weight=1)
        parent.rowconfigure(3, weight=1)
        parent.rowconfigure(4, weight=1)

        info_card = ttk.LabelFrame(parent, text="Device Info", style="Card.TLabelframe", padding=8)
        info_card.grid(row=0, column=0, sticky="ew", pady=(0, 8))
        info_card.columnconfigure(1, weight=1)

        for row, (key, label) in enumerate(self.info_keys):
            ttk.Label(info_card, text=label + ":", style="CardLabel.TLabel").grid(row=row, column=0, sticky="w", padx=(0, 8), pady=2)
            entry = ttk.Entry(info_card, textvariable=self.info_vars[key], state="readonly", style="Value.TEntry")
            entry.grid(row=row, column=1, sticky="ew", pady=2)
            ttk.Button(info_card, text="Copy", width=6, command=lambda k=key: self.copy_info_value(k)).grid(row=row, column=2, padx=(6, 0), pady=2)

        ttk.Button(info_card, text="Copy all", command=self.copy_all_info).grid(row=len(self.info_keys), column=2, padx=(6, 0), pady=(8, 0), sticky="e")

        wifi_card = ttk.LabelFrame(parent, text="Wi-Fi", style="Card.TLabelframe", padding=8)
        wifi_card.grid(row=1, column=0, sticky="ew", pady=(0, 8))
        wifi_card.columnconfigure(1, weight=1)
        ttk.Label(wifi_card, text="SSID:", style="CardLabel.TLabel").grid(row=0, column=0, sticky="w", padx=(0, 8))
        ttk.Entry(wifi_card, textvariable=self.wifi_ssid_var).grid(row=0, column=1, sticky="ew")
        ttk.Label(wifi_card, text="Password:", style="CardLabel.TLabel").grid(row=1, column=0, sticky="w", padx=(0, 8), pady=(6, 0))
        ttk.Entry(wifi_card, textvariable=self.wifi_pass_var, show="*").grid(row=1, column=1, sticky="ew", pady=(6, 0))

        profiles_card = ttk.LabelFrame(parent, text="Profiles (CRUD)", style="Card.TLabelframe", padding=8)
        profiles_card.grid(row=2, column=0, sticky="nsew", pady=(0, 8))
        profiles_card.columnconfigure(0, weight=1)
        profiles_card.rowconfigure(1, weight=1)

        name_row = ttk.Frame(profiles_card, style="Panel.TFrame")
        name_row.grid(row=0, column=0, sticky="ew", pady=(0, 6))
        name_row.columnconfigure(1, weight=1)
        ttk.Label(name_row, text="Name:", style="CardLabel.TLabel").grid(row=0, column=0, padx=(0, 6))
        ttk.Entry(name_row, textvariable=self.profile_name_var).grid(row=0, column=1, sticky="ew")

        self.profile_list = tk.Listbox(profiles_card, height=6, font=("Segoe UI", 10))
        self.profile_list.grid(row=1, column=0, sticky="nsew")
        self.profile_list.bind("<<ListboxSelect>>", self.on_profile_selected)

        crud_row = ttk.Frame(profiles_card, style="Panel.TFrame")
        crud_row.grid(row=2, column=0, sticky="ew", pady=(6, 0))
        ttk.Button(crud_row, text="Create", command=self.profile_create).grid(row=0, column=0, padx=(0, 6))
        ttk.Button(crud_row, text="Read", command=self.profile_read).grid(row=0, column=1, padx=(0, 6))
        ttk.Button(crud_row, text="Update", command=self.profile_update).grid(row=0, column=2, padx=(0, 6))
        ttk.Button(crud_row, text="Delete", command=self.profile_delete).grid(row=0, column=3)

        log_card = ttk.LabelFrame(parent, text="Serial JSON Log", style="Card.TLabelframe", padding=8)
        log_card.grid(row=3, column=0, sticky="nsew")
        log_card.columnconfigure(0, weight=1)
        log_card.rowconfigure(0, weight=1)

        self.log_text = tk.Text(log_card, wrap="word", font=("Consolas", 10), bg="#ffffff", fg="#111827", state="disabled")
        self.log_text.grid(row=0, column=0, sticky="nsew")

    def refresh_ports(self):
        ports = [p.device for p in list_ports.comports()]
        self.port_combo["values"] = ports
        if ports and (self.port_var.get() not in ports):
            self.port_var.set(ports[0])
        if not ports:
            self.port_var.set("")

    def connect(self):
        port = self.port_var.get().strip()
        if not port:
            messagebox.showwarning(APP_TITLE, "Select a COM port first.")
            return
        try:
            self.worker.open(port, BAUDRATE)
        except Exception as exc:
            messagebox.showerror(APP_TITLE, f"Failed to connect: {exc}")
            return
        self.status_var.set(f"Connected: {port} @ {BAUDRATE}")
        self.log_line({"event": "ui", "message": f"connected {port}"})

    def disconnect(self):
        self.worker.close()
        self.status_var.set("Disconnected")
        self.log_line({"event": "ui", "message": "disconnected"})

    def send_raw(self):
        cmd = self.raw_entry.get().strip()
        if not cmd:
            return
        self._send_command(cmd)

    def cmd_get_info(self):
        self._send_command("get:info")

    def cmd_get_config(self):
        self._send_command("get:config")

    def cmd_set_config(self):
        payload = self._editor_json_minified()
        if payload is None:
            return
        self._send_command("set:config " + payload)

    def cmd_set_wifi(self):
        ssid = self.wifi_ssid_var.get().strip()
        password = self.wifi_pass_var.get()
        if not ssid:
            messagebox.showwarning(APP_TITLE, "SSID must not be empty.")
            return
        payload = json.dumps({"ssid": ssid, "password": password}, ensure_ascii=False)
        self._send_command("set:wifi " + payload)

    def _send_command(self, cmd: str):
        if not self.worker.is_open():
            messagebox.showwarning(APP_TITLE, "Connect to COM first.")
            return
        try:
            self.worker.send_line(cmd)
        except Exception as exc:
            messagebox.showerror(APP_TITLE, f"Send failed: {exc}")
            return
        self.log_line({"tx": cmd})

    def _poll_serial_queue(self):
        try:
            while True:
                item = self.worker.rx_queue.get_nowait()
                if item["type"] == "error":
                    self.log_line({"error": item["text"]})
                else:
                    self._handle_rx_line(item["text"])
        except queue.Empty:
            pass
        self.after(80, self._poll_serial_queue)

    def _handle_rx_line(self, line: str):
        try:
            obj = json.loads(line)
        except Exception:
            self.log_line({"rx_raw": line})
            return

        event = obj.get("event")
        if event == "config" and isinstance(obj.get("config"), dict):
            self.last_config_json = obj["config"]
        if event == "device_info":
            self.last_info_json = obj
            self._update_info_fields(obj)
            self._fill_info_to_wifi_if_empty(obj)

        self.log_line(obj)

    def _update_info_fields(self, info_obj):
        for key, _label in self.info_keys:
            value = info_obj.get(key, "-")
            if value is None or value == "":
                value = "-"
            self.info_vars[key].set(str(value))

    def copy_info_value(self, key):
        value = self.info_vars.get(key)
        if value is None:
            return
        self.clipboard_clear()
        self.clipboard_append(value.get())
        self.log_line({"event": "ui", "message": f"copied {key}"})

    def copy_all_info(self):
        payload = {key: self.info_vars[key].get() for key, _ in self.info_keys}
        self.clipboard_clear()
        self.clipboard_append(json.dumps(payload, ensure_ascii=False, indent=2))
        self.log_line({"event": "ui", "message": "copied all device info"})

    def _fill_info_to_wifi_if_empty(self, _info_obj):
        cfg = self.last_config_json
        if not isinstance(cfg, dict):
            return
        wifi = cfg.get("w")
        if isinstance(wifi, dict) and not self.wifi_ssid_var.get().strip():
            self.wifi_ssid_var.set(str(wifi.get("s", "")))

    def _editor_json_obj(self):
        text = self.config_text.get("1.0", tk.END).strip()
        if not text:
            messagebox.showwarning(APP_TITLE, "JSON editor is empty.")
            return None
        try:
            obj = json.loads(text)
        except Exception as exc:
            messagebox.showerror(APP_TITLE, f"Invalid JSON: {exc}")
            return None
        if not isinstance(obj, dict):
            messagebox.showerror(APP_TITLE, "Root JSON value must be an object.")
            return None
        return obj

    def _editor_json_minified(self):
        obj = self._editor_json_obj()
        if obj is None:
            return None
        return json.dumps(obj, ensure_ascii=False, separators=(",", ":"))

    def format_editor_json(self):
        obj = self._editor_json_obj()
        if obj is None:
            return
        self.config_text.delete("1.0", tk.END)
        self.config_text.insert("1.0", json.dumps(obj, ensure_ascii=False, indent=2))

    def minify_editor_json(self):
        payload = self._editor_json_minified()
        if payload is None:
            return
        self.config_text.delete("1.0", tk.END)
        self.config_text.insert("1.0", payload)

    def copy_last_config_to_editor(self):
        if not isinstance(self.last_config_json, dict):
            messagebox.showwarning(APP_TITLE, "Run get:config first.")
            return
        self.config_text.delete("1.0", tk.END)
        self.config_text.insert("1.0", json.dumps(self.last_config_json, ensure_ascii=False, indent=2))

    def load_config_file(self):
        path = filedialog.askopenfilename(
            title="Load JSON config",
            filetypes=[("JSON", "*.json"), ("All files", "*.*")],
        )
        if not path:
            return
        try:
            text = Path(path).read_text(encoding="utf-8")
            obj = json.loads(text)
        except Exception as exc:
            messagebox.showerror(APP_TITLE, f"Failed to read file: {exc}")
            return
        self.config_text.delete("1.0", tk.END)
        self.config_text.insert("1.0", json.dumps(obj, ensure_ascii=False, indent=2))

    def save_config_file(self):
        obj = self._editor_json_obj()
        if obj is None:
            return
        path = filedialog.asksaveasfilename(
            title="Save JSON config",
            defaultextension=".json",
            filetypes=[("JSON", "*.json"), ("All files", "*.*")],
        )
        if not path:
            return
        try:
            Path(path).write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")
        except Exception as exc:
            messagebox.showerror(APP_TITLE, f"Failed to save file: {exc}")
            return
        self.log_line({"event": "ui", "message": f"config saved: {path}"})

    def _load_profiles(self):
        self.profiles = {}
        if PROFILES_PATH.exists():
            try:
                raw = json.loads(PROFILES_PATH.read_text(encoding="utf-8"))
                if isinstance(raw, dict):
                    self.profiles = raw
            except Exception:
                self.profiles = {}
        self._refresh_profile_list()

    def _save_profiles(self):
        PROFILES_PATH.parent.mkdir(parents=True, exist_ok=True)
        PROFILES_PATH.write_text(json.dumps(self.profiles, ensure_ascii=False, indent=2), encoding="utf-8")

    def _refresh_profile_list(self):
        names = sorted(self.profiles.keys())
        self.profile_list.delete(0, tk.END)
        for name in names:
            self.profile_list.insert(tk.END, name)

    def _selected_profile_name(self):
        sel = self.profile_list.curselection()
        if not sel:
            return None
        return self.profile_list.get(sel[0])

    def on_profile_selected(self, _event=None):
        name = self._selected_profile_name()
        if name:
            self.profile_name_var.set(name)

    def profile_create(self):
        name = self.profile_name_var.get().strip()
        if not name:
            messagebox.showwarning(APP_TITLE, "Profile name is required.")
            return
        if name in self.profiles:
            messagebox.showwarning(APP_TITLE, "Profile already exists.")
            return
        obj = self._editor_json_obj()
        if obj is None:
            return
        self.profiles[name] = obj
        self._save_profiles()
        self._refresh_profile_list()
        self.log_line({"event": "profile", "op": "create", "name": name})

    def profile_read(self):
        name = self._selected_profile_name() or self.profile_name_var.get().strip()
        if not name or name not in self.profiles:
            messagebox.showwarning(APP_TITLE, "Select an existing profile.")
            return
        self.profile_name_var.set(name)
        self.config_text.delete("1.0", tk.END)
        self.config_text.insert("1.0", json.dumps(self.profiles[name], ensure_ascii=False, indent=2))
        self.log_line({"event": "profile", "op": "read", "name": name})

    def profile_update(self):
        name = self._selected_profile_name() or self.profile_name_var.get().strip()
        if not name or name not in self.profiles:
            messagebox.showwarning(APP_TITLE, "Select an existing profile.")
            return
        obj = self._editor_json_obj()
        if obj is None:
            return
        self.profiles[name] = obj
        self._save_profiles()
        self._refresh_profile_list()
        self.log_line({"event": "profile", "op": "update", "name": name})

    def profile_delete(self):
        name = self._selected_profile_name() or self.profile_name_var.get().strip()
        if not name or name not in self.profiles:
            messagebox.showwarning(APP_TITLE, "Select an existing profile.")
            return
        if not messagebox.askyesno(APP_TITLE, f"Delete profile '{name}'?"):
            return
        del self.profiles[name]
        self._save_profiles()
        self._refresh_profile_list()
        self.profile_name_var.set("")
        self.log_line({"event": "profile", "op": "delete", "name": name})

    def log_line(self, obj):
        if isinstance(obj, str):
            text = obj
        else:
            try:
                text = json.dumps(obj, ensure_ascii=False)
            except Exception:
                text = str(obj)
        self.log_text.configure(state="normal")
        self.log_text.insert(tk.END, text + "\n")
        self.log_text.see(tk.END)
        self.log_text.configure(state="disabled")

    def on_close(self):
        try:
            self.worker.close()
        finally:
            self.destroy()


if __name__ == "__main__":
    app = App()
    app.mainloop()
