"""Fit Oxygen's Vibrant Visuals particle shading to the in-game t65 measurements.

Model (per pixel): hdr = albedo * L + H (+ albedo * e * E for emissive texture sets); then one of three.js's
tone mappers (exposure 1) and sRGB encoding. Prints the best L, H, E for each tone mapper and the residual.
python tools/vv-fit.py
"""
import json, math

fx = json.load(open('packages/testpack/fixtures/ingame-1.26.52.json', encoding='utf8'))['results']['t65']['vv']

def s2l(v):
    v = v / 255
    return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4

def l2s(v):
    v = min(max(v, 0.0), 1.0)
    return 255 * (12.92 * v if v <= 0.0031308 else 1.055 * v ** (1 / 2.4) - 0.055)

def mat(m, v):
    # three.js mat3(columns) * v
    return [m[0][i] * v[0] + m[1][i] * v[1] + m[2][i] * v[2] for i in range(3)]

ACES_IN = [[0.59719, 0.07600, 0.02840], [0.35458, 0.90834, 0.13383], [0.04823, 0.01566, 0.83777]]
ACES_OUT = [[1.60475, -0.10208, -0.00327], [-0.53108, 1.10813, -0.07276], [-0.07367, -0.00605, 1.07602]]

def aces(c):
    c = [x / 0.6 for x in c]
    c = mat(ACES_IN, c)
    c = [(v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.4329510) + 0.238081) for v in c]
    return [min(max(x, 0), 1) for x in mat(ACES_OUT, c)]

def reinhard(c):
    return [x / (1 + x) for x in c]

def cineon(c):
    out = []
    for x in c:
        x = max(0.0, x - 0.004)
        out.append(((x * (6.2 * x + 0.5)) / (x * (6.2 * x + 1.7) + 0.06)) ** 2.2)
    return out

def neutral(c):
    start, desat = 0.8 - 0.04, 0.15
    x = min(c)
    off = x - 6.25 * x * x if x < 0.08 else 0.04
    c = [v - off for v in c]
    peak = max(c)
    if peak < start:
        return c
    d = 1 - start
    new = 1 - d * d / (peak + d - start)
    c = [v * new / peak for v in c]
    g = 1 - 1 / (desat * (peak - new) + 1)
    return [v + (new - v) * g for v in c]

def generic(c):
    # Bedrock's 'generic' operator as Lottes' curve (contrast 1, shoulder 0.95, hdrMax 64, mid 0.18 -> 0.267),
    # fitted to emissive alpha ramps in-game (tools/vv-probe-calibrate.mjs)
    a, d, hm, mi, mo = 1.0, 0.95, 64.0, 0.18, 0.267
    b = (-mi ** a + hm ** a * mo) / ((hm ** (a * d) - mi ** (a * d)) * mo)
    k = (hm ** (a * d) * mi ** a - hm ** a * mi ** (a * d) * mo) / ((hm ** (a * d) - mi ** (a * d)) * mo)
    return [min(max(x, 0) ** a / (max(x, 0) ** (a * d) * b + k), 1) for x in c]

# vanilla's Vibrant Visuals display pipeline, as packages/scene/src/vv.ts displayTransform runs it: midtones grade
# (saturation 1.05, contrast 1.15 around 0.18), the generic curve on the brightest channel (hue kept, whitening near the top), then a
# 2.2 gamma encode
GEN = dict(a=0.81, d=0.977, h=201.7, mi=0.18, mo=0.267, whitening=24)

def _gen_curve():
    a, d, h, mi, mo = GEN['a'], GEN['d'], GEN['h'], GEN['mi'], GEN['mo']
    span = (h ** (a * d) - mi ** (a * d)) * mo
    b = (-mi ** a + h ** a * mo) / span
    k = (h ** (a * d) * mi ** a - h ** a * mi ** (a * d) * mo) / span
    return lambda x: min(max(x, 0) ** a / (max(x, 0) ** (a * d) * b + k), 1)

def vanilla(c):
    f = _gen_curve()
    l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
    c = [l + (v - l) * 1.05 for v in c]
    c = [0.18 * (max(v, 0) / 0.18) ** 1.15 for v in c]
    m = max(c)
    if m <= 1e-9:
        return [0, 0, 0]
    t = f(m)
    w = t ** GEN['whitening']
    return [max(0, v) * t / m + (t - max(0, v) * t / m) * w for v in c]

def linear(c):
    return [min(max(x, 0), 1) for x in c]

TONES = {'aces': aces, 'reinhard': reinhard, 'cineon': cineon, 'neutral': neutral, 'generic': generic, 'vanilla': vanilla, 'none': linear}
ALB = {'v8': 64, 'v1': 128, 'v7': 255}

def render(tone, L, H, albedo, emissive=0.0, E=0.0):
    # light and haze can't be negative
    L, H = [abs(x) for x in L], [abs(x) for x in H]
    if tone is vanilla:
        # Oxygen's shader decodes textures with a 2.2 power, and the game encodes with its grading's gamma 2.2
        a = (albedo / 255) ** 2.2
        return [255 * min(max(v, 0), 1) ** (1 / 2.2) for v in tone([a * L[i] + H[i] + a * emissive * E for i in range(3)])]
    a = s2l(albedo)
    return [l2s(v) for v in tone([a * L[i] + H[i] + a * emissive * E for i in range(3)])]

