#!/usr/bin/env python3
"""
XP Flight Computer - X-Plane 12 bridge and local web server.

Reads the aircraft and flight state from X-Plane 12 and serves the flight-computer web app.
Standard library only (Python 3.8+). Two ways to talk to X-Plane, chosen automatically:

  * X-Plane Web API (12.1.1+, localhost only, port 8086) - works out of the box.
  * UDP "RREF" (any X-Plane, same PC or LAN, port 49000) - needs
    Settings > Network > "Accept incoming connections" in X-Plane 12.

Run:  python xpfc.py            then open http://127.0.0.1:8765
      python xpfc.py --lan      to use a phone/tablet on the same network
      python xpfc.py --help     for all options
"""
import argparse
import base64
import json
import math
import os
import socket
import struct
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

APP = "XP Flight Computer"
VERSION = "1.0.0"

try:  # Windows consoles may not be UTF-8; never crash on a print
    sys.stdout.reconfigure(errors="replace")
    sys.stderr.reconfigure(errors="replace")
except Exception:
    pass


def app_dir():
    """Folder of the .exe (frozen) or of this script - where config and user files live."""
    if getattr(sys, "frozen", False):
        return os.path.dirname(sys.executable)
    return os.path.dirname(os.path.abspath(__file__))


def res_dir():
    """Folder holding bundled resources (PyInstaller unpacks to _MEIPASS)."""
    return getattr(sys, "_MEIPASS", app_dir())


WEB_ROOT = os.path.join(res_dir(), "web")
WEB = None          # the Web API source, once started (UDP stands by while it is live)
CONFIG_PATH = os.path.join(app_dir(), "xpfc_config.json")
PROFILES_PATH = os.path.join(app_dir(), "user_profiles.json")
DEBUG = False


def log(*a):
    print(time.strftime("[%H:%M:%S]"), *a, flush=True)


def dbg(*a):
    if DEBUG:
        log("debug:", *a)


# --------------------------------------------------------------------------- datarefs
# (key, dataref, kind, n)   kind: f float | i int | d double | s string(n bytes) | a array element n
#                                 sum (sum of first n elements) | list (first n elements)
SLOW = [
    ("icao", "sim/aircraft/view/acf_ICAO", "s", 8),
    ("desc", "sim/aircraft/view/acf_descrip", "s", 64),
    ("tail", "sim/aircraft/view/acf_tailnum", "s", 12),
    ("author", "sim/aircraft/view/acf_author", "s", 32),
    ("engines", "sim/aircraft/engine/acf_num_engines", "i", None),
    ("engType", "sim/aircraft/prop/acf_en_type", "a", 0),
    ("oew", "sim/aircraft/weight/acf_m_empty", "f", None),
    ("mtow", "sim/aircraft/weight/acf_m_max", "f", None),
    ("maxFuel", "sim/aircraft/weight/acf_m_fuel_tot", "f", None),
    ("vso", "sim/aircraft/view/acf_Vso", "f", None),
    ("vs", "sim/aircraft/view/acf_Vs", "f", None),
    ("vfe", "sim/aircraft/view/acf_Vfe", "f", None),
    ("vno", "sim/aircraft/view/acf_Vno", "f", None),
    ("vne", "sim/aircraft/view/acf_Vne", "f", None),
    ("mmo", "sim/aircraft/view/acf_Mmo", "f", None),
    ("vle", "sim/aircraft/overflow/acf_Vle", "f", None),
    ("vmca", "sim/aircraft/overflow/acf_Vmca", "f", None),
    ("vyse", "sim/aircraft/overflow/acf_Vyse", "f", None),
    ("gearRetract", "sim/aircraft/gear/acf_gear_retract", "i", None),
    ("flapDetents", "sim/aircraft/controls/acf_flap_detents", "i", None),
    ("xpBuild", "sim/version/xplane_internal_version", "i", None),
] + [("flag_" + n, "sim/aircraft2/metadata/is_" + n, "i", None) for n in (
    "airliner", "general_aviation", "helicopter", "glider", "military", "cargo",
    "experimental", "ultralight", "seaplane", "vtol", "sci_fi")]

