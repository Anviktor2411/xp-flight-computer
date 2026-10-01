"""Write dataref snapshots for the plugin test harness, using the same numbers as tools/fake_xplane.py.

Each file maps a dataref name to {"t": type, "v": value}; types: i int, f float, d double, vf float array,
vi int array, b text, bx raw bytes as hex.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "tools"))
import fake_xplane  # noqa: E402

TEXT = {"sim/aircraft/view/acf_ICAO", "sim/aircraft/view/acf_descrip", "sim/aircraft/view/acf_tailnum", "sim/aircraft/view/acf_author"}
INTS = {"sim/aircraft/engine/acf_num_engines", "sim/aircraft/gear/acf_gear_retract", "sim/aircraft/controls/acf_flap_detents",
        "sim/cockpit2/controls/gear_handle_down", "sim/flightmodel/failures/onground_any", "sim/time/paused",
        "sim/version/xplane_internal_version"}
INT_ARRAYS = {"sim/aircraft/prop/acf_en_type"}
DOUBLES = {"sim/flightmodel/position/latitude", "sim/flightmodel/position/longitude", "sim/flightmodel/position/elevation"}


def typed(state):
    out = {}
    for k, v in state.items():
        if k in TEXT:
            out[k] = {"t": "b", "v": v}
        elif k in INT_ARRAYS:
            out[k] = {"t": "vi", "v": [int(x) for x in v]}
        elif isinstance(v, list):
            out[k] = {"t": "vf", "v": [float(x) for x in v]}
        elif k in INTS or k.startswith("sim/aircraft2/metadata/"):
            out[k] = {"t": "i", "v": int(v)}
        elif k in DOUBLES:
            out[k] = {"t": "d", "v": float(v)}
        else:
            out[k] = {"t": "f", "v": float(v)}
    # every metadata flag exists in X-Plane 12, most of them 0
    for flag in ("airliner", "general_aviation", "helicopter", "glider", "military", "cargo", "experimental", "ultralight", "seaplane", "vtol", "sci_fi"):
        out.setdefault("sim/aircraft2/metadata/is_" + flag, {"t": "i", "v": 0})
    return out


def snapshot(ac):
    sim = fake_xplane.Sim(ac, 0)
    sim.update()
    return typed(dict(sim.state))


def ground(state):
    """B738 at the holding point of runway 26 at Tallinn (EETN, 131 ft), ready for take-off."""
    s = json.loads(json.dumps(state))
    def put(k, v):
        s[k]["v"] = v
    put("sim/flightmodel/position/latitude", 59.4133)
    put("sim/flightmodel/position/longitude", 24.8328)
    put("sim/flightmodel/position/elevation", 131 * 0.3048 + 1.5)
    put("sim/flightmodel/position/y_agl", 1.5)
    put("sim/cockpit2/gauges/indicators/altitude_ft_pilot", 131.0)
    put("sim/flightmodel2/position/pressure_altitude", 131.0 + (1013.25 - 1008) * 27)
    for k in ("sim/cockpit2/gauges/indicators/airspeed_kts_pilot", "sim/cockpit2/gauges/indicators/calibrated_airspeed_kts_pilot",
              "sim/flightmodel/position/true_airspeed", "sim/flightmodel/position/groundspeed", "sim/flightmodel/misc/machno",
              "sim/flightmodel/position/vh_ind_fpm", "sim/flightmodel/position/theta", "sim/flightmodel2/position/alpha"):
        put(k, 0.0)
    put("sim/flightmodel/position/psi", 262.0)
    put("sim/flightmodel/position/mag_psi", 255.0)
    put("sim/flightmodel/position/hpath", 262.0)
    put("sim/weather/aircraft/temperature_ambient_deg_c", 12.0)
    put("sim/cockpit2/temperature/outside_air_temp_degc", 12.0)
    put("sim/weather/aircraft/temperature_leadingedge_deg_c", 12.0)
    put("sim/weather/aircraft/qnh_pas", 100800.0)
    put("sim/weather/aircraft/barometer_current_pas", 100330.0)
    put("sim/cockpit2/gauges/actuators/barometer_setting_in_hg_pilot", 1008 / 33.8639)
    put("sim/weather/aircraft/wind_now_direction_degt", 250.0)
    put("sim/weather/aircraft/wind_now_speed_msc", 10 * 0.514444)
    put("sim/cockpit2/gauges/indicators/wind_heading_deg_mag", 243.0)
    put("sim/cockpit2/gauges/indicators/wind_speed_kts", 10.0)
    put("sim/weather/rho", 1.227)
    put("sim/flightmodel/weight/m_total", 68500.0)
    put("sim/flightmodel/weight/m_fuel_total", 9800.0)
    put("sim/flightmodel/weight/m_fixed", 68500.0 - 41413.0 - 9800.0)
    put("sim/cockpit2/engine/indicators/N1_percent", [21.5, 21.5, 0, 0, 0, 0, 0, 0])
    put("sim/cockpit2/engine/indicators/fuel_flow_kg_sec", [0.08, 0.08, 0, 0, 0, 0, 0, 0])
    put("sim/cockpit2/controls/flap_handle_request_ratio", 0.375)
    put("sim/cockpit2/controls/flap_handle_deploy_ratio", 0.375)
    put("sim/cockpit2/controls/gear_handle_down", 1)
    put("sim/flightmodel/failures/onground_any", 1)
    return s


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "scenarios")
    os.makedirs(out, exist_ok=True)
    b738 = snapshot("B738")
    files = {
        "b738_cruise.json": b738,
        "b738_ground.json": ground(b738),
        "c172.json": snapshot("C172"),
        "a333.json": snapshot("A333"),
    }
    odd = ground(b738)                    # an aircraft file with Latin-1 text (not valid UTF-8)
    odd["sim/aircraft/view/acf_author"] = {"t": "bx", "v": "4ae47267656e204dfc6c6c6572"}   # "Jürgen Müller" in Latin-1
    odd["sim/aircraft/view/acf_descrip"] = {"t": "bx", "v": "426f65696e672037333720c96469746f6e"}
    files["latin1.json"] = odd
    for name, data in files.items():
        with open(os.path.join(out, name), "w") as f:
            json.dump(data, f, indent=0)
    print("wrote", ", ".join(sorted(files)), "to", out)


if __name__ == "__main__":
    main()
