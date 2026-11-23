"""Pixel-locked product compositor. Runs the rembg-published ISNet/U2NetP ONNX models on onnxruntime (MIT/Apache-2.0 code) for the matte and Pillow (HPND) for compositing.
Only glue lives here. Run:  python3 workers/composite/service.py   (PORT, COMPOSITE_KEY, REMBG_MODEL=u2netp)
POST /composite  {reference:dataUrl, background?:dataUrl, width, height, scale?}  -> {image:dataUrl, report}
The report is computed from the output pixels, not asserted: inside the eroded product matte the output must equal the locked foreground exactly."""
import base64, hashlib, io, json, os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from PIL import Image, ImageFilter, ImageChops, ImageDraw
import numpy as np
from seg import Matter

MODEL = os.environ.get('REMBG_MODEL', 'isnet-general-use'); SECOND = os.environ.get('REMBG_SECOND_MODEL', 'u2netp'); AGREE_MIN = float(os.environ.get('SEG_AGREE_MIN', '0.9')); KEY = os.environ.get('COMPOSITE_KEY', '')
PINNED = {'u2netp': '309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8', 'isnet-general-use': '60920e99c45464f2ba57bee2ad08c919a52bbf852739e96947fbb4358c0d964a'}   # sha256 of u2netp.onnx; source https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx ; U-2-Net licence Apache-2.0
SESSION = Matter(MODEL, PINNED.get(MODEL)); SESSION2 = Matter(SECOND, PINNED.get(SECOND)) if SECOND and SECOND != MODEL else None
MAX_PX = 24_000_000

def dec(u):
    b = base64.b64decode(u.split(',', 1)[1]); im = Image.open(io.BytesIO(b)); im.load()
    if im.width * im.height > MAX_PX: raise ValueError('image too large')
    return im, hashlib.sha256(b).hexdigest()

def enc(im, fmt='PNG'):
    o = io.BytesIO(); im.save(o, fmt); return 'data:image/%s;base64,' % fmt.lower() + base64.b64encode(o.getvalue()).decode(), hashlib.sha256(o.getvalue()).hexdigest()

def procedural_bg(w, h):
    y = np.linspace(0, 1, h)[:, None, None]; top = np.array([226, 220, 208]); bot = np.array([170, 160, 148])
    return Image.fromarray((top * (1 - y) + bot * y).repeat(w, 1).astype('uint8'), 'RGB')

def _iou(a, b):
    a = np.array(a) > 127; b = np.array(b) > 127; u = (a | b).sum(); return float((a & b).sum() / u) if u else 1.0
def mattes(ref):
    """Primary matte plus an independent second-opinion matte from a different model. Disagreement is an uncertainty signal, not a quality score."""
    a = SESSION.alpha(ref); b = SESSION2.alpha(ref) if SESSION2 else None
    return a, b, (_iou(a, b) if b is not None else None)
def matte_endpoint(req):
    ref, ref_sha = dec(req['reference']); ref = ref.convert('RGB'); a, b, agree = mattes(ref)
    return {'reference_sha256': ref_sha, 'size': list(ref.size), 'primary': {'model': MODEL, 'matte': enc(a)[0]}, 'second': ({'model': SECOND, 'matte': enc(b)[0]} if b is not None else None), 'agreement_iou': None if agree is None else round(agree, 3), 'agree_threshold': AGREE_MIN}