FAST = [
    ("lat", "sim/flightmodel/position/latitude", "d", None),
    ("lon", "sim/flightmodel/position/longitude", "d", None),
    ("elevM", "sim/flightmodel/position/elevation", "d", None),
    ("aglM", "sim/flightmodel/position/y_agl", "f", None),
    ("altInd", "sim/cockpit2/gauges/indicators/altitude_ft_pilot", "f", None),
    ("pa", "sim/flightmodel2/position/pressure_altitude", "d", None),
    ("ias", "sim/cockpit2/gauges/indicators/airspeed_kts_pilot", "f", None),
    ("cas", "sim/cockpit2/gauges/indicators/calibrated_airspeed_kts_pilot", "f", None),
    ("tasMs", "sim/flightmodel/position/true_airspeed", "f", None),
    ("gsMs", "sim/flightmodel/position/groundspeed", "f", None),
    ("mach", "sim/flightmodel/misc/machno", "f", None),
    ("vsFpm", "sim/flightmodel/position/vh_ind_fpm", "f", None),
    ("hdgT", "sim/flightmodel/position/psi", "f", None),
    ("hdgM", "sim/flightmodel/position/mag_psi", "f", None),
    ("trkT", "sim/flightmodel/position/hpath", "f", None),
    ("pitch", "sim/flightmodel/position/theta", "f", None),
    ("roll", "sim/flightmodel/position/phi", "f", None),
    ("aoa", "sim/flightmodel2/position/alpha", "f", None),
    ("oat", "sim/weather/aircraft/temperature_ambient_deg_c", "f", None),
    ("oat2", "sim/cockpit2/temperature/outside_air_temp_degc", "f", None),
    ("tat", "sim/weather/aircraft/temperature_leadingedge_deg_c", "f", None),
    ("tat2", "sim/cockpit2/temperature/outside_air_LE_temp_degc", "f", None),
    ("qnhPa", "sim/weather/aircraft/qnh_pas", "f", None),
    ("qnhInHg", "sim/weather/barometer_sealevel_inhg", "f", None),
    ("pStaticPa", "sim/weather/aircraft/barometer_current_pas", "f", None),
    ("baroInHg", "sim/cockpit2/gauges/actuators/barometer_setting_in_hg_pilot", "f", None),
    ("windDirT", "sim/weather/aircraft/wind_now_direction_degt", "f", None),
    ("windMs", "sim/weather/aircraft/wind_now_speed_msc", "f", None),
    ("windDirM2", "sim/cockpit2/gauges/indicators/wind_heading_deg_mag", "f", None),
    ("windKt2", "sim/cockpit2/gauges/indicators/wind_speed_kts", "f", None),
    ("rho", "sim/weather/rho", "f", None),
    ("altTempErr", "sim/weather/aircraft/altimeter_temperature_error", "f", None),
    ("visSm", "sim/weather/aircraft/visibility_reported_sm", "f", None),
    ("rwyFriction", "sim/weather/region/runway_friction", "f", None),
    ("mass", "sim/flightmodel/weight/m_total", "f", None),
    ("fuel", "sim/flightmodel/weight/m_fuel_total", "f", None),
    ("payload", "sim/flightmodel/weight/m_fixed", "f", None),
    ("ffKgs", "sim/cockpit2/engine/indicators/fuel_flow_kg_sec", "sum", 8),
    ("n1", "sim/cockpit2/engine/indicators/N1_percent", "list", 4),
    ("flapReq", "sim/cockpit2/controls/flap_handle_request_ratio", "f", None),
    ("flapDep", "sim/cockpit2/controls/flap_handle_deploy_ratio", "f", None),
    ("gearDown", "sim/cockpit2/controls/gear_handle_down", "i", None),
    ("onGround", "sim/flightmodel/failures/onground_any", "i", None),
    ("paused", "sim/time/paused", "i", None),
    ("zulu", "sim/time/zulu_time_sec", "f", None),
    ("gpsDist", "sim/cockpit2/radios/indicators/gps_dme_distance_nm", "f", None),
    ("gpsBrgM", "sim/cockpit2/radios/indicators/gps_bearing_deg_mag", "f", None),
    ("todDist", "sim/cockpit2/radios/indicators/fms_distance_to_tod_pilot", "f", None),
    ("landingAlt", "sim/cockpit2/radios/indicators/landing_alt_pilot", "f", None),
]
CATALOG = [(k, p, kind, n, 1) for (k, p, kind, n) in SLOW] + [(k, p, kind, n, 5) for (k, p, kind, n) in FAST]


def decode_text(raw):
    if isinstance(raw, (bytes, bytearray)):
        raw = bytes(raw).split(b"\0", 1)[0]
        try:
            return raw.decode("utf-8").strip()
        except UnicodeDecodeError:
            return raw.decode("latin-1", "replace").strip()
    return str(raw or "").strip()


# ------------------------------------------------------------------------- config
DEFAULT_CONFIG = {"xpHost": "auto", "udpPort": 49000, "webApiPort": 8086,
                  "useWebApi": True, "useUdp": True, "xpRoot": ""}


class Config:
    def __init__(self):
        self.lock = threading.Lock()
        self.data = dict(DEFAULT_CONFIG)
        try:
            with open(CONFIG_PATH, "r", encoding="utf-8") as fh:
                saved = json.load(fh)
            for k in DEFAULT_CONFIG:
                if k in saved:
                    self.data[k] = saved[k]
        except FileNotFoundError:
            pass
        except Exception as e:
            log("Could not read", CONFIG_PATH, "-", e)

    def get(self, k):
        with self.lock:
            return self.data.get(k)

    def update(self, new, save=True):
        with self.lock:
            for k, v in new.items():
                if k not in DEFAULT_CONFIG:
                    continue
                if k in ("udpPort", "webApiPort"):
                    v = int(v)
                    if not 1 <= v <= 65535:
                        raise ValueError(k + " out of range")
                elif k in ("useWebApi", "useUdp"):
                    v = bool(v)
                else:
                    v = str(v).strip()
                self.data[k] = v
            snapshot = dict(self.data)
        if save:
            try:
                with open(CONFIG_PATH, "w", encoding="utf-8") as fh:
                    json.dump(snapshot, fh, indent=2)
            except Exception as e:
                log("Could not save config:", e)
        return snapshot

    def public(self):
        with self.lock:
            return dict(self.data)


CONFIG = Config()


# ------------------------------------------------------------------ beacon (BECN)
class Beacon(threading.Thread):
    """Listens for X-Plane's multicast beacon to find the sim on this PC or the LAN."""
    GROUP, PORT = "239.255.1.1", 49707

    def __init__(self):
        super().__init__(daemon=True, name="beacon")
        self.found = None
        self.status = "starting"

    def run(self):
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                s.bind(("", self.PORT))
            except OSError:
                s.bind((self.GROUP, self.PORT))
            mreq = struct.pack("4s4s", socket.inet_aton(self.GROUP), socket.inet_aton("0.0.0.0"))
            s.setsockopt(socket.IPPROTO_IP, socket.IP_ADD_MEMBERSHIP, mreq)
            s.settimeout(2.0)
        except OSError as e:
            self.status = "unavailable (%s)" % e
            return
        self.status = "listening"
        while True:
            try:
                data, addr = s.recvfrom(2048)
            except socket.timeout:
                continue
            except OSError:
                time.sleep(1)
                continue
            if data[:5] != b"BECN\0" or len(data) < 21:
                continue
            try:
                major, minor, host_id, version, role, port = struct.unpack_from("<BBiiIH", data, 5)
                name = decode_text(data[21:21 + 500])
            except struct.error:
                continue
            if host_id != 1:        # 1 = X-Plane, 2 = Plane Maker
                continue
            new = {"ip": addr[0], "port": port, "version": version, "role": role, "name": name, "seen": time.time()}
            if not self.found or self.found["ip"] != new["ip"]:
                log("X-Plane beacon: %s at %s:%d (build %d)" % (name or "X-Plane", addr[0], port, version))
            self.found = new

    def recent(self):
        f = self.found
        return f if f and time.time() - f["seen"] < 10 else None


