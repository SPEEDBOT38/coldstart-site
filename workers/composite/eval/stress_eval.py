"""Segmentation quality (IoU / boundary-F vs a KNOWN ground-truth mask) measured separately from protected-pixel preservation.
IMPORTANT: these are SYNTHETIC stress fixtures (exact masks exist), not genuine product photographs. They approximate failure modes
(gloss, transparency, thin edges, small print) but do not replace testing on real photos. Run: python3 stress_eval.py [out.json]"""
import sys, json, base64, io, math, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import service
from rembg import remove

W, H = 900, 1100; rng = np.random.default_rng(7)
def busy_bg():
    a = rng.integers(90, 200, (H // 40 + 1, W // 40 + 1, 3)).astype('uint8'); return Image.fromarray(a).resize((W, H), Image.BICUBIC)
def font(n):
    for p in ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf']:
        try: return ImageFont.truetype(p, n)
        except OSError: pass
    return ImageFont.load_default()
def shade(w, h, base, spec=True):
    x = np.linspace(-1, 1, w)[None, :, None]; img = np.ones((h, w, 3)) * np.array(base) * (0.55 + 0.45 * (1 - x ** 2))
    if spec: img = img + 90 * np.exp(-((x + 0.45) / 0.08) ** 2)                 # vertical specular highlight
    return Image.fromarray(np.clip(img, 0, 255).astype('uint8'))
def case_glossy_bottle():
    gt = Image.new('L', (W, H), 0); d = ImageDraw.Draw(gt); d.rounded_rectangle((330, 330, 570, 980), 40, 255); d.rounded_rectangle((390, 190, 510, 360), 20, 255)
    fg = shade(W, H, (30, 90, 160)); ImageDraw.Draw(fg).text((360, 620), "SERUM\n30 ml", fill=(255, 255, 255), font=font(34)); return fg, gt
def case_transparent_bottle():
    gt = Image.new('L', (W, H), 0); d = ImageDraw.Draw(gt); d.rounded_rectangle((330, 330, 570, 980), 40, 255); d.rounded_rectangle((400, 220, 500, 360), 12, 255)
    return None, gt
def case_thin_edges():
    gt = Image.new('L', (W, H), 0); d = ImageDraw.Draw(gt); d.line((200, 900, 450, 250), fill=255, width=6); d.line((700, 900, 450, 250), fill=255, width=6); d.ellipse((415, 215, 485, 285), outline=255, width=6); d.line((250, 780, 650, 780), fill=255, width=5)
    fg = Image.new('RGB', (W, H), (40, 40, 40)); return fg, gt
def case_small_label_jar():
    gt = Image.new('L', (W, H), 0); d = ImageDraw.Draw(gt); d.rounded_rectangle((250, 450, 650, 900), 30, 255); d.rectangle((280, 380, 620, 460), fill=255)
    fg = Image.new('RGB', (W, H), (235, 230, 220)); f = ImageDraw.Draw(fg); f.rectangle((280, 380, 620, 460), fill=(60, 60, 60)); f.text((300, 600), "FERN & FORM", fill=(20, 60, 20), font=font(22)); f.text((300, 650), "net wt 250 g  batch 0417", fill=(60, 60, 60), font=font(11)); return fg, gt
def case_reflective_can():
    gt = Image.new('L', (W, H), 0); d = ImageDraw.Draw(gt); d.rectangle((300, 300, 600, 950), 255)
    fg = shade(W, H, (200, 200, 205)); fg = fg.filter(ImageFilter.GaussianBlur(0.5)); return fg, gt
CASES = {'glossy_bottle': case_glossy_bottle, 'transparent_bottle': case_transparent_bottle, 'thin_edges': case_thin_edges, 'small_label_jar': case_small_label_jar, 'reflective_can': case_reflective_can}
def build(name):
    fg, gt = CASES[name](); bg = busy_bg()
    if fg is None:                                                       # glass: 25% tinted body over the busy background, brighter rim
        tint = Image.new('RGB', (W, H), (200, 230, 240)); body = Image.composite(Image.blend(bg, tint, 0.22), bg, gt)
        rim = gt.filter(ImageFilter.MinFilter(9)); edge = Image.fromarray(np.array(gt).astype(int) - np.array(rim).astype(int)).convert('L') if False else Image.fromarray((np.array(gt) > 0).astype('uint8') * 255 - (np.array(rim) > 0).astype('uint8') * 255)
        return Image.composite(Image.new('RGB', (W, H), (240, 245, 250)), body, edge), gt
    m = gt.filter(ImageFilter.GaussianBlur(0.8)); return Image.composite(fg, bg, m), gt
def metrics(pred, gt):
    p = np.array(pred) > 127; g = np.array(gt) > 127; inter = (p & g).sum(); union = (p | g).sum()
    def edge(m): from PIL import ImageFilter as F; im = Image.fromarray((m * 255).astype('uint8')); er = np.array(im.filter(F.MinFilter(3))) > 127; return m & ~er
    ep, eg = edge(p), edge(g); k = Image.fromarray((eg * 255).astype('uint8')).filter(ImageFilter.MaxFilter(5)); k2 = Image.fromarray((ep * 255).astype('uint8')).filter(ImageFilter.MaxFilter(5))
    prec = (ep & (np.array(k) > 127)).sum() / max(1, ep.sum()); rec = (eg & (np.array(k2) > 127)).sum() / max(1, eg.sum())
    return {'iou': round(float(inter / max(1, union)), 3), 'boundary_f1_2px': round(float(2 * prec * rec / max(1e-9, prec + rec)), 3), 'predicted_area_ratio': round(float(p.sum() / max(1, g.sum())), 3)}
def enc(im): o = io.BytesIO(); im.save(o, 'PNG'); return 'data:image/png;base64,' + base64.b64encode(o.getvalue()).decode()
out = {'note': 'SYNTHETIC stress fixtures with exact ground truth; not genuine product photographs.', 'model': service.MODEL, 'cases': {}}
for n in CASES:
    img, gt = build(n); alpha = remove(img, session=service.SESSION).getchannel('A'); seg = metrics(alpha, gt)
    rep = service.composite({'reference': enc(img), 'width': 1080, 'height': 1350})['report']
    out['cases'][n] = {'segmentation_vs_ground_truth': seg, 'protected_pixel_check': {k: rep[k] for k in ['protected_pixels', 'protected_pixels_changed', 'matte_coverage', 'protected_pixel_equality']},
                       'reading': 'Preservation can pass while segmentation is poor: the check only proves we did not alter the pixels the matte kept.'}
    img.save(f'/tmp/stress_{n}.png')
json.dump(out, open(sys.argv[1] if len(sys.argv) > 1 else '/tmp/seg.json', 'w'), indent=1); print(json.dumps({k: [v['segmentation_vs_ground_truth']['iou'], v['segmentation_vs_ground_truth']['boundary_f1_2px'], v['protected_pixel_check']['protected_pixel_equality']] for k, v in out['cases'].items()}))