def contact_shadow(W, H, alpha_np, x, y, opts):
    """Shadow drawn on the background *before* the product is placed (one compositing pass). Two parts:
    a tight contact core under the base (what stops a product looking like it floats) and a soft cast shadow
    whose direction/softness/strength come from the art direction (opts) so it can match the scene's light."""
    from maskfix import base_extent
    ext = base_extent(alpha_np)
    if not ext: return Image.new('L', (W, H), 0), None
    x0, x1, by = ext; cx = x + (x0 + x1) / 2; gy = y + by; bw = max(8, x1 - x0)
    strength = min(max(float(opts.get('strength', 0.55)), 0.0), 1.0); soft = min(max(float(opts.get('softness', 0.5)), 0.0), 1.0)
    ang = float(opts.get('angle', 0.0))          # degrees; 0 = shadow falls straight back, positive = to the right
    length = min(max(float(opts.get('length', 0.25)), 0.0), 1.0)
    sh = Image.new('L', (W, H), 0); d = ImageDraw.Draw(sh)
    # contact core: thin, dark, barely blurred
    # contact core must be visible around the base, not hidden behind it: wider than the base and mostly in front of it
    core = Image.new('L', (W, H), 0); cd = ImageDraw.Draw(core)
    cd.ellipse([cx - bw * 0.66, gy - bw * 0.03, cx + bw * 0.66, gy + bw * 0.075], fill=int(255 * min(1.0, strength * 0.75)))   # ambient occlusion
    core = core.filter(ImageFilter.GaussianBlur(6 + 10 * soft))
    tight = Image.new('L', (W, H), 0); ImageDraw.Draw(tight).ellipse([cx - bw * 0.54, gy - bw * 0.012, cx + bw * 0.54, gy + bw * 0.028], fill=int(255 * min(1.0, strength * 1.15)))
    core = ImageChops.lighter(core, tight.filter(ImageFilter.GaussianBlur(2 + 3 * soft)))
    # cast shadow: the product silhouette squashed onto the ground plane and sheared by the light angle
    sil = Image.fromarray((alpha_np >= 128).astype('uint8') * 255, 'L')
    hgt = max(1, int(sil.height * length)); flat = sil.resize((sil.width, hgt), Image.BILINEAR).transpose(Image.FLIP_TOP_BOTTOM)
    shear = np.tan(np.radians(ang)); flat = flat.transform(flat.size, Image.AFFINE, (1, -shear, shear * hgt if shear > 0 else 0, 0, 1, 0), Image.BILINEAR) if ang else flat
    cast = Image.new('L', (W, H), 0); cast.paste(flat.point(lambda v: int(v * 0.45 * strength)), (int(x), int(gy - hgt)), flat)
    cast = cast.filter(ImageFilter.GaussianBlur(6 + 30 * soft))
    out = ImageChops.lighter(core, cast)
    return out, {'ground_y': int(gy), 'base_x': [int(x + x0), int(x + x1)], 'strength': strength, 'softness': soft, 'angle': ang, 'length': length}


def composite(req):
    from maskfix import refine
    ref, ref_sha = dec(req['reference']); ref = ref.convert('RGB'); W, H = int(req['width']), int(req['height'])
    if not (64 <= W <= 2048 and 64 <= H <= 2048): raise ValueError('bad size')
    seg = {'primary_model': MODEL, 'second_model': SECOND or None}
    if req.get('mask'):                                                       # an approved / manually corrected mask replaces the automatic one
        mk, mk_sha = dec(req['mask']); raw = mk.convert('L').resize(ref.size, Image.LANCZOS); seg.update(source='saved_mask', status='saved_mask', mask_sha256=mk_sha, agreement_iou=None)
    else:
        raw, alt, agree = mattes(ref); seg.update(source='auto', agreement_iou=None if agree is None else round(agree, 3), status=('single_model_unchecked' if agree is None else 'agree' if agree >= AGREE_MIN else 'disagree_needs_review'))
    alpha, mask_stats = refine(raw, fill_holes=req.get('fill_holes', True) is not False, keep_boxes=req.get('keep_transparent') or None)
    mask_url, mask_sha = enc(alpha)
    cut = ref.convert('RGBA'); cut.putalpha(alpha)                            # matte applied to the untouched reference pixels
    bbox = cut.getchannel('A').point(lambda a: 255 if a > 8 else 0).getbbox()
    if not bbox: raise ValueError('no product found in the photo')
    r_, g_, b_, a_ = cut.split(); cut = Image.merge('RGBA', (r_, g_, b_, a_.point(lambda v: 255 if v >= 200 else (0 if v < 16 else v))))   # solid interior, thin soft edge
    cut = cut.crop(bbox); scale = min(float(req.get('scale', 0.7)) * min(W / cut.width, H / cut.height), 1.0)
    fg = cut.resize((max(1, round(cut.width * scale)), max(1, round(cut.height * scale))), Image.LANCZOS) if scale != 1.0 else cut   # the single resample; this is the locked foreground
    if req.get('background'):
        bg, _ = dec(req['background']); bg = bg.convert('RGB').resize((W, H), Image.LANCZOS); bg_src = 'provided'
    else: bg = procedural_bg(W, H); bg_src = 'procedural'
    cx = min(max(float(req.get('cx', 0.5)), 0.0), 1.0)
    x = min(max(int(W * cx - fg.width / 2), 0), W - fg.width)
    fa = np.array(fg.getchannel('A'))
    if req.get('ground_y') is not None:                                       # art direction gives the surface line; the product base sits on it
        from maskfix import base_extent
        ext = base_extent(fa); base = ext[2] if ext else fg.height - 1
        y = int(H * min(max(float(req['ground_y']), 0.0), 1.0) - base)
    else:
        cy = min(max(float(req.get('cy', 0.5)), 0.0), 1.0); y = int(H * cy - fg.height / 2)
    y = min(max(y, 0), H - fg.height)
    canvas = bg.convert('RGBA')
    shadow, shadow_info = contact_shadow(W, H, fa, x, y, req.get('shadow') or {})
    if shadow_info is not None and (req.get('shadow') or {}).get('enabled', True) is not False:
        canvas = Image.composite(Image.new('RGBA', (W, H), (18, 8, 4, 255)), canvas, shadow)
    canvas.alpha_composite(fg, (x, y))
    out = canvas.convert('RGB')
    # QA computed from pixels: inside the matte core (alpha==255, eroded 3px) output must equal the locked foreground
    core = Image.fromarray((fa == 255).astype('uint8') * 255).filter(ImageFilter.MinFilter(7))
    m = np.array(core) > 0; o = np.array(out.crop((x, y, x + fg.width, y + fg.height)))[..., :3]; f = np.array(fg.convert('RGB'))
    px = int(m.sum()); diff = int((np.abs(o.astype(int) - f.astype(int)).max(axis=2)[m] > 0).sum()) if px else -1
    image, out_sha = enc(out)
    review = list(mask_stats['review_reasons'])
    if seg.get('status') == 'disagree_needs_review': review.append('the two cutout models disagree (IoU %.2f); check the cutout edges' % seg['agreement_iou'])
    fidelity = 'pass' if diff == 0 and px > 0 else ('fail' if px > 0 else 'no_protected_pixels')
    report = {'matte_model': MODEL, 'segmentation': seg, 'background': bg_src, 'reference_sha256': ref_sha, 'output_sha256': out_sha,
              'foreground': {'x': x, 'y': y, 'w': fg.width, 'h': fg.height, 'resampled_once': scale != 1.0, 'scale': round(scale, 4)},
              'mask': {**mask_stats, 'sha256': mask_sha},
              'shadow': shadow_info,
              'protected_pixels': px, 'protected_pixels_changed': diff,
              'protected_pixel_equality': fidelity,
              'review_required': review, 'approved': False,
              'note': 'protected_pixel_equality only proves the compositor did not alter the pixels the mask kept. Mask completeness is reported separately under mask; an output is never approved by these checks alone.'}
    return {'image': image, 'report': report, 'mask': mask_url}