BEACON = Beacon()


def xp_host():
    """Host running X-Plane: config value, else the beacon's IP, else this PC."""
    h = CONFIG.get("xpHost") or "auto"
    if h.lower() != "auto":
        return h
    b = BEACON.recent()
    return b["ip"] if b else "127.0.0.1"


def is_local(host):
    if host in ("127.0.0.1", "localhost", "::1"):
        return True
    try:
        return host in socket.gethostbyname_ex(socket.gethostname())[2]
    except OSError:
        return False


# --------------------------------------------------------------------- UDP (RREF)
class UdpSource(threading.Thread):
    def __init__(self):
        super().__init__(daemon=True, name="udp")
        self.raw = {}
        self.subs = []          # (index, path, freq)
        self.map = {}           # key -> list of indices
        idx = 1
        for key, path, kind, n, freq in CATALOG:
            if kind in ("s", "sum", "list"):
                ids = []
                for i in range(n):
                    self.subs.append((idx, "%s[%d]" % (path, i), freq))
                    ids.append(idx)
                    idx += 1
                self.map[key] = (kind, ids)
            elif kind == "a":
                self.subs.append((idx, "%s[%d]" % (path, n), freq))
                self.map[key] = (kind, [idx])
                idx += 1
            else:
                self.subs.append((idx, path, freq))
                self.map[key] = (kind, [idx])
                idx += 1
        self.target = None
        self.last_rx = 0.0
        self.status = "idle"
        self.lock = threading.Lock()
        self.sock = None
        self.sock_local = None

    def _socket_for(self, host):
        """Loopback-only socket when X-Plane runs on this PC (no firewall prompt), all interfaces otherwise."""
        local = is_local(host)
        if self.sock is not None and self.sock_local == local:
            return
        if self.sock is not None:
            try:
                self.sock.close()
            except OSError:
                pass
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.bind(("127.0.0.1" if local else "0.0.0.0", 0))
        s.settimeout(0.5)
        if hasattr(socket, "SIO_UDP_CONNRESET"):      # Windows: ignore ICMP port-unreachable
            try:
                s.ioctl(socket.SIO_UDP_CONNRESET, False)
            except OSError:
                pass
        self.sock, self.sock_local = s, local

    def _send_all(self, freq_override=None):
        if not self.target or self.sock is None:
            return
        for idx, path, freq in self.subs:
            f = freq if freq_override is None else freq_override
            msg = struct.pack("<4sxii400s", b"RREF", f, idx, path.encode("ascii"))
            try:
                self.sock.sendto(msg, self.target)
            except OSError as e:
                self.status = "send failed: %s" % e
                return

    def stop(self):
        try:
            self._send_all(0)
        except Exception:
            pass

    def fresh(self):
        return time.time() - self.last_rx < 3.0

    def run(self):
        next_sub = 0.0
        while True:
            web_ok = WEB is not None and WEB.connected and (time.time() - WEB.last_rx < 5.0)
            if not CONFIG.get("useUdp") or web_ok:
                if self.target:
                    self._send_all(0)          # stop X-Plane sending UDP we don't need
                    self.target = None
                    self.last_rx = 0.0
                self.status = "off" if not CONFIG.get("useUdp") else "standby (Web API in use)"
                time.sleep(1)
                continue
            target = (xp_host(), int(CONFIG.get("udpPort") or 49000))
            if target != self.target:
                if self.target:
                    self._send_all(0)
                self._socket_for(target[0])
                self.target = target
                next_sub = 0.0
            now = time.time()
            if now >= next_sub and not self.fresh():
                self._send_all()
                next_sub = now + 4.0
                self.status = "requesting data from %s:%d" % target
            try:
                data, addr = self.sock.recvfrom(65535)
            except socket.timeout:
                continue
            except (ConnectionResetError, OSError):
                time.sleep(0.2)
                continue
            if data[:4] != b"RREF" or len(data) < 13:
                continue
            n = (len(data) - 5) // 8
            with self.lock:
                for i in range(n):
                    idx, val = struct.unpack_from("<if", data, 5 + 8 * i)
                    self.raw[idx] = val
            if not self.fresh():
                log("UDP: receiving data from X-Plane at %s:%d" % addr)
            self.last_rx = time.time()
            self.status = "receiving"

    def values(self):
        out = {}
        with self.lock:
            raw = dict(self.raw)
        for key, (kind, ids) in self.map.items():
            vals = [raw.get(i) for i in ids]
            if kind == "s":
                b = bytearray()
                for v in vals:
                    if v is None:
                        break
                    c = int(v)
                    if c <= 0:
                        break
                    b.append(c & 0xFF)
                out[key] = decode_text(b)
            elif kind == "sum":
                present = [v for v in vals if v is not None]
                out[key] = sum(present) if present else None
            elif kind == "list":
                out[key] = [v for v in vals if v is not None]
            else:
                out[key] = vals[0]
        return out


