"""Pixel-locked product compositor. Reuses rembg (MIT; u2netp weights Apache-2.0) for the matte and Pillow (HPND) for compositing.
Only glue lives here. Run:  python3 workers/composite/service.py   (PORT, COMPOSITE_KEY, REMBG_MODEL=u2netp)
POST /composite  {reference:dataUrl, background?:dataUrl, width, height, scale?}  -> {image:dataUrl, report}
The report is computed from the output pixels, not asserted: inside the eroded product matte the output must equal the locked foreground exactly."""
import base64, hashlib, io, json, os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from PIL import Image, ImageFilter, ImageChops
import numpy as np
from rembg import remove, new_session

MODEL = os.environ.get('REMBG_MODEL', 'u2netp'); KEY = os.environ.get('COMPOSITE_KEY', '')
PINNED = {'u2netp': '309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8'}   # sha256 of u2netp.onnx; source https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx ; U-2-Net licence Apache-2.0
def _check_weights():
    f = os.path.join(os.environ.get('U2NET_HOME', os.path.expanduser('~/.u2net')), MODEL + '.onnx')
    if MODEL in PINNED and os.path.exists(f) and hashlib.sha256(open(f, 'rb').read()).hexdigest() != PINNED[MODEL]: raise SystemExit('model weights checksum mismatch: refusing to start')
_check_weights()
SESSION = new_session(MODEL)
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

def composite(req):
    ref, ref_sha = dec(req['reference']); ref = ref.convert('RGB'); W, H = int(req['width']), int(req['height'])
    if not (64 <= W <= 4096 and 64 <= H <= 4096): raise ValueError('bad size')
    cut = remove(ref, session=SESSION).convert('RGBA')                       # rembg matte
    bbox = cut.getchannel('A').point(lambda a: 255 if a > 8 else 0).getbbox()
    if not bbox: raise ValueError('no product found in the photo')
    r_, g_, b_, a_ = cut.split(); cut = Image.merge('RGBA', (r_, g_, b_, a_.point(lambda v: 255 if v >= 200 else (0 if v < 16 else v))))   # make the product interior solid; keep a thin soft edge
    cut = cut.crop(bbox); scale = min(float(req.get('scale', 0.7)) * min(W / cut.width, H / cut.height), 1.0)
    fg = cut.resize((max(1, round(cut.width * scale)), max(1, round(cut.height * scale))), Image.LANCZOS) if scale != 1.0 else cut   # the single resample; this is the locked foreground
    if req.get('background'):
        bg, _ = dec(req['background']); bg = bg.convert('RGB').resize((W, H), Image.LANCZOS); bg_src = 'provided'
    else: bg = procedural_bg(W, H); bg_src = 'procedural'
    x, y = (W - fg.width) // 2, int(H * 0.5 - fg.height * 0.5)
    canvas = bg.convert('RGBA')
    a = np.array(fg.getchannel('A')).astype(np.float32) / 255
    shadow = Image.new('L', (W, H), 0); sh = Image.new('L', fg.size, 0); sh.paste(Image.fromarray((a * 90).astype('uint8')), (0, 0))
    shadow.paste(sh, (x + 6, y + 12)); shadow = shadow.filter(ImageFilter.GaussianBlur(14))
    canvas = Image.composite(Image.new('RGBA', (W, H), (0, 0, 0, 255)), canvas, shadow.point(lambda v: min(v, 110)))   # soft contact shadow under the product
    canvas.alpha_composite(fg, (x, y))
    out = canvas.convert('RGB')
    # QA computed from pixels: inside the matte core (alpha==255, eroded 3px) output must equal the locked foreground
    core = Image.fromarray((np.array(fg.getchannel('A')) == 255).astype('uint8') * 255).filter(ImageFilter.MinFilter(7))
    m = np.array(core) > 0; o = np.array(out.crop((x, y, x + fg.width, y + fg.height)))[..., :3]; f = np.array(fg.convert('RGB'))
    px = int(m.sum()); diff = int((np.abs(o.astype(int) - f.astype(int)).max(axis=2)[m] > 0).sum()) if px else -1
    image, out_sha = enc(out)
    report = {'matte_model': MODEL, 'background': bg_src, 'reference_sha256': ref_sha, 'output_sha256': out_sha, 'foreground': {'x': x, 'y': y, 'w': fg.width, 'h': fg.height, 'resampled_once': scale != 1.0, 'scale': round(scale, 4)},
              'protected_pixels': px, 'protected_pixels_changed': diff, 'matte_coverage': round(px / max(1, int((np.array(fg.getchannel('A')) > 16).sum())), 3),
              'protected_pixel_equality': ('needs_review' if px < 0.5 * int((np.array(fg.getchannel('A')) > 16).sum()) else 'pass' if diff == 0 else 'fail'),
              'note': 'Equality is checked against the locked (single-resample) foreground. It proves the compositor did not alter product pixels; it does not prove the matte caught every edge.'}
    return {'image': image, 'report': report}

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def send(self, code, obj):
        b = json.dumps(obj).encode(); self.send_response(code); self.send_header('content-type', 'application/json'); self.send_header('content-length', str(len(b))); self.end_headers(); self.wfile.write(b)
    def do_GET(self): self.send(200, {'ok': True, 'matte_model': MODEL}) if self.path == '/health' else self.send(404, {'error': 'not found'})
    def do_POST(self):
        if KEY and self.headers.get('authorization') != 'Bearer ' + KEY: return self.send(401, {'error': 'unauthorized'})
        if self.path != '/composite': return self.send(404, {'error': 'not found'})
        try:
            n = int(self.headers.get('content-length', 0))
            if n > 40_000_000: return self.send(413, {'error': 'too large'})
            self.send(200, composite(json.loads(self.rfile.read(n))))
        except (ValueError, KeyError, OSError) as e: self.send(400, {'error': str(e)[:200]})
if __name__ == '__main__':
    ThreadingHTTPServer((os.environ.get('HOST', '127.0.0.1'), int(os.environ.get('PORT', 8920))), H).serve_forever()