def err_base(tone, p):
    L, H = p[0:3], p[3:6]
    e = 0.0
    for k, alb in ALB.items():
        out = render(tone, L, H, alb)
        e += sum((out[i] - fx[k][i]) ** 2 for i in range(3))
    return e

def nelder_mead(f, x0, step=0.3, iters=4000):
    n = len(x0)
    pts = [x0[:]] + [[x0[j] + (step if j == i else 0) for j in range(n)] for i in range(n)]
    vals = [f(p) for p in pts]
    for _ in range(iters):
        order = sorted(range(n + 1), key=lambda i: vals[i])
        pts, vals = [pts[i] for i in order], [vals[i] for i in order]
        c = [sum(p[j] for p in pts[:-1]) / n for j in range(n)]
        r = [c[j] + (c[j] - pts[-1][j]) for j in range(n)]
        fr = f(r)
        if fr < vals[0]:
            e = [c[j] + 2 * (c[j] - pts[-1][j]) for j in range(n)]
            fe = f(e)
            pts[-1], vals[-1] = (e, fe) if fe < fr else (r, fr)
        elif fr < vals[-2]:
            pts[-1], vals[-1] = r, fr
        else:
            k = [c[j] + 0.5 * (pts[-1][j] - c[j]) for j in range(n)]
            fk = f(k)
            if fk < vals[-1]:
                pts[-1], vals[-1] = k, fk
            else:
                for i in range(1, n + 1):
                    pts[i] = [pts[0][j] + 0.5 * (pts[i][j] - pts[0][j]) for j in range(n)]
                    vals[i] = f(pts[i])
    i = min(range(n + 1), key=lambda i: vals[i])
    return pts[i], vals[i]

import sys
if '--times' in sys.argv:
    # one fit per measured time of day, through the default tone mapper (--tone to pick another)
    tone_name = sys.argv[sys.argv.index('--tone') + 1] if '--tone' in sys.argv else 'vanilla'
    aces = TONES[tone_name]
    allt = json.load(open('packages/testpack/fixtures/ingame-1.26.52.json', encoding='utf8'))['results']['t65']['vvByTime']
    out = {}
    for tod, data in sorted(allt.items(), key=lambda kv: float(kv[0])):
        fx = data
        def eb(q):
            e = 0.0
            for k, alb in ALB.items():
                o = render(aces, q[0:3], q[3:6], alb)
                e += sum((o[i] - fx[k][i]) ** 2 for i in range(3))
            return e
        best = None
        for start in ([0.5, 0.6, 0.9, 0.05, 0.06, 0.1], [0.1, 0.2, 0.5, 0.02, 0.03, 0.05], [1.0, 1.2, 1.8, 0.02, 0.03, 0.05]):
            p_, v_ = nelder_mead(eb, start)
            if best is None or v_ < best[1]:
                best = (p_, v_)
        p_, v_ = best
        L, H = p_[0:3], p_[3:6]
        def fe(q):
            o = render(aces, L, H, 128, 1.0, q[0])
            return sum((o[i] - fx['v5'][i]) ** 2 for i in range(3))
        (E,), ev = nelder_mead(fe, [3.0], 0.5, 400)
        out[tod] = {'L': [round(abs(x), 4) for x in L], 'H': [round(abs(x), 4) for x in H], 'E': round(E, 3), 'rms': round(math.sqrt(v_ / 9), 2), 'emissiveRms': round(math.sqrt(ev / 3), 2)}
        print(tod, out[tod])
    json.dump(out, open('test-results/vv/fit-times.json', 'w'), indent=1)
    sys.exit(0)

results = {}
for name, tone in TONES.items():
    best = None
    for start in ([0.5, 0.6, 0.9, 0.05, 0.06, 0.1], [0.3, 0.4, 0.7, 0.1, 0.12, 0.2], [1.0, 1.2, 1.8, 0.02, 0.03, 0.05]):
        p, v = nelder_mead(lambda q: err_base(tone, q), start)
        if best is None or v < best[1]:
            best = (p, v)
    p, v = best
    L, H = p[0:3], p[3:6]
    # emissive strength from v5 (unlit grey with an emissive map of 1)
    def ferr(q):
        out = render(tone, L, H, 128, 1.0, q[0])
        return sum((out[i] - fx['v5'][i]) ** 2 for i in range(3))
    (E,), ev = nelder_mead(ferr, [2.0], 0.5, 400)
    rms = math.sqrt(v / 9)
    results[name] = {'L': [round(x, 4) for x in L], 'H': [round(x, 4) for x in H], 'E': round(E, 3), 'rms': round(rms, 2), 'emissiveRms': round(math.sqrt(ev / 3), 2)}
    pred = {k: [round(x) for x in render(tone, L, H, a)] for k, a in ALB.items()}
    pred['v5'] = [round(x) for x in render(tone, L, H, 128, 1.0, E)]
    print(f"{name:9s} rms {rms:5.2f}  L {results[name]['L']}  H {results[name]['H']}  E {results[name]['E']} (rms {results[name]['emissiveRms']})  {pred}")
json.dump(results, open('test-results/vv/fit.json', 'w'), indent=1)