# ------------------------------------------------------------ Web API (WebSocket)
class MiniWebSocket:
    """Minimal RFC 6455 client (text frames, ping/pong, fragmentation) - stdlib only."""

    def __init__(self, host, port, path, timeout=5.0):
        self.sock = socket.create_connection((host, port), timeout=timeout)
        key = base64.b64encode(os.urandom(16)).decode()
        req = ("GET %s HTTP/1.1\r\nHost: %s:%d\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
               "Sec-WebSocket-Key: %s\r\nSec-WebSocket-Version: 13\r\n\r\n") % (path, host, port, key)
        self.sock.sendall(req.encode())
        buf = b""
        while b"\r\n\r\n" not in buf:
            chunk = self.sock.recv(4096)
            if not chunk:
                raise ConnectionError("WebSocket handshake: connection closed")
            buf += chunk
            if len(buf) > 65536:
                raise ConnectionError("WebSocket handshake: header too long")
        head, self.buf = buf.split(b"\r\n\r\n", 1)
        status = head.split(b"\r\n", 1)[0]
        if b" 101" not in status:
            raise ConnectionError("WebSocket handshake refused: %s" % status.decode("latin-1"))

    def _read(self, n, frame_start=False):
        """Read exactly n bytes. A timeout may only escape at the start of a frame (nothing consumed)."""
        deadline = None
        while len(self.buf) < n:
            try:
                chunk = self.sock.recv(max(4096, n - len(self.buf)))
            except socket.timeout:
                if frame_start and not self.buf:
                    raise
                deadline = deadline or time.time() + 10.0
                if time.time() > deadline:
                    raise ConnectionError("WebSocket stalled mid-frame")
                continue
            if not chunk:
                raise ConnectionError("WebSocket closed by X-Plane")
            self.buf += chunk
        out, self.buf = self.buf[:n], self.buf[n:]
        return out

    def _frame(self, opcode, payload):
        head = bytearray([0x80 | opcode])
        n = len(payload)
        if n < 126:
            head.append(0x80 | n)
        elif n < 65536:
            head.append(0x80 | 126)
            head += struct.pack(">H", n)
        else:
            head.append(0x80 | 127)
            head += struct.pack(">Q", n)
        mask = os.urandom(4)
        head += mask
        body = bytes(b ^ mask[i & 3] for i, b in enumerate(payload))
        self.sock.sendall(bytes(head) + body)

    def send_text(self, text):
        self._frame(0x1, text.encode("utf-8"))

    def recv_text(self):
        parts = []
        while True:
            b1, b2 = self._read(2, frame_start=not parts)
            opcode, n = b1 & 0x0F, b2 & 0x7F
            if n == 126:
                n = struct.unpack(">H", self._read(2))[0]
            elif n == 127:
                n = struct.unpack(">Q", self._read(8))[0]
            mask = self._read(4) if b2 & 0x80 else None
            data = self._read(n)
            if mask:
                data = bytes(b ^ mask[i & 3] for i, b in enumerate(data))
            if opcode == 0x9:
                self._frame(0xA, data)
                continue
            if opcode == 0xA:
                continue
            if opcode == 0x8:
                raise ConnectionError("WebSocket closed by X-Plane")
            parts.append(data)
            if b1 & 0x80:
                return b"".join(parts).decode("utf-8", "replace")

    def close(self):
        try:
            self._frame(0x8, b"")
        except Exception:
            pass
        try:
            self.sock.close()
        except Exception:
            pass


def http_json(url, timeout=3.0):
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


class WebApiSource(threading.Thread):
    def __init__(self):
        super().__init__(daemon=True, name="webapi")
        self.connected = False
        self.status = "idle"
        self.version = None
        self.api = None
        self.vals = {}
        self.by_id = {}           # id -> (key, kind, n)
        self.last_rx = 0.0
        self.lock = threading.Lock()
        self.ws = None

    def _resolve(self, base):
        names = sorted({p for (_k, p, _kind, _n, _f) in CATALOG})
        found = {}

        def ask(chunk):
            q = "&".join("filter%5Bname%5D=" + urllib.parse.quote(n, safe="") for n in chunk)
            res = http_json("%s/datarefs?%s" % (base, q))
            for d in res.get("data", []):
                found[d["name"]] = (d["id"], d.get("value_type"))

        for i in range(0, len(names), 25):
            chunk = names[i:i + 25]
            try:
                ask(chunk)
            except urllib.error.HTTPError:
                for n in chunk:              # one bad name must not hide the others
                    try:
                        ask([n])
                    except Exception:
                        dbg("dataref not available:", n)
        return found

    def _connect_once(self, port):
        base_root = "http://127.0.0.1:%d/api" % port
        caps = http_json(base_root + "/capabilities", timeout=2.0)
        versions = caps.get("api", {}).get("versions", []) or ["v1"]
        api = sorted(versions, key=lambda v: int("".join(c for c in v if c.isdigit()) or 0))[-1]
        self.version = caps.get("x-plane", {}).get("version")
        self.api = api
        base = "%s/%s" % (base_root, api)
        found = self._resolve(base)
        subs, by_id = [], {}
        for key, path, kind, n, _freq in CATALOG:
            if path not in found:
                continue
            did, vtype = found[path]
            entry = {"id": did}
            if kind == "a":
                entry["index"] = [n]
            elif kind in ("sum", "list"):
                entry["index"] = list(range(n))
            subs.append(entry)
            by_id[str(did)] = (key, kind, n, vtype)
        if not subs:
            raise ConnectionError("no datarefs found")
        ws = MiniWebSocket("127.0.0.1", port, "/api/" + api)
        ws.sock.settimeout(1.0)
        ws.send_text(json.dumps({"req_id": 1, "type": "dataref_subscribe_values",
                                 "params": {"datarefs": subs}}))
        self.by_id = by_id
        return ws, len(subs)

    def _apply(self, data):
        with self.lock:
            for sid, val in data.items():
                meta = self.by_id.get(str(sid))
                if not meta:
                    continue
                key, kind, n, vtype = meta
                if kind == "s" or vtype == "data":
                    try:
                        self.vals[key] = decode_text(base64.b64decode(val)) if isinstance(val, str) else decode_text(bytes(val))
                    except Exception:
                        self.vals[key] = ""
                elif kind == "sum":
                    self.vals[key] = sum(v for v in (val if isinstance(val, list) else [val]) if v is not None)
                elif kind == "list":
                    self.vals[key] = list(val) if isinstance(val, list) else [val]
                elif kind == "a":
                    self.vals[key] = val[0] if isinstance(val, list) and val else val
                else:
                    self.vals[key] = val[0] if isinstance(val, list) and val else val

    def run(self):
        announced = False
        while True:
            host = xp_host()
            if not CONFIG.get("useWebApi"):
                self.status, self.connected = "off", False
                time.sleep(1)
                continue
            if not is_local(host):
                self.status, self.connected = "X-Plane is on another PC (Web API is local-only)", False
                time.sleep(2)
                continue
            port = int(CONFIG.get("webApiPort") or 8086)
            try:
                ws, n = self._connect_once(port)
            except Exception as e:
                self.connected = False
                self.status = "not available (%s)" % (e.__class__.__name__ if not str(e) else str(e)[:80])
                announced = False
                time.sleep(3)
                continue
            self.ws = ws
            self.connected = True
            self.status = "connected (%s, %d datarefs)" % (self.api, n)
            if not announced:
                log("Web API: connected to X-Plane %s (%s, %d datarefs)" % (self.version or "", self.api, n))
                announced = True
            try:
                while CONFIG.get("useWebApi"):
                    try:
                        msg = ws.recv_text()
                    except socket.timeout:
                        continue
                    m = json.loads(msg)
                    t = m.get("type")
                    if t == "dataref_update_values":
                        self._apply(m.get("data", {}))
                        self.last_rx = time.time()
                    elif t == "result" and not m.get("success", True):
                        log("Web API error:", m.get("error_message") or m)
            except Exception as e:
                log("Web API: connection lost (%s)" % e)
            finally:
                ws.close()
                self.connected = False
                self.ws = None
                with self.lock:
                    self.vals = {}
                time.sleep(2)

    def values(self):
        with self.lock:
            return dict(self.vals)


