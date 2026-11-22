"""Real-photo validation harness for the pixel-locked compositor.
Usage: python3 real_photos.py --photos DIR [--masks DIR] [--backgrounds DIR] [--out report.json]
  DIR holds genuine product photos (jpg/png). Optional ground truth: MASKS/<photo-stem>.png (white = product). Optional backgrounds: BACKGROUNDS/<photo-stem>.jpg (e.g. from scripts/gen-backgrounds.mjs).
Exit 0 = ran, 2 = BLOCKED (no photos). Segmentation quality (IoU / boundary-F1) is only computed where a ground-truth mask exists, and is reported SEPARATELY from protected-pixel preservation.
OCR/logo verification is NOT performed here: identity checks stay 'unverified'."""
import sys, os, json, time, base64, io, argparse, resource, glob
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__))); sys.path.insert(0, os.path.dirname(__file__))
from PIL import Image
ap = argparse.ArgumentParser(); ap.add_argument('--photos', required=True); ap.add_argument('--masks'); ap.add_argument('--backgrounds'); ap.add_argument('--out', default='real-photos-report.json'); a = ap.parse_args()
files = sorted(f for ext in ('jpg', 'jpeg', 'png', 'webp') for f in glob.glob(os.path.join(a.photos, '*.' + ext)))
if not files: print(json.dumps({'blocked': True, 'action': 'Put genuine product photos (not renders, not synthetic) in ' + a.photos})); sys.exit(2)
import service; from rembg import remove; from metrics import metrics
def enc(path): return 'data:image/' + ('png' if path.endswith('png') else 'jpeg') + ';base64,' + base64.b64encode(open(path, 'rb').read()).decode()
rows = []
for f in files:
    stem = os.path.splitext(os.path.basename(f))[0]; row = {'photo': os.path.basename(f), 'bytes': os.path.getsize(f)}
    try:
        img = Image.open(f).convert('RGB'); row['size'] = img.size
        t = time.time(); alpha = remove(img, session=service.SESSION).getchannel('A'); row['segmentation_ms'] = round((time.time() - t) * 1000)
        mp = os.path.join(a.masks, stem + '.png') if a.masks else None
        row['segmentation_vs_ground_truth'] = metrics(alpha, Image.open(mp).convert('L').resize(img.size)) if mp and os.path.exists(mp) else {'status': 'no_ground_truth_mask', 'note': 'Segmentation quality is unmeasured for this photo. Only preservation is reported.'}
        req = {'reference': enc(f), 'width': 1080, 'height': 1350}; bp = next((p for p in glob.glob(os.path.join(a.backgrounds or '', stem + '.*'))), None)
        if bp: req['background'] = enc(bp)
        t = time.time(); rep = service.composite(req)['report']; row['composite_ms'] = round((time.time() - t) * 1000)
        row['background'] = {'kind': 'provided' if bp else 'procedural_gradient', 'note': 'provided = generated or supplied elsewhere; procedural_gradient is NOT AI photography'}
        row['protected_pixel_check'] = {k: rep[k] for k in ['protected_pixels', 'protected_pixels_changed', 'matte_coverage', 'protected_pixel_equality']}
        row['identity_checks'] = {'packaging_text': 'unverified', 'logo': 'unverified', 'note': 'Not performed by this harness.'}
        row['status'] = 'needs_human_review' if rep['protected_pixel_equality'] != 'pass' else 'preserved_pending_human_approval'
    except Exception as e: row['status'] = 'failed'; row['error'] = str(e)[:200]
    rows.append(row)
out = {'model': service.MODEL, 'at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'peak_rss_mb': round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024), 'count': len(rows), 'failed': sum(r['status'] == 'failed' for r in rows), 'rows': rows}
json.dump(out, open(a.out, 'w'), indent=1); print(json.dumps({k: out[k] for k in ['model', 'count', 'failed', 'peak_rss_mb']}))
