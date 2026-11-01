"""Small, dependency-free colour maths for the Berean theme tokens.

WCAG 2.x relative luminance / contrast, OKLab/OKLCH, CIELAB (D65),
CIEDE2000, and Machado et al. (2009) colour-vision-deficiency simulation.
"""
import math

def hex_to_rgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i+2], 16) / 255 for i in (0, 2, 4))

def rgb_to_hex(rgb):
    return '#' + ''.join(f'{max(0, min(255, round(c * 255))):02X}' for c in rgb)

def _lin(c):  # sRGB -> linear (WCAG 2.x uses the 0.04045 threshold in sRGB spec; 0.03928 in WCAG text, identical at 8-bit)
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

def _gam(c):
    return 12.92 * c if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055

def linear(hexc):
    return tuple(_lin(c) for c in hex_to_rgb(hexc))

def luminance(hexc):
    r, g, b = linear(hexc)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b

def contrast(a, b):
    la, lb = luminance(a), luminance(b)
    if la < lb:
        la, lb = lb, la
    return (la + 0.05) / (lb + 0.05)

# ---- OKLab / OKLCH (Ottosson) -------------------------------------------
def _lin_to_oklab(r, g, b):
    l = 0.4122214708*r + 0.5363325363*g + 0.0514459929*b
    m = 0.2119034982*r + 0.6806995451*g + 0.1073969566*b
    s = 0.0883024619*r + 0.2817188376*g + 0.6299787005*b
    l_, m_, s_ = (math.copysign(abs(x) ** (1/3), x) for x in (l, m, s))
    return (0.2104542553*l_ + 0.7936177850*m_ - 0.0040720468*s_,
            1.9779984951*l_ - 2.4285922050*m_ + 0.4505937099*s_,
            0.0259040371*l_ + 0.7827717662*m_ - 0.8086757660*s_)

def _oklab_to_lin(L, a, b):
    l_ = L + 0.3963377774*a + 0.2158037573*b
    m_ = L - 0.1055613458*a - 0.0638541728*b
    s_ = L - 0.0894841775*a - 1.2914855480*b
    l, m, s = l_**3, m_**3, s_**3
    return (4.0767416621*l - 3.3077115913*m + 0.2309699292*s,
            -1.2684380046*l + 2.6097574011*m - 0.3413193965*s,
            -0.0041960863*l - 0.7034186147*m + 1.7076147010*s)

def hex_to_oklch(hexc):
    L, a, b = _lin_to_oklab(*linear(hexc))
    C = math.hypot(a, b)
    H = math.degrees(math.atan2(b, a)) % 360
    return L, C, H

def _oklch_lin(L, C, H):
    h = math.radians(H)
    return _oklab_to_lin(L, C * math.cos(h), C * math.sin(h))

def in_gamut(L, C, H, eps=1e-6):
    return all(-eps <= x <= 1 + eps for x in _oklch_lin(L, C, H))

def oklch_to_hex(L, C, H):
    """Gamut-map by reducing chroma only (keeps L and H). Returns (hex, C_used)."""
    if not in_gamut(L, C, H):
        lo, hi = 0.0, C
        for _ in range(30):
            mid = (lo + hi) / 2
            if in_gamut(L, mid, H):
                lo = mid
            else:
                hi = mid
        C = lo
    rgb = tuple(_gam(max(0.0, min(1.0, x))) for x in _oklch_lin(L, C, H))
    return rgb_to_hex(rgb), C

# ---- CIELAB + CIEDE2000 ---------------------------------------------------
def _lin_to_lab(r, g, b):
    X = 0.4124564*r + 0.3575761*g + 0.1804375*b
    Y = 0.2126729*r + 0.7151522*g + 0.0721750*b
    Z = 0.0193339*r + 0.1191920*g + 0.9503041*b
    Xn, Yn, Zn = 0.95047, 1.0, 1.08883
    def f(t):
        return t ** (1/3) if t > 216/24389 else (24389/27 * t + 16) / 116
    fx, fy, fz = f(X/Xn), f(Y/Yn), f(Z/Zn)
    return 116*fy - 16, 500*(fx - fy), 200*(fy - fz)