# ------------------------------------------------------------------ state builder
FLAGS = ("airliner", "general_aviation", "helicopter", "glider", "military", "cargo",
         "experimental", "ultralight", "seaplane", "vtol", "sci_fi")


def _num(x, nd=None):
    if x is None:
        return None
    try:
        x = float(x)
    except (TypeError, ValueError):
        return None
    if math.isnan(x) or math.isinf(x):
        return None
    return round(x, nd) if nd is not None else x


def _pick(a, b):
    """Prefer the X-Plane 12 dataref a, fall back to the older b."""
    if a is None:
        return b
    if a == 0 and b not in (None, 0):
        return b
    return a


def build_state(v, via, web, udp):
    ms_to_kt = 3600.0 / 1852.0
    ac = {
        "icao": v.get("icao") or "", "desc": v.get("desc") or "", "tail": v.get("tail") or "",
        "author": v.get("author") or "",
        "engines": int(v.get("engines") or 0), "engType": int(v["engType"]) if v.get("engType") is not None else -1,
        "mtow": _num(v.get("mtow"), 1), "oew": _num(v.get("oew"), 1), "maxFuel": _num(v.get("maxFuel"), 1),
        "vso": _num(v.get("vso"), 1), "vs": _num(v.get("vs"), 1), "vfe": _num(v.get("vfe"), 1),
        "vno": _num(v.get("vno"), 1), "vne": _num(v.get("vne"), 1), "mmo": _num(v.get("mmo"), 3),
        "vle": _num(v.get("vle"), 1), "vmca": _num(v.get("vmca"), 1), "vyse": _num(v.get("vyse"), 1),
        "gearRetract": bool(v.get("gearRetract")), "flapDetents": int(v.get("flapDetents") or 0),
        "flags": {n: bool(v.get("flag_" + n)) for n in FLAGS},
    }
    hdg_t, hdg_m = _num(v.get("hdgT")), _num(v.get("hdgM"))
    magvar = None
    if hdg_t is not None and hdg_m is not None:
        magvar = ((hdg_t - hdg_m + 540.0) % 360.0) - 180.0
    wind_dir_t, wind_kt = _num(v.get("windDirT")), None
    if v.get("windMs") is not None and wind_dir_t is not None:
        wind_kt = float(v["windMs"]) * ms_to_kt
    elif v.get("windKt2") is not None:
        wind_kt = _num(v.get("windKt2"))
        wdm = _num(v.get("windDirM2"))
        wind_dir_t = (wdm + (magvar or 0.0)) % 360.0 if wdm is not None else None
    qnh = None
    if (v.get("qnhPa") or 0) > 80000:
        qnh = float(v["qnhPa"]) / 100.0
    elif (v.get("qnhInHg") or 0) > 25:
        qnh = float(v["qnhInHg"]) * 33.8638866667
    baro = float(v["baroInHg"]) * 33.8638866667 if (v.get("baroInHg") or 0) > 25 else None
    elev = _num(v.get("elevM"))
    agl = _num(v.get("aglM"))
    f = {
        "lat": _num(v.get("lat"), 6), "lon": _num(v.get("lon"), 6),
        "altMsl": round(elev / 0.3048, 1) if elev is not None else None,
        "agl": round(agl / 0.3048, 1) if agl is not None else None,
        "altInd": _num(v.get("altInd"), 1), "pa": _num(v.get("pa"), 1),
        "ias": _num(v.get("ias"), 2), "cas": _num(v.get("cas"), 2),
        "tas": round(float(v["tasMs"]) * ms_to_kt, 2) if v.get("tasMs") is not None else None,
        "gs": round(float(v["gsMs"]) * ms_to_kt, 2) if v.get("gsMs") is not None else None,
        "mach": _num(v.get("mach"), 4), "vs": _num(v.get("vsFpm"), 1),
        "hdgT": _num(hdg_t, 2), "hdgM": _num(hdg_m, 2), "trkT": _num(v.get("trkT"), 2), "magVar": _num(magvar, 2),
        "pitch": _num(v.get("pitch"), 2), "roll": _num(v.get("roll"), 2), "aoa": _num(v.get("aoa"), 2),
        "oat": _num(_pick(v.get("oat"), v.get("oat2")), 2), "tat": _num(_pick(v.get("tat"), v.get("tat2")), 2),
        "qnh": _num(qnh, 2), "baro": _num(baro, 2),
        "pStatic": round(float(v["pStaticPa"]) / 100.0, 2) if (v.get("pStaticPa") or 0) > 0 else None,
        "windDirT": _num(wind_dir_t, 1), "windKt": _num(wind_kt, 1), "rho": _num(v.get("rho"), 5),
        "altTempErr": _num(v.get("altTempErr"), 1), "visSm": _num(v.get("visSm"), 2),
        "rwyFriction": _num(v.get("rwyFriction"), 0),
        "mass": _num(v.get("mass"), 1), "fuel": _num(v.get("fuel"), 1), "payload": _num(v.get("payload"), 1),
        "ff": round(float(v["ffKgs"]) * 3600.0, 1) if v.get("ffKgs") is not None else None,
        "n1": [round(float(x), 1) for x in (v.get("n1") or [])][: max(1, int(v.get("engines") or 1))],
        "flapReq": _num(v.get("flapReq"), 3), "flapDep": _num(v.get("flapDep"), 3),
        "gearDown": bool(v.get("gearDown")) if v.get("gearDown") is not None else None,
        "onGround": bool(v.get("onGround")) if v.get("onGround") is not None else None,
        "paused": bool(v.get("paused")), "zulu": _num(v.get("zulu"), 1),
        "gpsDist": _num(v.get("gpsDist"), 2), "gpsBrgM": _num(v.get("gpsBrgM"), 1),
        "todDist": _num(v.get("todDist"), 2), "landingAlt": _num(v.get("landingAlt"), 0),
    }
    build = int(v.get("xpBuild") or 0)
    version = (web.version if via == "Web API" and web.version else None)
    if not version and build:
        version = "build %d" % build
    b = BEACON.recent()
    conn = {
        "connected": via is not None, "via": via, "host": xp_host(), "version": version,
        "webapi": web.status, "udp": udp.status, "beacon": BEACON.status,
        "discovered": ({"ip": b["ip"], "name": b["name"], "build": b["version"]} if b else None),
    }
    return {"t": round(time.time(), 2), "app": VERSION, "xp": conn, "ac": ac if via else None, "f": f if via else None}


