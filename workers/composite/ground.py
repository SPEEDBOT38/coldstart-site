"""Grounding for Product Lock: contact shadow + cast shadow rendered on the BACKGROUND, before the locked product layer.

Model (a deliberate, cheap approximation of what a photographer sees):
  * contact shadow (ambient occlusion): darkest exactly along the product's real bottom contour, decaying quickly with
    distance from it; it follows the contour of the base (a curved pouch bottom is not a flat ellipse);
  * cast shadow: the product silhouette projected onto the support plane. The plane's foreshortening comes from the
    camera elevation; its direction and length from the light direction; softness grows with distance from the contact
    (penumbra), as with a real area light;
  * both darken the surface multiplicatively (the surface texture stays visible), with strength adapted to the local
    surface brightness so the shadow is visible on dark stone and wood without turning black on light paper.
Nothing here touches product pixels: the caller composites the locked product on top afterwards.
"""
import numpy as np
from PIL import Image, ImageFilter

ELEVATION_FLATTEN = {'eye_level': 0.10, 'low': 0.06, 'high_angle': 0.30, 'overhead': 0.75}


def luminance(rgb):
    return rgb[..., 0] * 0.2126 + rgb[..., 1] * 0.7152 + rgb[..., 2] * 0.0722


def bottom_contour(alpha):
    """Per column of the product layer: lowest opaque row (or -1). Opaque = alpha >= 128."""
    solid = alpha >= 128
    any_ = solid.any(axis=0)
    rows = np.where(any_, alpha.shape[0] - 1 - np.argmax(solid[::-1], axis=0), -1)
    return rows, any_


def _blur(a, r):
    if r <= 0.3: return a
    im = Image.fromarray(np.clip(a * 255, 0, 255).astype('uint8'), 'L').filter(ImageFilter.GaussianBlur(r))
    return np.asarray(im).astype(np.float32) / 255.0


