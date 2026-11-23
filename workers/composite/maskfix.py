"""Mask refinement for Product Lock. Pure numpy + Pillow (no scipy: the Vercel bundle is size-limited).

Why: background-removal models judge "foreground" by contrast. A cream label on a cream studio backdrop comes back as a hole,
so the composite shows the scene *through* the product while the protected-pixel check still passes (it only checks the pixels
the matte kept). That happened with the Mellooo pouch (48% of the product was missing). These functions make that visible and
fix the common case:
  * enclosed holes in opaque packaging are filled, unless the caller marks them as intentionally transparent (keep_boxes);
  * the faint haze of the source photo's own shadow (low alpha, connected to the image border) is removed, because it otherwise
    enlarges the bounding box and makes the product float above the surface it is placed on;
  * every change is counted and reported, and large fills require human review instead of silently passing.
"""
import numpy as np
from PIL import Image, ImageDraw

SOLID = 128          # alpha at or above this counts as product
HAZE = 100           # border-connected alpha below this is treated as source-shadow haze
REVIEW_HOLES = 0.02  # filling more than 2% of the product area needs a human to confirm there is no real window


def _outside(solid):
    """Boolean map of non-product pixels connected to the image border (the real background)."""
    h, w = solid.shape
    pad = np.zeros((h + 2, w + 2), np.uint8); pad[1:-1, 1:-1] = np.where(solid, 255, 0)
    im = Image.frombytes('L', (w + 2, h + 2), pad.tobytes()); ImageDraw.floodfill(im, (0, 0), 128)   # C-speed flood fill from the padded corner
    return (np.array(im)[1:-1, 1:-1] == 128)


def refine(alpha, fill_holes=True, keep_boxes=None):
    """alpha: PIL 'L' image. keep_boxes: [(x0,y0,x1,y1)] in alpha pixel coords of regions that are truly transparent
    (e.g. a clear window on a bag). Returns (refined 'L' image, stats dict)."""
    a = np.array(alpha.convert('L')).astype(np.uint8)
    solid = a >= SOLID
    outside = _outside(solid)
    holes = ~solid & ~outside
    kept = np.zeros_like(holes)
    for (x0, y0, x1, y1) in (keep_boxes or []):
        kept[int(y0):int(y1), int(x0):int(x1)] = True
    kept &= holes
    fill = holes & ~kept if fill_holes else np.zeros_like(holes)
    haze = outside & (a > 0) & (a < HAZE)
    out = a.copy(); out[fill] = 255; out[haze] = 0
    product = int((out >= SOLID).sum())
    hole_px = int(holes.sum())
    frac = hole_px / max(1, product)
    reasons = []
    if fill_holes and frac >= REVIEW_HOLES:
        reasons.append('filled %.1f%% of the product area that the cutout model had left transparent; confirm the product has no clear window' % (frac * 100))
    if not fill_holes and frac >= REVIEW_HOLES:
        reasons.append('%.1f%% of the product area is transparent inside the outline; the scene will show through it' % (frac * 100))
    if int(kept.sum()):
        reasons.append('kept %d px transparent as requested (marked window)' % int(kept.sum()))
    ys, xs = np.nonzero(out >= SOLID)
    stats = {
        'product_px': product,
        'enclosed_transparent_px': hole_px,
        'enclosed_transparent_fraction': round(frac, 4),
        'filled_px': int(fill.sum()),
        'kept_transparent_px': int(kept.sum()),
        'haze_removed_px': int(haze.sum()),
        'bbox': [int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1] if product else None,
        'status': 'review' if reasons else 'ok',
        'review_reasons': reasons,
    }
    return Image.fromarray(out, 'L'), stats


def base_extent(alpha_np, rows=6):
    """Left/right x of the product's bottom edge (where it touches the ground), from the last `rows` opaque rows."""
    solid = alpha_np >= 200
    ys = np.nonzero(solid.any(axis=1))[0]
    if not len(ys): return None
    bottom = ys.max(); band = solid[max(0, bottom - rows):bottom + 1]
    xs = np.nonzero(band.any(axis=0))[0]
    return int(xs.min()), int(xs.max()), int(bottom)