MAX_BODY = 8_000_000
TOKEN_SECRET = os.environ.get('COMPOSE_TOKEN_SECRET') or os.environ.get('SESSION_SECRET', '')
REQUIRE_TOKEN = os.environ.get('COMPOSE_REQUIRE_TOKEN', '1' if TOKEN_SECRET else '0') != '0'
def verify_token(tok):
    """App-level auth for browser calls: a short-lived token minted by the Node API (images/composeToken) only for a
    workspace allowed to use the Creative Engine and within its compositor quota. HMAC-SHA256 over the payload."""
    import hmac, time
    if not REQUIRE_TOKEN: return True, 'not required'
    try:
        body, sig = tok.split('.', 1)
        want = base64.urlsafe_b64encode(hmac.new(TOKEN_SECRET.encode(), body.encode(), hashlib.sha256).digest()).decode().rstrip('=')
        if not hmac.compare_digest(want, sig): return False, 'bad signature'
        claims = json.loads(base64.urlsafe_b64decode(body + '=' * (-len(body) % 4)))
        if claims.get('aud') != 'compose' or float(claims.get('exp', 0)) < time.time(): return False, 'expired'
        return True, claims.get('ws', '')
    except Exception: return False, 'missing or malformed token'

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def send(self, code, obj):
        b = json.dumps(obj).encode(); self.send_response(code); self.send_header('content-type', 'application/json'); self.send_header('content-length', str(len(b))); self.end_headers(); self.wfile.write(b)
    def op(self): return self.path.split('?')[0].rstrip('/').rsplit('/', 1)[-1]   # '/composite' locally, '/api/compose/composite' on Vercel
    def do_GET(self): self.send(200, {'ok': True, 'matte_model': MODEL}) if self.op() in ('health', 'compose') else self.send(404, {'error': 'not found'})
    def do_POST(self):
        if KEY and self.headers.get('authorization') == 'Bearer ' + KEY: pass                 # server-to-server credential
        else:
            ok, why = verify_token(self.headers.get('x-cs-compose', ''))
            if not ok: return self.send(401, {'error': 'unauthorized: ' + why})
        if self.op() not in ('composite', 'matte'): return self.send(404, {'error': 'not found'})
        try:
            n = int(self.headers.get('content-length', 0))
            if n > MAX_BODY: return self.send(413, {'error': 'too large'})
            body = json.loads(self.rfile.read(n)); self.send(200, matte_endpoint(body) if self.op() == 'matte' else composite(body))
        except (ValueError, KeyError, OSError) as e: self.send(400, {'error': str(e)[:200]})
if __name__ == '__main__':
    ThreadingHTTPServer((os.environ.get('HOST', '127.0.0.1'), int(os.environ.get('PORT', 8920))), H).serve_forever()