def render(bg, alpha, x, y, opts=None):
    """bg: HxWx3 uint8 background (already at canvas size). alpha: h x w product alpha (locked layer). (x, y): where the
    product layer will be pasted. Returns (new background uint8, report)."""
    o = opts or {}
    H, W = bg.shape[:2]; h, w = alpha.shape
    rows, has = bottom_contour(alpha)
    if not has.any(): return bg, None
    base = int(rows[has].max())                         # lowest opaque row of the product (layer coords)
    cols = np.nonzero(has)[0]
    tol = max(2, int(0.025 * h))
    contact_cols = cols[rows[cols] >= base - tol]       # columns that actually touch (or nearly touch) the support
    bx0, bx1 = int(contact_cols.min()), int(contact_cols.max()); bw = max(8, bx1 - bx0)
    gy = y + base                                       # support line in canvas coords

    light = o.get('light_from', 'front'); elev = o.get('camera', 'eye_level')
    hard = float(np.clip(o.get('light_hardness', 0.35), 0, 1)); soft = 1 - hard
    flatten = float(o.get('flatten', ELEVATION_FLATTEN.get(elev, 0.12)))
    strength = float(np.clip(o.get('strength', 1.0), 0, 1.5))

    # local surface brightness just under and around the base decides how strong the shadow must be to read
    band = bg[min(H - 1, gy + 1):min(H, gy + 1 + max(6, int(0.05 * bw))), max(0, x + bx0 - bw // 4):min(W, x + bx1 + bw // 4)].astype(np.float32)
    Ls = float(luminance(band).mean()) if band.size else 128.0
    texture = float(luminance(band).std()) if band.size else 0.0
    dark_surface = Ls < 80
    contact_max = np.clip(0.55 + 0.30 * (1 - Ls / 255.0), 0.5, 0.85) * strength   # relative darkening at the contact line
    cast_max = np.clip((0.18 + 0.32 * hard) * (1.25 if dark_surface else 1.0), 0.12, 0.55) * strength

    S = np.zeros((H, W), np.float32)
    # --- contact shadow: per-column exponential decay below the real contour, weighted by how close it is to the support
    d0 = max(2.0, 0.018 * bw * (0.7 + soft))
    depth = int(d0 * 4)
    # Every column of the base gets occlusion from its own bottom edge down to just below the support line. Where the
    # base curves up (pouch corners, rounded bottoms) the wedge between product and surface is in deep shade, as in a
    # photograph; directly under the touching part the shadow is darkest and decays with distance below the support line.
    sx = o.get('support_x')                              # [x0, x1] fractions of canvas width: where the support exists
    sx0, sx1 = (int(sx[0] * W), int(sx[1] * W)) if sx else (0, W)
    for c in cols:
        top = y + rows[c]; cxc = x + c
        if not (0 <= cxc < W) or not (sx0 <= cxc <= sx1): continue   # no contact shadow in mid-air beyond the support's edge
        gapc = base - rows[c]
        if gapc > 0.12 * h: continue                     # far from the support (e.g. a raised side): no contact occlusion
        y1 = min(H, gy + depth)
        if top >= y1: continue
        yy = np.arange(max(0, top), y1)
        under = yy <= gy                                  # the wedge between the curved edge and the support
        v = np.where(under, 0.9 - 0.4 * (gy - yy) / max(1.0, 0.12 * h), np.exp(-(yy - gy) / d0))
        S[yy, cxc] = np.maximum(S[yy, cxc], np.clip(v, 0, 1) * contact_max)
    # occlusion spreads slightly past the ends of the base (horizontal blur), and a soft halo beyond — but only on the support
    S = np.maximum(_blur(S, 1.5 + 2.5 * soft), _blur(S, 6 + 10 * soft) * 0.6)
    if sx: S[:, :max(0, sx0)] = 0; S[:, min(W, sx1 + 1):] = 0

    # --- cast shadow: silhouette projected onto the support plane
    sil = (alpha >= 128).astype(np.float32)
    az = {'left': 1.0, 'right': -1.0}.get(light, 0.0)              # light from the left -> shadow to the right
    reach = float(o.get('length', 0.6 if light in ('left', 'right') else 0.35))
    dx = az * reach                                                 # horizontal shift per unit height
    fz = flatten if light in ('left', 'right') else flatten * 0.8   # front light: shadow falls straight back, short
    if light == 'top': fz *= 0.4
    # inverse affine (output -> input) for PIL, in product-layer coordinates with the base row as the hinge
    a, b, c = 1.0, dx / fz, -dx * base / fz
    d, e, f = 0.0, 1.0 / fz, base - base / fz
    pad = int(abs(dx) * h + 4); ph = int(h * fz) + 8
    out_w = w + 2 * pad; out_h = base + 8
    img = Image.fromarray((sil * 255).astype('uint8'), 'L')
    proj = img.transform((out_w, out_h), Image.AFFINE, (a, b, c - pad, d, e, f), Image.BILINEAR)   # output x is shifted by pad
    P = np.asarray(proj).astype(np.float32) / 255.0
    # fade with distance from the contact line (height of the casting point) and penumbra growing with distance
    rel = np.clip((base - np.arange(out_h))[:, None] / max(1.0, h * fz), 0, 1)
    P = P * (1 - 0.65 * rel)
    near = _blur(P, 2 + 6 * soft); far = _blur(P, 8 + 40 * soft)
    P = near * (1 - rel) + far * rel
    Cst = np.zeros((H, W), np.float32)
    ox, oy = x - pad, y
    ys0, xs0 = max(0, oy), max(0, ox); ys1, xs1 = min(H, oy + out_h), min(W, ox + out_w)
    if ys1 > ys0 and xs1 > xs0:
        Cst[ys0:ys1, xs0:xs1] = P[ys0 - oy:ys1 - oy, xs0 - ox:xs1 - ox] * cast_max
    # the cast shadow lives on the support plane: nothing below the contact line except the contact shadow itself
    Cst[min(H, gy + max(2, int(d0))):, :] *= 0.0

    T = np.clip(np.maximum(S, Cst), 0, 0.92)
    tint = np.array(o.get('tint', [0.55, 0.45, 0.40]), np.float32)          # warm, slightly coloured shadow (not grey-black)
    darkened = bg.astype(np.float32) * (1 - T[..., None] * (1 - tint[None, None, :] * 0.35))
    newbg = np.clip(darkened, 0, 255).astype('uint8')

    # --- measurements on the result (computed, not asserted)
    def L(arr): return float(luminance(arr.astype(np.float32)).mean()) if arr.size else 0.0
    under = newbg[gy + 1:gy + 1 + max(3, int(d0)), x + bx0:x + bx1]
    side = bg[gy + 1:gy + 1 + max(3, int(d0)), x + bx0:x + bx1]
    contact_drop = 1 - (L(under) / max(1.0, L(side)))
    report = {
        'support_line_y': int(gy), 'base_x': [int(x + bx0), int(x + bx1)], 'contact_columns': int(len(contact_cols)),
        'surface_luminance': round(Ls, 1), 'surface_texture': round(texture, 1), 'dark_surface': bool(dark_surface),
        'contact_darkening': round(contact_drop, 3),                   # fraction darker directly under the base
        'contact_visible': bool(contact_drop >= (0.25 if dark_surface else 0.18)),
        'too_dark': bool(L(under) < 6 and Ls > 25),
        'cast': {'direction': light, 'dx_per_height': round(dx, 3), 'flatten': round(fz, 3), 'max_opacity': round(float(cast_max), 3)},
        'softness': round(soft, 2), 'base_to_support_px': 0,
        'support_x_px': [sx0, sx1] if sx else None,
        'overhang_fraction': round(float(max(0, sx0 - (x + int(cols.min()))) + max(0, (x + int(cols.max())) - sx1)) / max(1, w), 3) if sx else None,
    }
    return newbg, report


def product_lighting(ref_rgb, alpha):
    """Lighting signature of the source product photo, from the product's own pixels (used to plan compatible scenes)."""
    m = alpha >= 200
    if m.sum() < 100: return None
    Lm = luminance(ref_rgb.astype(np.float32))
    ys, xs = np.nonzero(m); x0, x1 = xs.min(), xs.max(); mid = (x0 + x1) / 2; y0, y1 = ys.min(), ys.max(); midy = (y0 + y1) / 2
    left = Lm[m & (np.arange(Lm.shape[1])[None, :] < mid)].mean(); right = Lm[m & (np.arange(Lm.shape[1])[None, :] >= mid)].mean()
    top = Lm[m & (np.arange(Lm.shape[0])[:, None] < midy)].mean(); bot = Lm[m & (np.arange(Lm.shape[0])[:, None] >= midy)].mean()
    side = (left - right) / max(1.0, (left + right) / 2)
    r, g, bl = [ref_rgb[..., i][m].mean() for i in range(3)]
    spec = float((Lm[m] > 245).mean())
    return {'horizontal_balance': round(float(side), 3), 'light_from': 'left' if side > 0.15 else 'right' if side < -0.15 else 'front',   # label artwork biases this; only strong imbalance counts
            'vertical_balance': round(float((top - bot) / max(1.0, (top + bot) / 2)), 3), 'warmth': round(float(r / max(1.0, bl)), 3),
            'specular_fraction': round(spec, 4), 'character': 'soft frontal studio light' if abs(side) <= 0.15 else 'directional side light',
            'note': 'estimated from the product pixels; printed artwork can bias left/right balance'}