class Hub:
    """Chooses the live source (Web API preferred) and builds snapshots."""

    def __init__(self, web, udp):
        self.web, self.udp = web, udp
        self.last_ac = None

    def snapshot(self):
        if self.web.connected and self.web.values():
            vals, via = self.web.values(), "Web API"
        elif self.udp.fresh():
            vals, via = self.udp.values(), "UDP"
        else:
            vals, via = {}, None
        st = build_state(vals, via, self.web, self.udp)
        ac = st.get("ac")
        if ac:
            sig = (ac["icao"], ac["desc"], ac["tail"])
            if sig != self.last_ac and (ac["icao"] or ac["desc"]):
                log("Aircraft: %s  %s  %s" % (ac["icao"] or "????", ac["desc"], ("(" + ac["tail"] + ")") if ac["tail"] else ""))
                self.last_ac = sig
        return st


# --------------------------------------------------------------------- apt.dat
def _parse_vdf_paths(text):
    out = []
    for line in text.splitlines():
        line = line.strip()
        if line.startswith('"path"'):
            parts = line.split('"')
            if len(parts) >= 4:
                out.append(parts[3].replace("\\\\", "\\"))
    return out


def find_xp_roots():
    """Best-effort search for X-Plane 12 installs (installer breadcrumbs, Steam libraries, common paths)."""
    cands = []
    for base in (os.environ.get("LOCALAPPDATA"), os.path.expanduser("~/Library/Preferences"), os.path.expanduser("~/.x-plane")):
        if base:
            f = os.path.join(base, "x-plane_install_12.txt")
            try:
                with open(f, "r", encoding="utf-8", errors="replace") as fh:
                    cands += [l.strip() for l in fh if l.strip()]
            except OSError:
                pass
    steam_roots = [r"C:\Program Files (x86)\Steam", r"C:\Program Files\Steam",
                   os.path.expanduser("~/.steam/steam"), os.path.expanduser("~/.local/share/Steam"),
                   os.path.expanduser("~/Library/Application Support/Steam")]
    libs = []
    for sr in steam_roots:
        vdf = os.path.join(sr, "steamapps", "libraryfolders.vdf")
        try:
            with open(vdf, "r", encoding="utf-8", errors="replace") as fh:
                libs += _parse_vdf_paths(fh.read())
        except OSError:
            pass
        libs.append(sr)
    if os.name == "nt":
        for d in "CDEFGH":
            libs += ["%s:\\SteamLibrary" % d, "%s:\\Steam" % d, "%s:\\Program Files (x86)\\Steam" % d]
            cands += ["%s:\\X-Plane 12" % d]
    for lib in libs:
        cands.append(os.path.join(lib, "steamapps", "common", "X-Plane 12"))
    seen, roots = set(), []
    for c in cands:
        c = os.path.normpath(c.strip().strip('"'))
        if c in seen:
            continue
        seen.add(c)
        if os.path.isdir(os.path.join(c, "Resources")) and os.path.isdir(os.path.join(c, "Global Scenery")):
            roots.append(c)
    return roots