def hex_to_lab(hexc):
    return _lin_to_lab(*linear(hexc))

def de2000(lab1, lab2):
    L1, a1, b1 = lab1; L2, a2, b2 = lab2
    C1, C2 = math.hypot(a1, b1), math.hypot(a2, b2)
    Cb = (C1 + C2) / 2
    G = 0.5 * (1 - math.sqrt(Cb**7 / (Cb**7 + 25**7)))
    a1p, a2p = (1+G)*a1, (1+G)*a2
    C1p, C2p = math.hypot(a1p, b1), math.hypot(a2p, b2)
    h1p = math.degrees(math.atan2(b1, a1p)) % 360 if C1p else 0
    h2p = math.degrees(math.atan2(b2, a2p)) % 360 if C2p else 0
    dLp = L2 - L1; dCp = C2p - C1p
    if C1p * C2p == 0: dhp = 0
    else:
        dhp = h2p - h1p
        if dhp > 180: dhp -= 360
        elif dhp < -180: dhp += 360
    dHp = 2 * math.sqrt(C1p*C2p) * math.sin(math.radians(dhp/2))
    Lbp = (L1 + L2) / 2; Cbp = (C1p + C2p) / 2
    if C1p * C2p == 0: hbp = h1p + h2p
    elif abs(h1p - h2p) <= 180: hbp = (h1p + h2p) / 2
    elif h1p + h2p < 360: hbp = (h1p + h2p + 360) / 2
    else: hbp = (h1p + h2p - 360) / 2
    T = (1 - 0.17*math.cos(math.radians(hbp-30)) + 0.24*math.cos(math.radians(2*hbp))
         + 0.32*math.cos(math.radians(3*hbp+6)) - 0.20*math.cos(math.radians(4*hbp-63)))
    dth = 30 * math.exp(-(((hbp-275)/25)**2))
    Rc = 2 * math.sqrt(Cbp**7 / (Cbp**7 + 25**7))
    Sl = 1 + (0.015*(Lbp-50)**2) / math.sqrt(20 + (Lbp-50)**2)
    Sc = 1 + 0.045*Cbp; Sh = 1 + 0.015*Cbp*T
    Rt = -math.sin(math.radians(2*dth)) * Rc
    return math.sqrt((dLp/Sl)**2 + (dCp/Sc)**2 + (dHp/Sh)**2 + Rt*(dCp/Sc)*(dHp/Sh))

def delta_e(h1, h2):
    return de2000(hex_to_lab(h1), hex_to_lab(h2))

# ---- Machado, Oliveira & Fernandes 2009, severity 1.0 (linear RGB) -------
MACHADO = {
    'deuteranopia': ((0.367322, 0.860646, -0.227968), (0.280085, 0.672501, 0.047413), (-0.011820, 0.042940, 0.968881)),
    'protanopia':   ((0.152286, 1.052583, -0.204868), (0.114503, 0.786281, 0.099216), (-0.003882, -0.048116, 1.051998)),
    'tritanopia':   ((1.255528, -0.076749, -0.178779), (-0.078411, 0.930809, 0.147602), (0.004733, 0.691367, 0.303900)),
}

def simulate_lab(hexc, kind):
    r, g, b = linear(hexc)
    m = MACHADO[kind]
    out = [max(0.0, min(1.0, m[i][0]*r + m[i][1]*g + m[i][2]*b)) for i in range(3)]
    return _lin_to_lab(*out)

def simulate_hex(hexc, kind):
    lab = simulate_lab(hexc, kind)  # only for display
    r, g, b = linear(hexc); m = MACHADO[kind]
    out = [max(0.0, min(1.0, m[i][0]*r + m[i][1]*g + m[i][2]*b)) for i in range(3)]
    return rgb_to_hex(tuple(_gam(x) for x in out))

def delta_e_cvd(h1, h2, kind):
    return de2000(simulate_lab(h1, kind), simulate_lab(h2, kind))

# Highlight keys by colour name (matches the Rust core). Display order is fixed and ours, independent of the core's index.
HL_KEYS = ['yellow', 'green', 'blue', 'pink', 'purple', 'orange']
HK = {i + 1: k for i, k in enumerate(HL_KEYS)}  # frame scripts number the six in display order