class AptDB:
    """Runway lookup from X-Plane's own apt.dat (indexed in the background on first use)."""

    def __init__(self):
        self.lock = threading.Lock()
        self.root = None
        self.files = []
        self.index = {}       # ICAO -> (file, offset)
        self.coords = []      # (lat, lon, icao, name)
        self.state = "not configured"
        self.thread = None

    def configure(self, root):
        root = (root or "").strip()
        if not root:
            found = find_xp_roots()
            root = found[0] if found else ""
        files = []
        if root:
            for rel in (("Custom Scenery", "Global Airports"), ("Global Scenery", "Global Airports"),
                        ("Resources", "default scenery", "default apt dat")):
                f = os.path.join(root, *rel, "Earth nav data", "apt.dat")
                if os.path.isfile(f):
                    files.append(f)
        with self.lock:
            if root == self.root and files == self.files and self.state != "not configured":
                return
            self.root, self.files = root, files
            self.index, self.coords = {}, []
            self.state = "ready to index" if files else ("apt.dat not found under %s" % root if root else "X-Plane folder not found")
            self.thread = None
        if files:
            log("Airport data: %s" % files[0])

    def _ensure(self):
        with self.lock:
            if self.thread or not self.files or self.state == "ready":
                return
            self.state = "indexing"
            self.thread = threading.Thread(target=self._build, daemon=True, name="aptdat")
            self.thread.start()

    def _build(self):
        t0 = time.time()
        index, coords = {}, []
        for path in self.files:
            try:
                with open(path, "rb") as fh:
                    cur, code, cur_name, have_xy, off = None, None, "", False, 0
                    for line in fh:
                        pos = off
                        off += len(line)
                        c = line[:5]
                        if c.startswith((b"1 ", b"16 ", b"17 ")):
                            parts = line.split(None, 5)
                            if len(parts) >= 5:
                                cur = code = parts[4].decode("latin-1").upper()
                                cur_name = parts[5].decode("latin-1", "replace").strip() if len(parts) > 5 else ""
                                have_xy = False
                                if cur not in index:
                                    index[cur] = (path, pos)
                        elif cur and c.startswith(b"1302 "):
                            p = line.split()
                            if len(p) >= 3 and p[1] == b"icao_code":
                                code = p[2].decode("latin-1").upper()
                                if code != cur and code not in index:
                                    index[code] = index.get(cur)
                        elif cur and not have_xy and c.startswith(b"100 "):
                            p = line.split()
                            if len(p) >= 11:
                                try:
                                    coords.append((float(p[9]), float(p[10]), code or cur, cur_name))
                                    have_xy = True
                                except ValueError:
                                    pass
            except OSError as e:
                log("apt.dat read error:", e)
        with self.lock:
            self.index, self.coords = index, coords
            self.state = "ready"
        log("Airport data indexed: %d airports in %.1f s" % (len(index), time.time() - t0))

    def status(self):
        with self.lock:
            return {"state": self.state, "root": self.root, "airports": len(self.index)}

    def lookup(self, icao):
        self._ensure()
        icao = (icao or "").strip().upper()
        with self.lock:
            state, loc = self.state, self.index.get(icao)
        if state != "ready":
            return {"ok": False, "state": state}
        if not loc:
            return {"ok": False, "state": "ready", "error": "Airport %s not found in apt.dat" % icao}
        path, off = loc
        rows, name, elev = [], "", None
        with open(path, "rb") as fh:
            fh.seek(off)
            first = True
            for line in fh:
                if not first and line[:5].startswith((b"1 ", b"16 ", b"17 ", b"99")):
                    break
                if first:
                    p = line.split(None, 5)
                    elev = float(p[1])
                    name = p[5].decode("latin-1", "replace").strip() if len(p) > 5 else ""
                    first = False
                elif line.startswith(b"100 "):
                    rows.append(line.split())
        runways = []
        for p in rows:
            try:
                width, surface = float(p[1]), int(float(p[2]))
                ends = [(p[8].decode(), float(p[9]), float(p[10]), float(p[11])),
                        (p[17].decode(), float(p[18]), float(p[19]), float(p[20]))]
            except (IndexError, ValueError):
                continue
            length = _gc_m(ends[0][1], ends[0][2], ends[1][1], ends[1][2])
            for a, b in ((0, 1), (1, 0)):
                ident, lat, lon, disp = ends[a]
                other = ends[b]
                runways.append({
                    "id": ident, "lat": lat, "lon": lon, "widthM": width, "surface": surface,
                    "hdgTrue": round(_brg(lat, lon, other[1], other[2]), 1),
                    "lengthM": round(length), "toraM": round(length), "displacedM": round(disp),
                    "ldaM": round(length - disp),
                })
        return {"ok": True, "icao": icao, "name": name, "elevFt": elev, "runways": runways}

    def nearest(self, lat, lon, n=6):
        self._ensure()
        with self.lock:
            state, coords = self.state, self.coords
        if state != "ready":
            return {"ok": False, "state": state}
        cl = math.cos(math.radians(lat))
        best = sorted(coords, key=lambda c: (c[0] - lat) ** 2 + ((c[1] - lon) * cl) ** 2)[:n]
        return {"ok": True, "airports": [{"icao": c[2], "name": c[3], "distNm": round(_gc_m(lat, lon, c[0], c[1]) / 1852.0, 1)} for c in best]}


def _gc_m(la1, lo1, la2, lo2):
    p1, p2, dl = math.radians(la1), math.radians(la2), math.radians(lo2 - lo1)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 6371008.8 * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _brg(la1, lo1, la2, lo2):
    p1, p2, dl = math.radians(la1), math.radians(la2), math.radians(lo2 - lo1)
    y = math.sin(dl) * math.cos(p2)
    x = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return (math.degrees(math.atan2(y, x)) + 360.0) % 360.0


APT = AptDB()


# --------------------------------------------------------------------- web server
MIME = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
        ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon",
        ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".txt": "text/plain; charset=utf-8"}


def load_user_profiles():
    try:
        with open(PROFILES_PATH, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        return data if isinstance(data, list) else data.get("profiles", [])
    except FileNotFoundError:
        return []
    except Exception as e:
        log("user_profiles.json:", e)
        return []


class Handler(BaseHTTPRequestHandler):
    server_version = "XPFlightComputer/" + VERSION
    hub = None
    lan = False

    def log_message(self, fmt, *args):
        if DEBUG:
            log("http:", fmt % args)

    def _host_ok(self):
        if self.lan:
            return True
        host = (self.headers.get("Host") or "").rsplit(":", 1)[0].strip("[]").lower()
        return host in ("127.0.0.1", "localhost", "::1", "")

    def _send(self, code, body, ctype="application/json; charset=utf-8", cache=False):
        if isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "max-age=86400" if cache else "no-cache")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _json(self, obj, code=200):
        self._send(code, json.dumps(obj, separators=(",", ":")))

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        if not self._host_ok():
            return self._send(403, '{"error":"forbidden host"}')
        url = urllib.parse.urlsplit(self.path)
        q = urllib.parse.parse_qs(url.query)
        path = url.path
        try:
            if path == "/api/state":
                return self._json(self.hub.snapshot())
            if path == "/api/stream":
                return self._stream()
            if path == "/api/config":
                return self._json({"config": CONFIG.public(), "airports": APT.status(),
                                   "xpRoots": find_xp_roots(), "lan": self.lan, "version": VERSION})
            if path == "/api/profiles":
                return self._json(load_user_profiles())
            if path == "/api/airport":
                return self._json(APT.lookup(q.get("icao", [""])[0]))
            if path == "/api/nearest":
                return self._json(APT.nearest(float(q["lat"][0]), float(q["lon"][0])))
        except (KeyError, ValueError) as e:
            return self._json({"ok": False, "error": "bad request: %s" % e}, 400)
        return self._static(path)

    def do_POST(self):
        if not self._host_ok():
            return self._send(403, '{"error":"forbidden host"}')
        if (self.headers.get("Content-Type") or "").split(";")[0].strip() != "application/json":
            return self._json({"ok": False, "error": "JSON required"}, 415)
        n = int(self.headers.get("Content-Length") or 0)
        try:
            body = json.loads(self.rfile.read(min(n, 65536)).decode("utf-8") or "{}")
        except ValueError:
            return self._json({"ok": False, "error": "invalid JSON"}, 400)
        if urllib.parse.urlsplit(self.path).path == "/api/config":
            try:
                cfg = CONFIG.update(body)
            except (ValueError, TypeError) as e:
                return self._json({"ok": False, "error": str(e)}, 400)
            if "xpRoot" in body:
                APT.configure(cfg.get("xpRoot"))
            return self._json({"ok": True, "config": cfg, "airports": APT.status()})
        return self._json({"ok": False, "error": "not found"}, 404)

    def _stream(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.end_headers()
        try:
            self.wfile.write(b"retry: 2000\n\n")
            while True:
                data = json.dumps(self.hub.snapshot(), separators=(",", ":"))
                self.wfile.write(("data: %s\n\n" % data).encode("utf-8"))
                self.wfile.flush()
                time.sleep(0.2)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError):
            return

    def _static(self, path):
        if path in ("", "/"):
            path = "/index.html"
        rel = urllib.parse.unquote(path).lstrip("/").replace("\\", "/")
        full = os.path.normpath(os.path.join(WEB_ROOT, rel))
        if not full.startswith(os.path.normpath(WEB_ROOT) + os.sep) or not os.path.isfile(full):
            return self._send(404, "Not found", "text/plain; charset=utf-8")
        ext = os.path.splitext(full)[1].lower()
        with open(full, "rb") as fh:
            body = fh.read()
        self._send(200, body, MIME.get(ext, "application/octet-stream"), cache=ext in (".woff2", ".woff", ".ttf"))


def lan_ips():
    ips = set()
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("192.0.2.1", 9))          # no traffic is sent; picks the LAN interface
        ips.add(s.getsockname()[0])
        s.close()
    except OSError:
        pass
    try:
        ips.update(ip for ip in socket.gethostbyname_ex(socket.gethostname())[2] if not ip.startswith("127."))
    except OSError:
        pass
    return sorted(ips)


def main():
    global DEBUG
    ap = argparse.ArgumentParser(description=APP + " - X-Plane 12 bridge and web app")
    ap.add_argument("--port", type=int, default=8765, help="web app port (default 8765)")
    ap.add_argument("--lan", action="store_true", help="allow phones/tablets on your network to open the app")
    ap.add_argument("--xp-host", help="IP of the PC running X-Plane (default: auto)")
    ap.add_argument("--discover", action="store_true", help="listen for X-Plane's network beacon to find it on another PC")
    ap.add_argument("--xp-root", help="X-Plane 12 folder, for runway data (default: auto-detect)")
    ap.add_argument("--no-webapi", action="store_true", help="do not use the X-Plane Web API")
    ap.add_argument("--no-udp", action="store_true", help="do not use UDP RREF")
    ap.add_argument("--no-browser", action="store_true", help="do not open the browser")
    ap.add_argument("--debug", action="store_true", help="verbose logging")
    a = ap.parse_args()
    DEBUG = a.debug

    over = {}
    if a.xp_host:
        over["xpHost"] = a.xp_host
    if a.xp_root:
        over["xpRoot"] = a.xp_root
    if a.no_webapi:
        over["useWebApi"] = False
    if a.no_udp:
        over["useUdp"] = False
    if over:
        CONFIG.update(over, save=False)

    if not os.path.isfile(os.path.join(WEB_ROOT, "index.html")):
        log("ERROR: web files not found in", WEB_ROOT)
        sys.exit(1)

    print("=" * 64)
    print("  %s %s  -  X-Plane 12 companion" % (APP, VERSION))
    print("=" * 64)
    global WEB
    if a.lan or a.discover:
        BEACON.start()
    else:
        BEACON.status = "off (use --discover to find X-Plane on another PC)"
    web, udp = WebApiSource(), UdpSource()
    WEB = web
    web.start()
    udp.start()
    APT.configure(CONFIG.get("xpRoot"))
    Handler.hub = Hub(web, udp)
    Handler.lan = a.lan

    bind = "0.0.0.0" if a.lan else "127.0.0.1"
    try:
        srv = ThreadingHTTPServer((bind, a.port), Handler)
    except OSError as e:
        log("ERROR: cannot open port %d (%s). Is the app already running? Try --port 8766" % (a.port, e))
        sys.exit(1)
    srv.daemon_threads = True
    url = "http://127.0.0.1:%d/" % a.port
    log("Open the app:  " + url)
    if a.lan:
        for ip in lan_ips():
            log("On your phone/tablet:  http://%s:%d/" % (ip, a.port))
    log("Waiting for X-Plane (Web API on port %d, UDP on port %d)..." % (CONFIG.get("webApiPort"), CONFIG.get("udpPort")))
    log("Press Ctrl+C to quit.")
    if not a.no_browser:
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever(poll_interval=0.5)
    except KeyboardInterrupt:
        pass
    finally:
        udp.stop()
        log("Bye.")


if __name__ == "__main__":
    main()
